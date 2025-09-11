"use strict";

/* =========================
   設定
========================= */
const GAS_URL = "https://script.google.com/macros/s/AKfycbxnqDdZJPE0BPN5TRpqR49ejScQKyKADygXzw5tcp6RdCauKbeTfeQTWpP6WAKYK7Ue/exec";
const SECRET_KEY = "kosen-brain-super-secret";
const ADMIN_PASSWORD = "babanuki123";
const STORAGE_KEY = "rankingPlayerData_v2";
const DELETED_KEY = "rankingDeletedPlayers";
const HISTORY_KEY = "rankingHistory_v2";
const titleCatalog = {}; 
const assignedRandomTitles = new Set(); // ランダム称号付与済み管理

// ALL_TITLES の順番は重要：上位3位 → 固定称号 → ランダム称号
const ALL_TITLES = [
  {name:"キングババ", condition:p=>p.rank===1, desc:"1位獲得！"},
  {name:"シルバーババ", condition:p=>p.rank===2, desc:"2位獲得！"},
  {name:"ブロンズババ", condition:p=>p.rank===3, desc:"3位獲得！"},
  {name:"逆転の達人", condition:p=>((p.prevRank??p.rank)-p.rank)>=3, desc:"大逆転！"},
  {name:"サプライズ勝利", condition:p=>(p.prevRank??0)===p.currentRankingLength && p.rank===1, desc:"ビリから1位！"},
  {name:"幸運の持ち主", condition:p=>p.noBabaDraw===true, desc:"ババを引かずに勝利"},
  {name:"不屈の挑戦者", condition:p=>p.consecutiveGames>=3, desc:"連続参加3回以上"},
  {name:"レートブースター", condition:p=>p.rateGain===Math.max(...lastProcessedRows.map(x=>x.rateGain)), desc:"今回最大レート獲得"},
  {name:"反撃の鬼", condition:p=>p.prevRank>p.rank && p.rank<=3, desc:"順位上昇で3位以内"},
  {name:"チャンスメーカー", condition:p=>p.bonus===Math.max(...lastProcessedRows.map(x=>x.bonus)), desc:"ボーナスポイント獲得"},
  {name:"ミラクルババ", condition:p=>!assignedRandomTitles.has(p.playerId) && Math.random()<0.1, desc:"奇跡の称号"},
  {name:"連勝街道", condition:p=>p.winStreak>=2, desc:"連勝2回以上"},
  {name:"勝利の方程式", condition:p=>p.rateTrend>=3, desc:"安定上昇中"},
  {name:"挑戦者", condition:p=>p.rank<=5 && p.prevGames===0, desc:"初参加で上位"},
  {name:"エピックババ", condition:p=>p.totalTitles>=5, desc:"称号5個以上獲得"},
  {name:"ババキング", condition:p=>p.rank1Count>=3, desc:"1位を3回獲得"},
  {name:"観察眼", condition:p=>p.maxBonusCount>=3, desc:"ボーナス獲得上位"},
  {name:"運命の番人", condition:p=>p.lastBabaSafe===true, desc:"最後のババ回避成功"},
  {name:"ラッキーババ", condition:p=>!assignedRandomTitles.has(p.playerId) && Math.random()<0.1, desc:"ラッキー称号"},
  {name:"究極のババ", condition:p=>p.titles.length===ALL_TITLES.length-1, desc:"全称号コンプリート直前"}
];

/* =========================
   State
========================= */
let playerData = new Map();
let deletedPlayers = new Set();
let lastProcessedRows = [];
let isAdmin = false;
let rankingHistory = [];
let isFetching = false;
let autoRefreshTimer = null;
let historyChartInstance = null;
let fontSize = 14;

/* =========================
   ユーティリティ
========================= */
const $ = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
function debounce(fn, wait=250){let t; return (...args)=>{clearTimeout(t); t=setTimeout(()=>fn(...args),wait);};}
function fmtChange(val,up="↑",down="↓"){return val>0?`${up}${val}`:val<0?`${down}${-val}`:"—";}
function toast(msg,sec=2500){const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),sec);}
function escapeCSV(s){return `"${String(s).replace(/"/g,'""')}"`;}

/* =========================
   表の拡大・ズーム
========================= */
const zoomLevelDisplay = $("#zoomLevel");
$("#zoomInBtn").addEventListener("click", () => {
  fontSize += 2; $("#rankingTable").style.fontSize = fontSize + "px"; zoomLevelDisplay.textContent = fontSize + "px";
});
$("#zoomOutBtn").addEventListener("click", () => {
  fontSize = Math.max(10, fontSize - 2); $("#rankingTable").style.fontSize = fontSize + "px"; zoomLevelDisplay.textContent = fontSize + "px";
});

/* =========================
   称号管理
========================= */
function updateTitleCatalog(title){
  if(!titleCatalog[title.name]){
    titleCatalog[title.name] = {unlocked:true, desc:title.desc};
  } else titleCatalog[title.name].unlocked = true;
  renderTitleCatalog();
}

function renderTitleCatalog(){
  const container = $("#titleCatalog");
  container.innerHTML="";
  Object.entries(titleCatalog).forEach(([name,info])=>{
    const div = document.createElement("div");
    div.className = "title-card " + (info.unlocked ? "unlocked" : "locked");
    div.textContent = info.unlocked ? `${name} - ${info.desc}` : "？？？";
    container.appendChild(div);
  });
}

const TITLE_SOUNDS = {
  "⚡雷":"sounds/gold.mp3",
  "🌪風":"sounds/silver.mp3",
  "🔥火":"sounds/bronze.mp3",
  "逆転の達人":"sounds/reversal.mp3",
  "サプライズ勝利":"sounds/reversal.mp3",
  "幸運の持ち主":"sounds/lucky.mp3",
  "ラッキーババ":"sounds/lucky.mp3",
  "不屈の挑戦者":"sounds/fire.mp3",
  "連勝街道":"sounds/fire.mp3",
  "default":"sounds/popup.mp3"
};

function getTitleAnimationClass(titleName){
  if(/雷|銀|火/.test(titleName)) return "title-medal";
  if(/逆転|サプライズ/.test(titleName)) return "title-explosion";
  if(/幸運|ラッキー/.test(titleName)) return "title-lucky";
  if(/不屈|連勝/.test(titleName)) return "title-fire";
  return "title-generic";
}

/* =========================
   ポップアップキュー制御
========================= */
const popupQueue = [];
let popupActive = false;

function enqueueTitlePopup(playerId, titleObj){
  popupQueue.push({playerId, titleObj});
  if(!popupActive) processPopupQueue();
}

function processPopupQueue(){
  if(popupQueue.length === 0){ popupActive = false; return; }
  popupActive = true;
  const {playerId, titleObj} = popupQueue.shift();
  showTitlePopup(playerId, titleObj);
  setTimeout(processPopupQueue, 1500); // 1.5秒間隔で次のポップアップ
}

function showTitlePopup(playerId,titleObj){
  const popup=document.createElement("div");
  popup.className="title-popup "+getTitleAnimationClass(titleObj.name);
  popup.innerHTML=`<strong>${playerId}</strong><br><strong>${titleObj.name}</strong><br><small>${titleObj.desc}</small>`;
  document.body.appendChild(popup);

  const audio=new Audio(TITLE_SOUNDS[titleObj.name]||TITLE_SOUNDS.default);
  audio.play();

  const particleContainer=document.createElement("div");
  particleContainer.className="particle-container";
  document.body.appendChild(particleContainer);
  for(let i=0;i<30;i++){
    const p=document.createElement("div");
    p.className="particle";
    p.style.left=Math.random()*100+"vw";
    p.style.top=Math.random()*100+"vh";
    p.style.animationDuration=(0.5+Math.random()*1.5)+"s";
    p.style.backgroundColor=`hsl(${Math.random()*360},100%,50%)`;
    particleContainer.appendChild(p);
  }

  setTimeout(()=>popup.classList.add("show"),50);
  setTimeout(()=>{
    popup.classList.remove("show");
    particleContainer.remove();
    setTimeout(()=>popup.remove(),600);
  },1400); // 1.4秒に短縮でキュー表示と連携
}

/* =========================
   称号付与
========================= */
function assignTitles(player){
  if(!player.titles) player.titles=[];
  player.currentRankingLength = lastProcessedRows.length; // 最新ランキング長を参照

  ALL_TITLES.forEach(t=>{
    if((t.name==="ミラクルババ"||t.name==="ラッキーババ") && assignedRandomTitles.has(player.playerId)) return;
    if(t.condition(player) && !player.titles.includes(t.name)){
      player.titles.push(t.name);
      updateTitleCatalog(t);
      if(t.name==="ミラクルババ"||t.name==="ラッキーババ") assignedRandomTitles.add(player.playerId);
      enqueueTitlePopup(player.playerId, t);
    }
  });
}

/* =========================
   LocalStorage
========================= */
function loadFromStorage(key, fallback){ try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw):fallback; }catch(e){return fallback;} }
function saveToStorage(key,value){ try{ localStorage.setItem(key,JSON.stringify(value)); }catch(e){}}
function loadPlayerData(){ const raw=loadFromStorage(STORAGE_KEY,null); if(raw) playerData=new Map(raw);}
function savePlayerData(){ saveToStorage(STORAGE_KEY,Array.from(playerData.entries()));}
function loadDeletedPlayers(){ deletedPlayers=new Set(loadFromStorage(DELETED_KEY,[]));}
function saveDeletedPlayers(){ saveToStorage(DELETED_KEY,Array.from(deletedPlayers));}
function loadRankingHistory(){ rankingHistory=loadFromStorage(HISTORY_KEY,[]);}
function saveRankingHistory(){ saveToStorage(HISTORY_KEY,rankingHistory);}

/* =========================
   管理者モード
========================= */
function setAdminMode(enabled){
  isAdmin=Boolean(enabled);
  $$("th.admin-only,td.admin-only").forEach(el=>el.style.display=isAdmin?"table-cell":"none");
}

/* =========================
   ランキング計算
========================= */
function processRanking(data){
  data.forEach(p=>{ const prev=playerData.get(p.playerId)||{}; p.prevRate=prev.rate??p.rate; p.prevRank=prev.lastRank??0; p.prevRateRank=prev.prevRateRank??0; p.bonus=prev.bonus??p.bonus??0; });
  data.forEach(p=>p.rateGain=p.rate-p.prevRate);
  data.sort((a,b)=>b.rate-a.rate);
  let rank=1;
  data.forEach((p,i)=>{ 
    p.rateRank=i>0&&p.rate===data[i-1].rate?data[i-1].rateRank:rank++;
    p.rank=p.rateRank;
    p.rankChange=(p.prevRank??p.rank)-p.rank;
    p.rateRankChange=(p.prevRateRank??p.rateRank)-p.rateRank;
  });

  // 上位3位の称号はALL_TITLESから自動取得
  const podiumTitles = ALL_TITLES.slice(0,3).map(t=>t.name);
  data.forEach((p,i)=>{
    p.title = i<podiumTitles.length ? podiumTitles[i] : "";
  });

  data.forEach(p=>playerData.set(p.playerId,{rate:p.rate,lastRank:p.rank,prevRateRank:p.rateRank,bonus:p.bonus,titles:p.titles||[]}));
  savePlayerData();
  return data.map(p=>({...p,gain:p.rateGain>=0?`+${p.rateGain}`:p.rateGain,rankChangeStr:fmtChange(p.rankChange),rateRankChangeStr:fmtChange(p.rateRankChange)}));
}

/* =========================
   描画
========================= */
function renderRankingTable(data){
  const tbody=$("#rankingTable tbody");
  tbody.innerHTML="";
  const frag=document.createDocumentFragment();
  data.forEach(p=>{
    const tr=document.createElement("tr");
    tr.dataset.playerId=p.playerId;
    if(p.rank<=3) tr.classList.add(`rank-${p.rank}`);
    if(p.rateGain>0) tr.classList.add("gain-up"); else if(p.rateGain<0) tr.classList.add("gain-down");
    tr.innerHTML=`
      <td>${p.rank}</td>
      <td>${p.playerId}</td>
      <td>${p.rate}</td>
      <td>${p.gain}</td>
      <td>${p.bonus}</td>
      <td>${p.rankChangeStr}</td>
      <td>${p.prevRank??'—'}</td>
      <td class="${p.rank<=3?'title-podium':''}">${p.title}</td>
      <td class="admin-only"><button data-playerid="${p.playerId}" class="bg-red-500 text-white px-2 py-1 rounded">削除</button></td>
    `;
    tr.addEventListener("click",e=>{ if(!e.target.closest("button")) showPlayerChart(p.playerId); });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

/* =========================
   データ取得
========================= */
async function fetchRankingJSON(){
  try{
    isFetching=true;
    const res=await fetch(`${GAS_URL}?mode=getRanking`,{cache:"no-store"});
    if(!res.ok) throw new Error(res.status);
    const json=await res.json();
    if(!json.ranking) throw new Error("データなし");
    return Object.entries(json.ranking).map(([id,[rate,bonus]])=>({playerId:id,rate:Number(rate)||0,bonus:Number(bonus)||0}));
  }catch(e){ toast("取得失敗:"+e.message); return []; } finally{ isFetching=false; }
}

async function refreshRanking() {
  if (isFetching) return;
  try {
    isFetching = true;
    const data = await fetchRankingJSON();
    const filtered = data.filter(p => !deletedPlayers.has(p.playerId));
    lastProcessedRows = processRanking(filtered);
    lastProcessedRows.forEach(player => assignTitles(player));
    renderRankingTable(lastProcessedRows);
    rankingHistory.push({ date:new Date().toISOString(), snapshot:lastProcessedRows.map(p=>({playerId:p.playerId,rate:p.rate,bonus:p.bonus})) });
    saveRankingHistory();
  } catch(e){ toast("ランキング更新に失敗しました: "+e.message); }
  finally{ isFetching=false; }
}

/* =========================
   CSV出力
========================= */
function downloadCSV(){
  const csv=["順位,生徒ID,総合レート,獲得レート,特別ポイント,順位変動,前回順位,称号"];
  lastProcessedRows.forEach(p=>csv.push([p.rank,escapeCSV(p.playerId),p.rate,p.gain,p.bonus,p.rankChangeStr,p.prevRank??"",escapeCSV(p.title)].join(",")));
  const blob=new Blob([csv.join("\n")],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="ranking.csv"; a.click();
}

/* =========================
   モーダル・イベント
========================= */
function attachModalControls(){
  const modal=$("#chartModal");
  const close=$("#chartCloseBtn");
  close.addEventListener("click",()=>modal.classList.add("hidden"));
}

function attachEvents(){
  $("#searchInput").addEventListener("input",debounce(e=>{
    const term=e.target.value.toLowerCase();
    renderRankingTable(lastProcessedRows.filter(p=>p.playerId.toLowerCase().includes(term)));
  }));
  $("#downloadCSVBtn").addEventListener("click",()=>downloadCSV());
  $("#loadRankingBtn").addEventListener("click",()=>refreshRanking());
  $("#adminToggleBtn").addEventListener("click",()=>{
    const pwd=prompt("管理者パスワード");
    setAdminMode(pwd===ADMIN_PASSWORD);
  });
  $("#autoRefreshToggle").addEventListener("change",e=>{
    if(e.target.checked){ const sec=$("#autoRefreshSec").value||30; autoRefreshTimer=setInterval(refreshRanking,sec*1000); }
    else clearInterval(autoRefreshTimer);
  });
}

/* =========================
   初期化
========================= */
function init(){
  loadPlayerData();
  loadDeletedPlayers();
  loadRankingHistory();
  attachEvents();
  attachModalControls();
  refreshRanking();
}

document.addEventListener("DOMContentLoaded",init);
