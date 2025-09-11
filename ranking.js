"use strict";

/* =========================
   設定・定数
========================= */
const GAS_URL = "https://script.google.com/macros/s/AKfycbxnqDdZJPE0BPN5TRpqR49ejScQKyKADygXzw5tcp6RdCauKbeTfeQTWpP6WAKYK7Ue/exec";
const ADMIN_PASSWORD = "babanuki123";
const STORAGE_KEY = "rankingPlayerData_v3";
const DELETED_KEY = "rankingDeletedPlayers";
const HISTORY_KEY = "rankingHistory_v3";
const TITLE_HISTORY_KEY = "titleHistory_v3";
const SECRET_KEY = "your-secret-key";
const AUTO_REFRESH_INTERVAL = 30;

const RANDOM_TITLES = ["ミラクルババ","ラッキーババ"];
const RANDOM_TITLE_PROB = { "ミラクルババ":0.05, "ラッキーババ":0.10 };
const RANDOM_TITLE_DAILY_LIMIT = 5;

const ALL_TITLES = [
  {name:"キングババ", desc:"1位獲得！"},
  {name:"シルバーババ", desc:"2位獲得！"},
  {name:"ブロンズババ", desc:"3位獲得！"},
  {name:"逆転の達人", desc:"三位以上上昇！"},
  {name:"サプライズ勝利", desc:"ビリから1位！"},
  {name:"幸運の持ち主", desc:"ランダム称号を両方獲得！"},
  {name:"不屈の挑戦者", desc:"連続参加3回以上！"},
  {name:"レートブースター", desc:"今回最大レート獲得！"},
  {name:"反撃の鬼", desc:"順位上昇で3位以内！"},
  {name:"チャンスメーカー", desc:"ボーナスポイント獲得！"},
  {name:"ミラクルババ", desc:"奇跡の称号（5％）！"},
  {name:"連勝街道", desc:"連勝2回以上！"},
  {name:"勝利の方程式", desc:"レートが上昇傾向！"},
  {name:"挑戦者", desc:"初参加で上位！"},
  {name:"エピックババ", desc:"称号5個以上獲得！"},
  {name:"ババキング", desc:"1位を3回獲得！"},
  {name:"観察眼", desc:"ボーナス獲得上位！"},
  {name:"運命の番人", desc:"最後のババ回避成功！"},
  {name:"ラッキーババ", desc:"ラッキー称号（10％）！"},
  {name:"究極のババ", desc:"全称号コンプリート！"}
];

/* =========================
   State
========================= */
let players = [];
let playerData = new Map();
let deletedPlayers = new Set();
let lastProcessedRows = [];
let rankingHistory = [];
let titleHistory = [];
let isAdmin = false;
let autoRefreshTimer = null;
let fontSize = 14;
const titleCatalog = {};
const assignedRandomTitles = new Set();
let dailyRandomCount = {};
let titleFilter = "all";
let titleSearch = "";
let isFetching = false;
let renderScheduled = false;

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
function loadPlayerData(){ const raw=loadFromStorage(STORAGE_KEY,null); if(raw) playerData=new Map(raw); }
function savePlayerData(){ saveToStorage(STORAGE_KEY,Array.from(playerData.entries())); }
function loadDeletedPlayers(){ deletedPlayers=new Set(loadFromStorage(DELETED_KEY,[])); }
function saveDeletedPlayers(){ saveToStorage(DELETED_KEY,Array.from(deletedPlayers)); }
function loadRankingHistory(){ rankingHistory=loadFromStorage(HISTORY_KEY,[]); }
function saveRankingHistory(){ saveToStorage(HISTORY_KEY,rankingHistory); }
function saveTitleHistory(){ saveToStorage(TITLE_HISTORY_KEY,titleHistory); }
function saveTitleState(){ saveToStorage("titleFilter", titleFilter); saveToStorage("titleSearch", titleSearch); }
function loadTitleState(){ titleFilter = loadFromStorage("titleFilter", "all"); titleSearch = loadFromStorage("titleSearch", ""); }

/* =========================
   管理者モード
========================= */
function setAdminMode(enabled){
  isAdmin = Boolean(enabled);
  $$("th.admin-only, td.admin-only").forEach(el => el.style.display = isAdmin?"table-cell":"none");
  localStorage.setItem("isAdmin", JSON.stringify(isAdmin));
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
   称号ポップアップ・アニメ
========================= */
const TITLE_SOUNDS = {
  "キングババ":"sounds/gold.mp3","シルバーババ":"sounds/silver.mp3","ブロンズババ":"sounds/bronze.mp3",
  "逆転の達人":"sounds/reversal.mp3","サプライズ勝利":"sounds/reversal.mp3","幸運の持ち主":"sounds/lucky.mp3",
  "ラッキーババ":"sounds/lucky.mp3","不屈の挑戦者":"sounds/fire.mp3","連勝街道":"sounds/fire.mp3",
  "default":"sounds/popup.mp3"
};
function getTitleAnimationClass(titleName){
  if(/雷|銀|火/.test(titleName)) return "title-medal";
  if(/逆転|サプライズ/.test(titleName)) return "title-explosion";
  if(/幸運|ラッキー/.test(titleName)) return "title-lucky";
  if(/不屈|連勝/.test(titleName)) return "title-fire";
  return "title-generic";
}
const popupQueue=[]; let popupActive=false;
function enqueueTitlePopup(playerId,titleObj){ popupQueue.push({playerId,titleObj}); if(!popupActive) processPopupQueue(); }
function processPopupQueue(){
  if(popupQueue.length===0){ popupActive=false; return; }
  popupActive=true;
  const {playerId,titleObj}=popupQueue.shift();
  showTitlePopup(playerId,titleObj);
  setTimeout(processPopupQueue, window.innerWidth<768?1000:window.innerWidth<1200?700:500);
}
function showTitlePopup(playerId, titleObj){
  const unlocked = titleCatalog[titleObj.name]?.unlocked ?? false;
  const popup = document.createElement("div");
  popup.className = "title-popup " + getTitleAnimationClass(titleObj.name);
  const titleName = unlocked ? titleObj.name : "？？？";
  const titleDesc = unlocked ? titleObj.desc : "？？？";
  popup.innerHTML = `<strong>${playerId}</strong><br><strong>${titleName}</strong><br><small>${titleDesc}</small>`;
  document.body.appendChild(popup);
  new Audio(unlocked ? (TITLE_SOUNDS[titleObj.name]||TITLE_SOUNDS.default) : TITLE_SOUNDS.default).play();

  const particleContainer=document.createElement("div");
  particleContainer.className="particle-container";
  document.body.appendChild(particleContainer);

  const particleCount = window.innerWidth < 768 ? 10 : window.innerWidth < 1200 ? 20 : 30;
  for(let i=0;i<particleCount;i++){
    const p=document.createElement("div"); p.className="particle";
    p.style.left=Math.random()*100+"vw";
    p.style.top=Math.random()*100+"vh";
    p.style.animationDuration=(0.5+Math.random()*1.5)+"s";
    p.style.backgroundColor=unlocked?`hsl(${Math.random()*360},80%,60%)`:`hsl(0,0%,70%)`;
    particleContainer.appendChild(p);
  }

  setTimeout(()=>popup.classList.add("show"),50);
  const removePopup=()=>{popup.classList.remove("show"); particleContainer.remove(); setTimeout(()=>popup.remove(),600); popup.removeEventListener("click",removePopup);}
  popup.addEventListener("click",removePopup);
  setTimeout(removePopup,2500);
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
      case "幸運の持ち主":
        const randomTitlesOwned = player.titles.filter(tn => RANDOM_TITLES.includes(tn));
        cond = randomTitlesOwned.length >= 2;
      break;
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
    if(Math.random()<RANDOM_TITLE_PROB[name] && canAssignRandom(player.playerId) && !player.titles.includes(name)){
      player.titles.push(name); updateTitleCatalog(t); enqueueTitlePopup(player.playerId,t); registerRandomAssign(player.playerId);
      titleHistory.push({playerId:player.playerId,title:t.name,date:new Date().toISOString()});
      saveTitleHistory();
    }
  });
}

/* =========================
   称号カタログ描画
========================= */
function updateTitleCatalog(title){
  if(!titleCatalog[title.name]) titleCatalog[title.name]={unlocked:true,desc:title.desc};
  else titleCatalog[title.name].unlocked=true;
  scheduleRenderTitleCatalog();
}
function scheduleRenderTitleCatalog(){
  if(renderScheduled) return;
  renderScheduled=true;
  requestAnimationFrame(()=>{ renderTitleCatalog(); renderScheduled=false; });
}
function renderTitleCatalog(){
  const container=$("#titleCatalog"); if(!container) return;
  container.innerHTML="";
  const cols = window.innerWidth<768?1:window.innerWidth<1024?2:3;
  container.style.display="grid"; container.style.gridTemplateColumns=`repeat(${cols}, minmax(0,1fr))`; container.style.gap="12px";

  ALL_TITLES.forEach(title=>{
    const unlocked = titleCatalog[title.name]?.unlocked??false;
    if((titleFilter==="unlocked"&&!unlocked)||(titleFilter==="locked"&&unlocked)) return;
    if(titleSearch && !title.name.toLowerCase().includes(titleSearch)) return;

    const historyItems=titleHistory.filter(h=>h.title===title.name);
    const latest=historyItems.length?new Date(Math.max(...historyItems.map(h=>new Date(h.date)))):null;
    const dateStr=latest?latest.toLocaleDateString():"";

    const div=document.createElement("div");
    div.className=`title-card ${unlocked?"unlocked":"locked"} ${getTitleAnimationClass(title.name)}`;
    if(unlocked){
      div.innerHTML=`<strong>${title.name}</strong><small>${title.desc}</small>${dateStr?`<small>取得日:${dateStr}</small>`:""}`;
      if(!div.dataset.rendered){ div.classList.add("gain"); div.dataset.rendered="true"; createParticles(div); }
    } else div.innerHTML=`<strong>？？？</strong><small>？？？</small>`;
    container.appendChild(div);
  });
}

/* =========================
   パーティクル生成関数
========================= */
function createParticles(target){
  const particleContainer=document.createElement("div"); particleContainer.className="particle-container";
  target.appendChild(particleContainer);
  const particleCount = window.innerWidth<768?10:window.innerWidth<1200?20:30;
  for(let i=0;i<particleCount;i++){
    const p=document.createElement("div"); p.className="particle";
    p.style.left=`${Math.random()*100}%`;
    p.style.top=`${Math.random()*100}%`;
    p.style.animationDuration=`${0.5+Math.random()*1.5}s`;
    p.style.backgroundColor=`hsl(${Math.random()*360},80%,60%)`;
    particleContainer.appendChild(p);
  }
  setTimeout(()=>particleContainer.remove(),1500);
}

/* =========================
   ランキング処理
========================= */
function processRanking(data){
  data.forEach(p => {
    const prev = playerData.get(p.playerId) || {};
    p.prevRate = prev.rate ?? p.rate;        // 前回レート
    p.prevRank = prev.lastRank ?? 0;        // 前回順位
    p.prevRateRank = prev.prevRateRank ?? 0;

    // rateGain 計算
    p.rateGain = p.rate - p.prevRate;

    // 特別ポイントを変更
    if (p.rateGain === 0) {
      p.bonus = p.rate; // 獲得レートそのまま
    } else {
      p.bonus = prev.bonus ?? p.bonus ?? 0; // それ以外は従来通り
    }
  });
  data.forEach(p=>p.rateGain=p.rate-p.prevRate);
  data.sort((a,b)=>b.rate-a.rate);
  let rank=1;
  data.forEach((p,i)=>{ 
    p.rateRank=i>0&&p.rate===data[i-1].rate?data[i-1].rateRank:rank++;
    p.rank=p.rateRank;
    p.rankChange=(p.prevRank??p.rank)-p.rank;
    p.rateRankChange=(p.prevRateRank??p.rateRank)-p.rateRank;
  });
  data.forEach(p=>playerData.set(p.playerId,{rate:p.rate,lastRank:p.rank,prevRateRank:p.rateRank,bonus:p.bonus,titles:p.titles||[]})); 
  savePlayerData();
  return data.map(p=>({...p,gain:p.rateGain>=0?`+${p.rateGain}`:p.rateGain,rankChangeStr:fmtChange(p.rankChange),rateRankChangeStr:fmtChange(p.rateRankChange)}));
}

/* =========================
   モバイル用 data-label 自動設定
========================= */
function setDataLabelsForMobileTable(){
  const table=document.getElementById("rankingTable"); if(!table) return;
  const headers=Array.from(table.querySelectorAll("thead th")).map(th=>th.textContent.trim());
  table.querySelectorAll("tbody tr").forEach(tr=>{
    tr.querySelectorAll("td").forEach((td,index)=>{
      if(index<headers.length) td.setAttribute("data-label",headers[index]);
    });
  });
}

/* =========================
   ランキング描画
========================= */
function renderRankingTable(data){
  const tbody=$("#rankingTable tbody"); if(!tbody) return;
  tbody.innerHTML="";
  const frag=document.createDocumentFragment();
  data.forEach(p=>{
    const tr=document.createElement("tr"); tr.dataset.playerId=p.playerId;
    if(p.rank<=3) tr.classList.add(`rank-${p.rank}`);
    if(p.rateGain>0) tr.classList.add("gain-up"); else if(p.rateGain<0) tr.classList.add("gain-down");
    tr.innerHTML=`<td>${p.rank}</td><td>${p.playerId}</td><td>${p.rate}</td><td>${p.gain}</td><td>${p.bonus}</td><td>${p.rankChangeStr}</td><td>${p.prevRank??'—'}</td><td class="${p.rank<=3?'title-podium':''}">${p.title||''}</td><td class="admin-only"><button data-playerid="${p.playerId}">削除</button></td>`;
    tr.addEventListener("click",e=>{if(!e.target.closest("button")) showPlayerChart(p.playerId)});
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  attachDeleteButtons();
  setDataLabelsForMobileTable();
}

/* =========================
   CSVダウンロード
========================= */
function downloadCSV(){
  const csv=["順位,生徒ID,総合レート,獲得レート,特別ポイント,順位変動,前回順位,称号"];
  lastProcessedRows.forEach(p=>csv.push([p.rank,escapeCSV(p.playerId),p.rate,p.gain,p.bonus,p.rankChangeStr,p.prevRank??"",escapeCSV(p.title)].join(",")));
  const blob=new Blob([csv.join("\n")],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="ranking.csv"; a.click();
}

/* =========================
   データ取得・更新
========================= */
async function fetchRankingJSON(){
  if(isFetching) return [];
  try{
    isFetching=true;
    const url=new URL(GAS_URL);
    url.searchParams.set("mode","getRanking");
    url.searchParams.set("secret",SECRET_KEY);
    const res=await fetch(url.toString(),{cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json=await res.json();
    if(!json.ranking) throw new Error(json.error||"データなし");
    return Object.entries(json.ranking).map(([playerId,[rate,bonus]])=>({playerId,rate:Number(rate)||0,bonus:Number(bonus)||0}));
  }catch(e){ toast("ランキング取得失敗: "+e.message); return []; }
  finally{ isFetching=false; }
}

async function refreshRanking(){
  const data = await fetchRankingJSON();
  if (!data.length) return;
  const filtered = data.filter(p => !deletedPlayers.has(p.playerId));
  lastProcessedRows = processRanking(filtered);
  lastProcessedRows.forEach(p => assignTitles(p));
  
  // 総合ランキング描画
  renderRankingTable(lastProcessedRows);

  // 変動ランキング描画
  renderChangeRankingTable(lastProcessedRows);

  rankingHistory.push({
    date: new Date().toISOString(),
    snapshot: lastProcessedRows.map(p => ({
      playerId: p.playerId,
      rate: p.rate,
      bonus: p.bonus
    }))
  });
  saveRankingHistory();
}


/* =========================
   自動更新制御
========================= */
function startAutoRefresh(intervalSec=AUTO_REFRESH_INTERVAL){ stopAutoRefresh(); autoRefreshTimer=setInterval(refreshRanking,intervalSec*1000);}
function stopAutoRefresh(){ if(autoRefreshTimer){ clearInterval(autoRefreshTimer); autoRefreshTimer=null;}}
function toggleAutoRefresh(enabled){
  clearInterval(autoRefreshTimer);
  if(enabled){
    const secInput=$("#autoRefreshSec");
    let intervalSec=parseInt(secInput.value,10);
    if(isNaN(intervalSec)||intervalSec<5) intervalSec=5;
    autoRefreshTimer=setInterval(refreshRanking,intervalSec*1000);
    toast(`自動更新ON（${intervalSec}秒間隔）`,1500);
  }else toast("自動更新OFF",1500);
}

/* =========================
   管理者削除ボタン
========================= */
function attachDeleteButtons(){
  document.querySelectorAll("#rankingTable button[data-playerid]").forEach(btn=>{
    btn.onclick=()=>{
      const pid=btn.dataset.playerid; if(!pid) return;
      if(confirm(`本当に ${pid} を削除しますか？`)){
        deletedPlayers.add(pid);
        saveDeletedPlayers();
        lastProcessedRows=lastProcessedRows.filter(p=>p.playerId!==pid);
        renderRankingTable(lastProcessedRows);
        toast(`${pid} を削除しました`);
      }
    };
  });
}

/* =========================
   チャート描画
========================= */
function showPlayerChart(playerId){
  const modal=$("#chartModal"), canvas=$("#chartCanvas"); if(!modal||!canvas) return;
  const history=rankingHistory.map(h=>{ const entry=h.snapshot.find(p=>p.playerId===playerId); return entry?{date:new Date(h.date),rate:entry.rate}:null; }).filter(x=>x!==null);
  if(history.length===0){toast("履歴データなし"); return;}
  const labels=history.map(h=>h.date.toLocaleDateString()+" "+h.date.toLocaleTimeString());
  const rates=history.map(h=>h.rate);
  if(canvas.chartInstance) canvas.chartInstance.destroy();
  canvas.chartInstance=new Chart(canvas,{type:'line',data:{labels,datasets:[{label:playerId+' のレート推移',data:rates,borderColor:'rgba(75,192,192,1)',backgroundColor:'rgba(75,192,192,0.2)',tension:0.3,fill:true,pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true},tooltip:{mode:'index',intersect:false}},scales:{x:{display:true,title:{display:true,text:'日付'}},y:{display:true,title:{display:true,text:'レート'},beginAtZero:false}}}});
  canvas.parentElement.style.overflowX=window.innerWidth<768?"scroll":"visible";
  modal.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  /**
   * 任意のテーブルをフルスクリーンで表示する共通処理
   * @param {string} openBtnId - 開くボタンID
   * @param {string} closeBtnId - 閉じるボタンID
   * @param {string} modalId - モーダル全体ID
   * @param {string} modalTableId - モーダル内のテーブルID
   * @param {string} sourceTableId - 元テーブルID
   */
  function setupFullscreen(openBtnId, closeBtnId, modalId, modalTableId, sourceTableId) {
    const btnOpen = document.getElementById(openBtnId);
    const btnClose = document.getElementById(closeBtnId);
    const modal = document.getElementById(modalId);
    const modalTable = document.getElementById(modalTableId);

    if (!btnOpen || !btnClose || !modal || !modalTable) return;

    // 開く処理
    btnOpen.addEventListener("click", () => {
      const sourceTable = document.getElementById(sourceTableId);
      if (!sourceTable) return;
      modalTable.innerHTML = sourceTable.innerHTML;
      modal.classList.remove("hidden");
    });

    // 閉じる処理
    btnClose.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    // 背景クリックで閉じる
    modal.querySelector(".modal-overlay")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
  }

  // 総合ランキング用
  setupFullscreen(
    "btnOpenFullscreenRanking",
    "btnCloseFullscreenRanking",
    "fullscreenRanking",
    "fullscreenRankingTable",
    "rankingTable"
  );

  // 変動ランキング用
  setupFullscreen(
    "btnOpenFullscreenChange",
    "btnCloseFullscreenChange",
    "fullscreenChangeRanking",
    "fullscreenChangeRankingTable",
    "changeRankingTable"
  );
});

/* =========================
   イベント登録
========================= */
function attachEvents(){
  $("#searchInput")?.addEventListener("input",debounce(e=>{ const term=e.target.value.toLowerCase(); renderRankingTable(lastProcessedRows.filter(p=>p.playerId.toLowerCase().includes(term))); }));
  $("#downloadCSVBtn")?.addEventListener("click",downloadCSV);
  $("#loadRankingBtn")?.addEventListener("click",refreshRanking);
  $("#adminToggleBtn")?.addEventListener("click",()=>{ const pwd=prompt("管理者パスワード"); setAdminMode(pwd===ADMIN_PASSWORD); });
  const autoToggle=$("#autoRefreshToggle"), secInput=$("#autoRefreshSec");
  if(autoToggle) autoToggle.addEventListener("change",e=>toggleAutoRefresh(e.target.checked));
  if(secInput) secInput.addEventListener("input",()=>{ if(autoToggle && autoToggle.checked) toggleAutoRefresh(true); });
  $("#zoomInBtn")?.addEventListener("click",()=>{ fontSize+=2; $("#rankingTable").style.fontSize=fontSize+"px"; $("#zoomLevel").textContent=fontSize+"px"; });
  $("#zoomOutBtn")?.addEventListener("click",()=>{ fontSize=Math.max(10,fontSize-2); $("#rankingTable").style.fontSize=fontSize+"px"; $("#zoomLevel").textContent=fontSize+"px"; });
  $("#chartCloseBtn")?.addEventListener("click",()=>$("#chartModal")?.classList.add("hidden"));
}

/* =========================
   称号フィルター/検索UI
========================= */
function renderTitleFilterControls(){
  const container=document.getElementById("titleCatalogControls"); if(!container) return;
  container.innerHTML=`<input type="text" id="titleSearchInput" placeholder="称号名で検索"><div><button class="filter-btn" data-filter="all">全て</button><button class="filter-btn" data-filter="unlocked">取得済み</button><button class="filter-btn" data-filter="locked">未取得</button></div>`;
  container.querySelectorAll(".filter-btn").forEach(btn=>btn.addEventListener("click",e=>{ titleFilter=e.target.dataset.filter; saveTitleState(); renderTitleCatalog(); }));
  document.getElementById("titleSearchInput")?.addEventListener("input",debounce(e=>{ titleSearch=e.target.value.toLowerCase(); saveTitleState(); renderTitleCatalog(); },200));
}
function initTitleCatalog(){ const parent=document.getElementById("titleCatalog").parentElement; const controls=document.createElement("div"); controls.id="titleCatalogControls"; controls.className="mb-2"; parent.insertBefore(controls,document.getElementById("titleCatalog")); loadTitleState(); renderTitleFilterControls(); renderTitleCatalog(); window.addEventListener("resize",renderTitleCatalog);}
function initTitleCatalogToggle(){ const header=document.getElementById("titleCatalogHeader"); const content=document.getElementById("titleCatalogContent"); if(!header||!content) return; content.hidden=true; header.setAttribute("aria-expanded","false"); if(!header.querySelector(".toggle-icon")){ const icon=document.createElement("span"); icon.className="toggle-icon"; icon.textContent="▼"; icon.style.marginLeft="6px"; header.appendChild(icon);} header.addEventListener("click",()=>{ const isHidden=content.hidden; content.hidden=!isHidden; header.setAttribute("aria-expanded",String(!isHidden)); const icon=header.querySelector(".toggle-icon"); if(icon) icon.textContent=isHidden?"▲":"▼"; content.classList.toggle("open",isHidden); },{once:false});}

/* =========================
   初期化
========================= */
function init(){
  loadPlayerData(); loadDeletedPlayers(); loadRankingHistory();
  dailyRandomCount=loadFromStorage("dailyRandomCount",{}); loadTitleState();
  initTitleCatalogToggle(); initTitleCatalog();
  const savedAdmin=JSON.parse(localStorage.getItem("isAdmin")??"false"); setAdminMode(savedAdmin);
  attachEvents(); refreshRanking(); toast("ランキングシステム初期化完了",1500);
}
window.addEventListener("DOMContentLoaded",init);
