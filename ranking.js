"use strict";

/* =========================
   設定
========================= */
const GAS_URL = "https://script.google.com/macros/s/AKfycbxnqDdZJPE0BPN5TRpqR49ejScQKyKADygXzw5tcp6RdCauKbeTfeQTWpP6WAKYK7Ue/exec";
const ADMIN_PASSWORD = "babanuki123";
const STORAGE_KEY = "rankingPlayerData_v3";
const DELETED_KEY = "rankingDeletedPlayers";
const HISTORY_KEY = "rankingHistory_v3";
const TITLE_HISTORY_KEY = "titleHistory_v3";

const RANDOM_TITLES = ["ミラクルババ","ラッキーババ"];
const RANDOM_TITLE_PROB = 0.1;
const RANDOM_TITLE_DAILY_LIMIT = 5;

const ALL_TITLES = [
  {name:"キングババ", desc:"1位獲得！"},
  {name:"シルバーババ", desc:"2位獲得！"},
  {name:"ブロンズババ", desc:"3位獲得！"},
  {name:"逆転の達人", desc:"大逆転！"},
  {name:"サプライズ勝利", desc:"ビリから1位！"},
  {name:"幸運の持ち主", desc:"ババを引かずに勝利"},
  {name:"不屈の挑戦者", desc:"連続参加3回以上"},
  {name:"レートブースター", desc:"今回最大レート獲得"},
  {name:"反撃の鬼", desc:"順位上昇で3位以内"},
  {name:"チャンスメーカー", desc:"ボーナスポイント獲得"},
  {name:"ミラクルババ", desc:"奇跡の称号"},
  {name:"連勝街道", desc:"連勝2回以上"},
  {name:"勝利の方程式", desc:"安定上昇中"},
  {name:"挑戦者", desc:"初参加で上位"},
  {name:"エピックババ", desc:"称号5個以上獲得"},
  {name:"ババキング", desc:"1位を3回獲得"},
  {name:"観察眼", desc:"ボーナス獲得上位"},
  {name:"運命の番人", desc:"最後のババ回避成功"},
  {name:"ラッキーババ", desc:"ラッキー称号"},
  {name:"究極のババ", desc:"全称号コンプリート直前"}
];

/* =========================
   State
========================= */
let playerData = new Map();
let deletedPlayers = new Set();
let lastProcessedRows = [];
let rankingHistory = [];
let titleHistory = [];
let isAdmin = false;
let isFetching = false;
let autoRefreshTimer = null;
let fontSize = 14;
const titleCatalog = {};
const assignedRandomTitles = new Set();
let dailyRandomCount = loadFromStorage("dailyRandomCount", {});
titleHistory = loadFromStorage(TITLE_HISTORY_KEY,[]);
let titleFilter = "all"; // all / unlocked / locked
let titleSearch = "";    // 検索文字列
let chartInstance = null;

/* =========================
   Utility
========================= */
const $ = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
function debounce(fn, wait=250){let t; return (...args)=>{clearTimeout(t); t=setTimeout(()=>fn(...args),wait);};}
function fmtChange(val,up="↑",down="↓"){return val>0?`${up}${val}`:val<0?`${down}${-val}`:"—";}
function toast(msg,sec=2500){const t=$("#toast"); if(t){ t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),sec); }}
function escapeCSV(s){return `"${String(s).replace(/"/g,'""')}"`;}

/* =========================
   Storage
========================= */
function loadFromStorage(key,fallback){ try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw):fallback;}catch(e){return fallback;} }
function saveToStorage(key,value){ try{ localStorage.setItem(key,JSON.stringify(value)); }catch(e){}}
function loadPlayerData(){ const raw=loadFromStorage(STORAGE_KEY,null); if(raw) playerData=new Map(raw);}
function savePlayerData(){ saveToStorage(STORAGE_KEY,Array.from(playerData.entries()));}
function loadDeletedPlayers(){ deletedPlayers=new Set(loadFromStorage(DELETED_KEY,[]));}
function saveDeletedPlayers(){ saveToStorage(DELETED_KEY,Array.from(deletedPlayers));}
function loadRankingHistory(){ rankingHistory=loadFromStorage(HISTORY_KEY,[]);}
function saveRankingHistory(){ saveToStorage(HISTORY_KEY,rankingHistory);}
function saveTitleHistory(){ saveToStorage(TITLE_HISTORY_KEY,titleHistory);}

/* =========================
   管理者モード
========================= */
function setAdminMode(enabled){
  isAdmin=Boolean(enabled);
  $$("th.admin-only,td.admin-only").forEach(el=>el.style.display=isAdmin?"table-cell":"none");
}

/* =========================
   ランダム称号管理
========================= */
function canAssignRandom(playerId){
  const today = new Date().toISOString().slice(0,10);
  if(!dailyRandomCount[today]) dailyRandomCount[today]=0;
  return !assignedRandomTitles.has(playerId) && dailyRandomCount[today]<RANDOM_TITLE_DAILY_LIMIT;
}
function registerRandomAssign(playerId){
  const today = new Date().toISOString().slice(0,10);
  if(!dailyRandomCount[today]) dailyRandomCount[today]=0;
  dailyRandomCount[today]++;
  assignedRandomTitles.add(playerId);
  saveToStorage("dailyRandomCount", dailyRandomCount);
}

/* =========================
   ポップアップ
========================= */
const TITLE_SOUNDS = {
  "キングババ":"sounds/gold.mp3","シルバーババ":"sounds/silver.mp3","ブロンズババ":"sounds/bronze.mp3",
  "逆転の達人":"sounds/reversal.mp3","サプライズ勝利":"sounds/reversal.mp3","幸運の持ち主":"sounds/lucky.mp3",
  "ラッキーババ":"sounds/lucky.mp3","不屈の挑戦者":"sounds/fire.mp3","連勝街道":"sounds/fire.mp3",
  "default":"sounds/popup.mp3"
};
const popupQueue=[]; let popupActive=false;

function enqueueTitlePopup(playerId,titleObj){ 
  popupQueue.push({playerId,titleObj}); 
  if(!popupActive) processPopupQueue(); 
}

function processPopupQueue(){
  if(popupQueue.length===0){ popupActive=false; return; }
  popupActive=true;
  const {playerId,titleObj}=popupQueue.shift();
  showTitlePopup(playerId,titleObj);
  setTimeout(processPopupQueue, window.innerWidth<768?1000:window.innerWidth<1200?700:500);
}

function showTitlePopup(playerId,titleObj){
  const popup=document.createElement("div");
  popup.className="title-popup";
  popup.innerHTML=`<strong>${playerId}</strong><br><strong>${titleObj.name}</strong><br><small>${titleObj.desc}</small>`;
  document.body.appendChild(popup);
  new Audio(TITLE_SOUNDS[titleObj.name]||TITLE_SOUNDS.default).play();

  // パーティクル
  const particleContainer=document.createElement("div");
  particleContainer.className="particle-container";
  document.body.appendChild(particleContainer);

  const particleCount = window.innerWidth<768 ? 10 : window.innerWidth<1200 ? 20 : 30;
  for(let i=0;i<particleCount;i++){
    const p=document.createElement("div");
    p.className="particle";
    p.style.left=Math.random()*100+"vw";
    p.style.top=Math.random()*100+"vh";
    p.style.animationDuration=(window.innerWidth<768?0.5:0.5+Math.random()*1.5)+"s";
    p.style.backgroundColor=`hsl(${Math.random()*360},100%,50%)`;
    particleContainer.appendChild(p);
  }

  setTimeout(()=>popup.classList.add("show"),50);
  setTimeout(()=>{ 
    popup.classList.remove("show"); 
    particleContainer.remove(); 
    setTimeout(()=>popup.remove(),600); 
  },1400);
}

/* =========================
   称号付与・履歴
========================= */
function assignTitles(player){
  if(!player.titles) player.titles=[];
  player.currentRankingLength=lastProcessedRows.length;

  const podiumTitles=["キングババ","シルバーババ","ブロンズババ"];
  if(player.rank<=3){
    player.title=podiumTitles[player.rank-1];
    if(!player.titles.includes(player.title)){
      player.titles.push(player.title);
      const t=ALL_TITLES.find(tt=>tt.name===player.title);
      updateTitleCatalog(t); enqueueTitlePopup(player.playerId,t);
      titleHistory.push({playerId:player.playerId,title:t.name,date:new Date().toISOString()});
      saveTitleHistory();
    }
  }

  const FIXED_TITLES=ALL_TITLES.filter(t=>!podiumTitles.includes(t.name) && !RANDOM_TITLES.includes(t.name));
  const maxRateGain=Math.max(...lastProcessedRows.map(x=>x.rateGain));
  const maxBonus=Math.max(...lastProcessedRows.map(x=>x.bonus));

  FIXED_TITLES.forEach(t=>{
    let cond=false;
    switch(t.name){
      case "逆転の達人": cond=((player.prevRank??player.rank)-player.rank)>=3; break;
      case "サプライズ勝利": cond=(player.prevRank??0)===player.currentRankingLength && player.rank===1; break;
      case "幸運の持ち主": cond=player.noBabaDraw===true; break;
      case "不屈の挑戦者": cond=player.consecutiveGames>=3; break;
      case "レートブースター": cond=player.rateGain===maxRateGain; break;
      case "反撃の鬼": cond=player.prevRank>player.rank && player.rank<=3; break;
      case "チャンスメーカー": cond=player.bonus===maxBonus; break;
      case "連勝街道": cond=player.winStreak>=2; break;
      case "勝利の方程式": cond=player.rateTrend>=3; break;
      case "挑戦者": cond=player.rank<=5 && player.prevGames===0; break;
      case "エピックババ": cond=player.totalTitles>=5; break;
      case "ババキング": cond=player.rank1Count>=3; break;
      case "観察眼": cond=player.maxBonusCount>=3; break;
      case "運命の番人": cond=player.lastBabaSafe===true; break;
      case "究極のババ": cond=player.titles.length===ALL_TITLES.length-1; break;
    }
    if(cond && !player.titles.includes(t.name)){
      player.titles.push(t.name); updateTitleCatalog(t); enqueueTitlePopup(player.playerId,t);
      titleHistory.push({playerId:player.playerId,title:t.name,date:new Date().toISOString()});
      saveTitleHistory();
    }
  });

  RANDOM_TITLES.forEach(name=>{
    const t=ALL_TITLES.find(tt=>tt.name===name);
    if(Math.random()<RANDOM_TITLE_PROB && canAssignRandom(player.playerId) && !player.titles.includes(name)){
      player.titles.push(name); updateTitleCatalog(t); enqueueTitlePopup(player.playerId,t); registerRandomAssign(player.playerId);
      titleHistory.push({playerId:player.playerId,title:t.name,date:new Date().toISOString()});
      saveTitleHistory();
    }
  });
}

/* =========================
   称号図鑑（統一）
========================= */
function updateTitleCatalog(title){
  if(!titleCatalog[title.name]) titleCatalog[title.name]={unlocked:true,desc:title.desc};
  else titleCatalog[title.name].unlocked=true;
  renderTitleCatalog();
}

function renderTitleCatalog(){
  const container=$("#titleCatalog");
  if(!container) return;
  container.innerHTML="";

  const cols=window.innerWidth<768?1:window.innerWidth<1024?2:3;
  container.style.gridTemplateColumns=`repeat(${cols},minmax(0,1fr))`;

  ALL_TITLES.forEach(title=>{
    const unlocked = titleCatalog[title.name]?.unlocked??false;
    if(titleFilter==="unlocked" && !unlocked) return;
    if(titleFilter==="locked" && unlocked) return;
    if(titleSearch && !title.name.toLowerCase().includes(titleSearch)) return;

    const historyEntries=titleHistory.filter(h=>h.title===title.name);
    const latest=historyEntries.length?new Date(historyEntries[historyEntries.length-1].date).toLocaleDateString():"";

    const div=document.createElement("div");
    div.className=`title-card p-3 rounded flex flex-col items-center justify-center ${unlocked?'bg-green-100':'bg-gray-200'} text-center`;
    div.innerHTML=`
      <strong>${title.name}</strong>
      <small>${title.desc}</small>
      ${latest?`<small class="text-xs mt-1">取得日: ${latest}</small>`:""}
    `;
    container.appendChild(div);
  });
}

function renderTitleFilterControls() {
  const container=$("#titleCatalogControls");
  if(!container) return;
  container.innerHTML=`
    <input type="text" id="titleSearchInput" placeholder="称号名で検索" class="border rounded px-2 py-1 w-full mb-2">
    <div class="flex gap-2 flex-wrap">
      <button class="filter-btn px-2 py-1 rounded border" data-filter="all">全て</button>
      <button class="filter-btn px-2 py-1 rounded border" data-filter="unlocked">取得済み</button>
      <button class="filter-btn px-2 py-1 rounded border" data-filter="locked">未取得</button>
    </div>
  `;
  container.querySelectorAll(".filter-btn").forEach(btn=>{
    btn.addEventListener("click", e=>{
      titleFilter=e.target.dataset.filter;
      renderTitleCatalog();
    });
  });
  $("#titleSearchInput").addEventListener("input", debounce(e=>{
    titleSearch=e.target.value.toLowerCase();
    renderTitleCatalog();
  },200));
}

/* =========================
   Chart.js 折れ線表示
========================= */
function showPlayerChart(playerId){
  const ctx=$("#playerChart").getContext("2d");
  if(chartInstance){ chartInstance.destroy(); chartInstance=null; }

  const history=rankingHistory.filter(h=>h.playerId===playerId);
  const labels=history.map(h=>new Date(h.date).toLocaleDateString());
  const data=history.map(h=>h.rate);

  chartInstance=new Chart(ctx,{
    type:"line",
    data:{labels, datasets:[{label:playerId, data, borderColor:"blue", backgroundColor:"rgba(0,0,255,0.1)"}]},
    options:{responsive:true,plugins:{legend:{display:true}},scales:{y:{beginAtZero:false}}}
  });
}

/* =========================
   CSV出力
========================= */
function exportCSV(){
  let rows=[["順位","ID","レート","レート差","称号"]];
  lastProcessedRows.forEach(p=>{
    rows.push([p.rank,p.playerId,p.rate,p.rateGain,p.titles.join(",")]);
  });
  const csvContent=rows.map(r=>r.map(escapeCSV).join(",")).join("\n");
  const blob=new Blob([csvContent],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download="ranking.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* =========================
   オート更新
========================= */
function startAutoRefresh(intervalMs){
  if(autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer=setInterval(fetchRankingData, intervalMs);
}

function stopAutoRefresh(){
  if(autoRefreshTimer){ clearInterval(autoRefreshTimer); autoRefreshTimer=null; }
}

/* =========================
   ランキング処理・表示は既存コードで統合可能
========================= */
