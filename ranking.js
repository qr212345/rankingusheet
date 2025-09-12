"use strict";

/* =========================
   設定・定数
========================= */
const GAS_URL = "https://script.google.com/macros/s/AKfycbziDjHG_Gu7fC4LyVwOESAfROAcB7TmjFBhuDaQXRDqHRkm0JwaYLCXEBrqc4pDcDc/exec";
const ADMIN_PASSWORD = "babanuki123";
const STORAGE_KEY = "rankingPlayerData_v4";
const DELETED_KEY = "rankingDeletedPlayers";
const HISTORY_KEY = "rankingHistory_v4";
const TITLE_HISTORY_KEY = "titleHistory_v4";
const AUTO_REFRESH_INTERVAL = 30;

const RANDOM_TITLES = ["ミラクルババ","ラッキーババ"];
const RANDOM_TITLE_PROB = { "ミラクルババ":0.05, "ラッキーババ":0.10 };
const RANDOM_TITLE_DAILY_LIMIT = 5;

const SECRET_KEY = "your-secret-key";

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
let playerData = new Map();
let deletedPlayers = new Set();
let lastProcessedRows = [];
let rankingHistory = [];
let titleHistory = [];
let isAdmin = false;
let autoRefreshTimer = null;
let volume = 1.0;
let notificationEnabled = true;
let titleFilter = "all";
let titleSearch = "";
const titleCatalog = {};
const assignedRandomTitles = new Set();
let dailyRandomCount = {};
let renderScheduled = false;
let isFetching = false;

/* =========================
   DOM & Utility
========================= */
const $ = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
function debounce(fn, wait=250){let t; return (...args)=>{clearTimeout(t); t=setTimeout(()=>fn(...args),wait);};}
function fmtChange(val,up="↑",down="↓"){return val>0?`${up}${val}`:val<0?`${down}${-val}`:"—";}
function toast(msg,sec=2500){if(!notificationEnabled) return; const t=$("#toast"); if(t){ t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),sec); }}
function escapeCSV(s){return `"${String(s).replace(/"/g,'""')}"`;}

/* =========================
   Storage管理
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
function saveVolumeSetting(){ saveToStorage("volumeSetting", volume); }
function loadVolumeSetting(){ volume = loadFromStorage("volumeSetting", 1.0); }
function saveNotificationSetting(){ saveToStorage("notificationEnabled", notificationEnabled); }
function loadNotificationSetting(){ notificationEnabled = loadFromStorage("notificationEnabled", true); }

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
   ランキング処理（GASヘッダなし対応）
========================= */

/* =========================
   GAS 称号・ランキング取得/保存
   ヘッダなし + SECRET_KEY対応
========================= */
async function fetchTitleDataFromGAS() {
  try {
    // SECRET_KEYで認証
    const res = await fetch(`${GAS_URL}?mode=getTitles&secret=${SECRET_KEY}`, { cache: "no-cache" });
    const data = await res.json();
    if (data.titles) {
      data.titles.forEach(entry => {
        const prev = playerData.get(entry.playerId) || {};
        prev.titles = entry.titles || [];
        playerData.set(entry.playerId, prev);
      });
    }
  } catch (e) {
    console.error("GASから称号取得失敗", e);
  }
}

async function saveTitleDataToGAS() {
  try {
    const payload = {
      mode: "updateTitles",
      secret: SECRET_KEY,
      titles: Array.from(playerData.entries()).map(([playerId, data]) => ({
        playerId,
        titles: data.titles || []
      }))
    };
    await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("GASへの称号保存失敗", e);
  }
}

/* =========================
   ランキング取得・処理
   - GASからランキング取得（SECRET_KEY認証）
   - 称号データとマージ
   - 称号付与・描画・永続化
========================= */
/* =========================
   ランキング取得・処理
   - GASからランキング取得（SECRET_KEY認証）
   - 称号データとマージ
   - 称号付与・描画・永続化
   - 空データや異常値に対応
========================= */
async function fetchRankingData() {
  if (isFetching) return;
  isFetching = true;

  try {
    // ① GASからランキング取得
    const res = await fetch(`${GAS_URL}?mode=getRanking&secret=${SECRET_KEY}`, {
      cache: "no-cache"
    });

    if (!res.ok) throw new Error(`GASリクエスト失敗: ${res.status} ${res.statusText}`);

    const json = await res.json();

    // ② データ形式のバリデーション
    let rankingArray = [];
    if (Array.isArray(json)) {
      rankingArray = json;
    } else if (Array.isArray(json.ranking)) {
      rankingArray = json.ranking;
    } else if (json.ranking && typeof json.ranking === "object") {
      rankingArray = Object.values(json.ranking);
    } else {
      console.warn("ランキングデータなし。処理をスキップします。", json);
      return; // 安全に抜ける
    }

    if (rankingArray.length === 0) {
      console.warn("ランキング配列が空です。処理をスキップします。");
      return; // 描画処理をスキップしてUI崩れを防ぐ
    }

    // ③ ランキング整形・計算
    const processed = processRanking(rankingArray);

    // ④ 称号データをGASから取得してマージ
    await fetchTitleDataFromGAS();
    processed.forEach(player => {
      const saved = playerData.get(player.playerId);
      if (saved?.titles) player.titles = saved.titles;
    });

    lastProcessedRows = processed;

    // ⑤ 称号付与・ポップアップ表示
    processed.forEach(p => assignTitles(p));

    // ⑥ 描画
    renderRankingTable(processed);
    renderTopCharts(processed);
    scheduleRenderTitleCatalog();

    // ⑦ 永続化（GAS + localStorage）
    await saveTitleDataToGAS();
    saveTitleHistory();
    savePlayerData();

  } catch (e) {
    console.error("fetchRankingData 失敗:", e);
    toast("ランキング更新に失敗しました");
  } finally {
    isFetching = false;
  }
}

/* =========================
   ランキング計算（rateRank, rankChange, rateChange, bonus）
========================= */
function processRanking(data){
  data.forEach(p=>{
    const prev=playerData.get(p.playerId)||{};
    p.prevRate=prev.rate??p.rate;
    p.prevRank=prev.lastRank??p.rank;
    p.prevRateRank=prev.prevRateRank??0;

    // ボーナスポイント: 前回と順位が同じなら獲得レート
    p.bonus=(p.prevRank===p.rank)?(p.rate-p.prevRate):p.rate;
  });

  // レート順位計算
  data.sort((a,b)=>b.rate-a.rate);
  let rank=1;
  data.forEach((p,i)=>{
    p.rateRank=(i>0 && p.rate===data[i-1].rate)?data[i-1].rateRank:rank++;
    p.rankChange=(p.prevRank??p.rank)-p.rank;
    p.rateRankChange=(p.prevRateRank??p.rateRank)-p.rateRank;
  });

  data.forEach(p=>{
    const prev=playerData.get(p.playerId)||{};
    playerData.set(p.playerId,{
      rate: p.rate,
      lastRank: p.rank,
      prevRateRank: p.rateRank,
      bonus: p.bonus,
      titles: prev.titles??[]
    });
  });

  savePlayerData();
  return data.map(p=>({...p}));
}

/* =========================
   称号付与・描画関連
   （省略なし・以前のJSコードをすべて統合）
========================= */
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
  const audio = new Audio(unlocked ? (TITLE_SOUNDS[titleObj.name]||TITLE_SOUNDS.default) : TITLE_SOUNDS.default);
  audio.volume = volume; audio.play();

  // パーティクル生成
  const particleContainer=document.createElement("div"); particleContainer.className="particle-container";
  document.body.appendChild(particleContainer);
  const particleCount = window.innerWidth < 768 ? 10 : window.innerWidth<1200 ? 20 : 30;
  for(let i=0;i<particleCount;i++){
    const p=document.createElement("div"); p.className="particle";
    p.style.left=Math.random()*100+"vw";
    p.style.top=Math.random()*100+"vh";
    p.style.animationDuration=(0.5+Math.random()*1.5)+"s";
    p.style.backgroundColor=unlocked?`hsl(${Math.random()*360},80%,60%)`:`hsl(0,0%,70%)`;
    particleContainer.appendChild(p);
  }

  setTimeout(()=>popup.classList.add("show"),50);
  const removePopup=()=>{ popup.classList.remove("show"); particleContainer.remove(); setTimeout(()=>popup.remove(),600); popup.removeEventListener("click",removePopup); }
  popup.addEventListener("click",removePopup);
  setTimeout(removePopup,2500);
}

/* =========================
   称号付与・履歴
========================= */
function assignTitles(player) {
  if (!player.titles) player.titles = [];
  player.currentRankingLength = lastProcessedRows.length;

  const prevData = playerData.get(player.playerId) || {};
  player.consecutiveGames = (prevData.consecutiveGames ?? 0) + 1;
  player.prevGames = prevData.prevGames ?? 0;
  player.totalTitles = prevData.titles?.length ?? 0;

  const podiumTitles = ["キングババ","シルバーババ","ブロンズババ"];
  if (player.rank <= 3) {
    const title = podiumTitles[player.rank-1];
    if (!player.titles.includes(title)) {
      player.titles.push(title);
      const t = ALL_TITLES.find(tt => tt.name === title);
      updateTitleCatalog(t);
      enqueueTitlePopup(player.playerId, t);
      titleHistory.push({playerId: player.playerId, title: t.name, date: new Date().toISOString()});
    }
  }

  // 固定称号条件チェック
  const FIXED_TITLES = ALL_TITLES.filter(t => !podiumTitles.includes(t.name) && !RANDOM_TITLES.includes(t.name));
  const maxRateGain = Math.max(...lastProcessedRows.map(x => x.rateGain));
  const maxBonus = Math.max(...lastProcessedRows.map(x => x.bonus));

  FIXED_TITLES.forEach(t => {
    let cond = false;
    switch(t.name){
      case "逆転の達人": cond = ((player.prevRank ?? player.rank) - player.rank) >= 3; break;
      case "サプライズ勝利": cond = (player.prevRank ?? player.currentRankingLength) === player.currentRankingLength && player.rank === 1; break;
      case "幸運の持ち主": cond = player.titles.filter(tn => RANDOM_TITLES.includes(tn)).length >= 2; break;
      case "不屈の挑戦者": cond = player.consecutiveGames >= 3; break;
      case "レートブースター": cond = player.rateGain === maxRateGain; break;
      case "反撃の鬼": cond = (player.prevRank ?? player.rank) > player.rank && player.rank <= 3; break;
      case "チャンスメーカー": cond = player.bonus === maxBonus; break;
      case "連勝街道": cond = player.winStreak >= 2; break;
      case "勝利の方程式": cond = player.rateTrend >= 3; break;
      case "挑戦者": cond = player.prevGames === 0 && player.rank <= 5; break;
      case "エピックババ": cond = player.totalTitles >= 5; break;
      case "ババキング": cond = player.rank1Count >= 3; break;
      case "観察眼": cond = player.maxBonusCount >= 3; break;
      case "運命の番人": cond = player.lastBabaSafe === true; break;
      case "究極のババ": cond = player.titles.filter(tn => FIXED_TITLES.map(ft=>ft.name).includes(tn)).length === FIXED_TITLES.length; break;
    }
    if(cond && !player.titles.includes(t.name)){
      player.titles.push(t.name);
      updateTitleCatalog(t);
      enqueueTitlePopup(player.playerId, t);
      titleHistory.push({playerId: player.playerId, title: t.name, date: new Date().toISOString()});
    }
  });

  // ランダム称号
  RANDOM_TITLES.forEach(name => {
    const t = ALL_TITLES.find(tt => tt.name === name);
    if(Math.random() < RANDOM_TITLE_PROB[name] && canAssignRandom(player.playerId) && !player.titles.includes(name)){
      player.titles.push(name);
      updateTitleCatalog(t);
      enqueueTitlePopup(player.playerId, t);
      registerRandomAssign(player.playerId);
      titleHistory.push({playerId: player.playerId, title: t.name, date: new Date().toISOString()});
    }
  });

  // playerData更新
  playerData.set(player.playerId,{
    ...prevData,
    rate: player.rate,
    lastRank: player.rank,
    prevRateRank: player.rateRank,
    bonus: player.bonus,
    titles: player.titles,
    consecutiveGames: player.consecutiveGames,
    prevGames: player.prevGames
  });
  savePlayerData();
}

/* =========================
   称号カタログ描画・裏面回転アニメ
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
  const cols = window.innerWidth<480?1:window.innerWidth<768?2:window.innerWidth<1024?3:4;
  container.style.display="grid"; container.style.gridTemplateColumns=`repeat(${cols}, minmax(0,1fr))`; container.style.gap="12px";

  ALL_TITLES.forEach(title=>{
    const unlocked = titleCatalog[title.name]?.unlocked??false;
    if((titleFilter==="unlocked"&&!unlocked)||(titleFilter==="locked"&&unlocked)) return;
    if(titleSearch && !title.name.toLowerCase().includes(titleSearch.toLowerCase())) return;

    const historyItems=titleHistory.filter(h=>h.title===title.name);
    const latest=historyItems.length?new Date(Math.max(...historyItems.map(h=>new Date(h.date)))):null;
    const dateStr=latest?latest.toLocaleDateString():"";

    const cardContainer=document.createElement("div"); cardContainer.className="title-card-container";
    const card=document.createElement("div"); card.className="title-card";
    const front=document.createElement("div"); front.className="front";
    front.innerHTML=`<strong>？？？</strong><small>？？？</small>`; front.title=title.desc;
    const back=document.createElement("div"); back.className="back "+getRarityClass(title.name);
    back.innerHTML=`<strong>${title.name}</strong><small>${title.desc}</small>${dateStr?`<small>取得日:${dateStr}</small>`:""}`;

    card.appendChild(front); card.appendChild(back); cardContainer.appendChild(card); container.appendChild(cardContainer);

    if(unlocked && !card.dataset.rendered){
      card.classList.add("gain"); card.dataset.rendered="true";
      createParticles(cardContainer);
    }

    card.addEventListener("click",()=>showTitleDetailPopup(title));
  });
}

function getRarityClass(titleName){
  if(/キング|ラッキー|究極/.test(titleName)) return "rare-rainbow";
  if(/シルバー/.test(titleName)) return "rare-silver";
  if(/ブロンズ/.test(titleName)) return "rare-bronze";
  return "rare-gold";
}

function showTitleDetailPopup(title){
  const overlay=document.createElement("div"); overlay.className="title-detail-overlay";
  overlay.innerHTML=`<div class="title-detail-popup"><h3>${title.name}</h3><p>${title.desc}</p><button id="closeTitleDetail">閉じる</button></div>`;
  document.body.appendChild(overlay);
  $("#closeTitleDetail").addEventListener("click",()=>overlay.remove());
}

/* =========================
   パーティクル生成関数
========================= */
function createParticles(target){
  const particleContainer=document.createElement("div"); particleContainer.className="particle-container";
  target.appendChild(particleContainer);
  const particleCount = window.innerWidth<480?10:window.innerWidth<768?15:window.innerWidth<1200?20:30;
  for(let i=0;i<particleCount;i++){
    const p=document.createElement("div"); p.className="particle";
    p.style.left=`${Math.random()*100}%`; p.style.top=`${Math.random()*100}%`;
    p.style.animationDuration=`${0.5+Math.random()*1.5}s`;
    p.style.backgroundColor=`hsl(${Math.random()*360},80%,60%)`;
    particleContainer.appendChild(p);
  }
  setTimeout(()=>particleContainer.remove(),1500);
}

/* =========================
   テーブル描画・CSV・チャート
========================= */
function renderRankingTable(data){
  const tbody = $("#rankingTable tbody");
  if(!tbody) return;

  // 空データチェック
  if(!Array.isArray(data) || data.length === 0){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center">ランキングデータがありません</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  data.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.rank ?? "-"}</td>
      <td>${p.playerId ?? "-"}</td>
      <td>${p.rate ?? "-"}</td>
      <td>${fmtChange(p.rankChange)}</td>
      <td>${fmtChange(p.rateRankChange)}</td>
      <td>${Array.isArray(p.titles) ? p.titles.join(", ") : ""}</td>
      ${isAdmin ? `<td class="admin-only"><button data-id="${p.playerId ?? ""}">削除</button></td>` : ""}
    `;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

/* =========================
   CSV出力
========================= */
function exportCSV(data){
  const header=["Rank","PlayerId","Rate","RankChange","RateRankChange","Titles"];
  const csv=[header.join(",")].concat(data.map(p=>[p.rank,p.playerId,p.rate,p.rankChange,p.rateRankChange,(p.titles||[]).join(";")].map(escapeCSV).join(","))).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`ranking_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* =========================
   上昇TOP・下降TOP描画（Chart.js）
========================= */
function renderTopCharts(data){
  if(!Array.isArray(data) || data.length === 0){
    if(window.chartUp) window.chartUp.destroy();
    if(window.chartDown) window.chartDown.destroy();
    return;
  }

  const topUp = [...data].sort((a,b)=>b.rankChange-a.rankChange).slice(0,10);
  const topDown = [...data].sort((a,b)=>a.rankChange-b.rankChange).slice(0,10);

  const ctxUp = $("#chartTopUp")?.getContext("2d");
  const ctxDown = $("#chartTopDown")?.getContext("2d");
  if(!ctxUp || !ctxDown) return;

  if(window.chartUp) window.chartUp.destroy();
  if(window.chartDown) window.chartDown.destroy();

  window.chartUp = new Chart(ctxUp,{
    type: "bar",
    data: {
      labels: topUp.map(p => p.playerId ?? "-"),
      datasets: [{
        label: "上昇TOP",
        data: topUp.map(p => p.rankChange ?? 0),
        backgroundColor: "hsl(120,80%,60%)"
      }]
    },
    options: { responsive:true, maintainAspectRatio:false }
  });

  window.chartDown = new Chart(ctxDown,{
    type: "bar",
    data: {
      labels: topDown.map(p => p.playerId ?? "-"),
      datasets: [{
        label: "下降TOP",
        data: topDown.map(p => p.rankChange ?? 0),
        backgroundColor: "hsl(0,80%,60%)"
      }]
    },
    options: { responsive:true, maintainAspectRatio:false }
  });
}

/* =========================
   自動更新
========================= */
function startAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); autoRefreshTimer=setInterval(fetchRankingData,AUTO_REFRESH_INTERVAL*1000);}
function stopAutoRefresh(){ if(autoRefreshTimer){ clearInterval(autoRefreshTimer); autoRefreshTimer=null;}}

/* =========================
   初期化
========================= */
function init(){
  loadPlayerData(); loadDeletedPlayers(); loadRankingHistory(); loadTitleState();
  loadVolumeSetting(); loadNotificationSetting();
  setAdminMode(JSON.parse(localStorage.getItem("isAdmin")||"false"));
  fetchRankingData(); startAutoRefresh();
  window.addEventListener("resize",debounce(()=>scheduleRenderTitleCatalog(),200));
}

document.addEventListener("DOMContentLoaded",()=>init());
