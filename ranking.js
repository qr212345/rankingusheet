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
let playerData = new Map(); // playerId -> playerState object
let deletedPlayers = new Set();
let lastProcessedRows = []; // last processed ranking array (with computed fields)
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
let dailyRandomCount = {}; // { "YYYY-MM-DD": count }
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

function loadPlayerData(){
  const raw = loadFromStorage(STORAGE_KEY, null);
  if(raw && Array.isArray(raw)){
    playerData = new Map(raw);
  } else {
    playerData = new Map();
  }
  // ensure every player has required fields (defensive)
  for(const [id, p] of playerData.entries()){
    playerData.set(id, normalizeStoredPlayer(p));
  }
}
function savePlayerData(){ try{ saveToStorage(STORAGE_KEY, Array.from(playerData.entries())); }catch(e){console.error("savePlayerData error", e);} }

function normalizeStoredPlayer(p){
  // Ensure all expected fields exist (backwards compatibility)
  return {
    rate: p.rate ?? 0,
    lastRank: p.lastRank ?? null,
    prevRateRank: p.prevRateRank ?? 0,
    bonus: p.bonus ?? 0,
    titles: Array.isArray(p.titles)?p.titles:[],
    consecutiveGames: p.consecutiveGames ?? 0,
    prevGames: p.prevGames ?? 0,
    rateGain: p.rateGain ?? 0,
    winStreak: p.winStreak ?? 0,
    rateTrend: p.rateTrend ?? 0,
    rank1Count: p.rank1Count ?? 0,
    maxBonusCount: p.maxBonusCount ?? 0,
    lastBabaSafe: p.lastBabaSafe ?? false,
    // keep any other fields
    ...p
  };
}

function loadDeletedPlayers(){ deletedPlayers=new Set(loadFromStorage(DELETED_KEY,[])); }
function saveDeletedPlayers(){ saveToStorage(DELETED_KEY,Array.from(deletedPlayers)); }
function loadRankingHistory(){ rankingHistory=loadFromStorage(HISTORY_KEY,[]); }
function saveRankingHistory(){ saveToStorage(HISTORY_KEY,rankingHistory); }
function loadTitleHistory(){ titleHistory=loadFromStorage(TITLE_HISTORY_KEY,[]); }
function saveTitleHistory(){ saveToStorage(TITLE_HISTORY_KEY,titleHistory); }
function saveTitleState(){ saveToStorage("titleFilter", titleFilter); saveToStorage("titleSearch", titleSearch); }
function loadTitleState(){ titleFilter = loadFromStorage("titleFilter", "all"); titleSearch = loadFromStorage("titleSearch", ""); }
function saveVolumeSetting(){ saveToStorage("volumeSetting", volume); }
function loadVolumeSetting(){ volume = loadFromStorage("volumeSetting", 1.0); }
function saveNotificationSetting(){ saveToStorage("notificationEnabled", notificationEnabled); }
function loadNotificationSetting(){ notificationEnabled = loadFromStorage("notificationEnabled", true); }
function loadDailyRandomCount(){ dailyRandomCount = loadFromStorage("dailyRandomCount", {}); }
function saveDailyRandomCount(){ saveToStorage("dailyRandomCount", dailyRandomCount); }

/* =========================
   管理者モード
========================= */
function setAdminMode(enabled){
  isAdmin = Boolean(enabled);
  localStorage.setItem("isAdmin", JSON.stringify(isAdmin));

  // 管理者専用列・ボタンの表示切替
  $$("th.admin-only, td.admin-only").forEach(el => el.style.display = isAdmin ? "table-cell" : "none");

  // 称号初期化ボタンの表示切替
  const resetBtn = document.getElementById("resetLocalBtn");
  if(resetBtn) resetBtn.style.display = isAdmin ? "inline-block" : "none";

  // 管理者モード切替ボタンのテキスト反映
  const toggleBtn = document.getElementById("toggleAdminBtn");
  if(toggleBtn) toggleBtn.textContent = isAdmin ? "管理者モード解除" : "管理者モード切替";

  // ランキングテーブル内の削除ボタン表示制御
  $$("button[data-id]").forEach(btn => btn.style.display = isAdmin ? "inline-block" : "none");
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
  saveDailyRandomCount();
}

/* =========================
   GAS 称号・ランキング取得/保存
   ヘッダなし + SECRET_KEY対応
========================= */
async function fetchTitleDataFromGAS() {
  try {
    // GETでクエリパラメータに secret を付けるだけ
    const url = `${GAS_URL}?mode=getTitles&secret=${SECRET_KEY}`;
    const res = await fetch(url, { cache: "no-cache" }); // headersは付けない
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (data && Array.isArray(data.titles)) {
      data.titles.forEach(entry => {
        const prev = playerData.get(entry.playerId) || {};
        prev.titles = entry.titles || [];
        playerData.set(entry.playerId, normalizeStoredPlayer(prev));
      });
      savePlayerData();
    }
  } catch (e) {
    console.warn("GASから称号取得失敗", e);
  }
}


async function saveTitleDataToGAS() {
  try {
    // 簡易的に GET で渡す場合（URL長に注意）
    const params = new URLSearchParams();
    params.append('mode', 'updateTitles');
    params.append('secret', SECRET_KEY);
    params.append('titles', JSON.stringify(Array.from(playerData.entries()).map(([playerId, data]) => ({
      playerId,
      titles: data.titles || []
    }))));

    const res = await fetch(`${GAS_URL}?${params.toString()}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    console.log("GASへ称号保存成功");
  } catch (e) {
    console.error("GASへの称号保存失敗", e);
  }
}


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
    const res = await fetch(`${GAS_URL}?mode=getRanking&secret=${SECRET_KEY}`, {
      cache: "no-cache"
    });

    if (!res.ok) throw new Error(`GASリクエスト失敗: ${res.status} ${res.statusText}`);

    const json = await res.json();

    // validate: we expect an array of player objects
    let rankingArray = [];
    if (Array.isArray(json)) rankingArray = json;
    else if (Array.isArray(json.ranking)) rankingArray = json.ranking;
    else if (json.ranking && typeof json.ranking === "object") rankingArray = Object.values(json.ranking);
    else {
      console.warn("ランキングデータの形式不明", json);
      isFetching = false;
      return;
    }

    if (rankingArray.length === 0) {
      console.warn("ランキング配列が空です。描画をスキップします。");
      renderRankingTable([]);
      renderTopCharts([]);
      isFetching = false;
      return;
    }

    // process ranking: calculate rankChange, rateGain, bonus, etc.
    const processed = processRanking(rankingArray);

    // merge titles from stored playerData
    await fetchTitleDataFromGAS();
    processed.forEach(player => {
      const saved = playerData.get(player.playerId);
      if (saved?.titles) player.titles = Array.from(new Set([...(player.titles||[]), ...saved.titles]));
    });

    lastProcessedRows = processed;

    // assign titles (this will update playerData and titleHistory)
    processed.forEach(p => assignTitles(p));

    // render
    renderRankingTable(processed);
    renderTopCharts(processed);
    scheduleRenderTitleCatalog();

    // persist
    await saveTitleDataToGAS();
    saveTitleHistory();
    savePlayerData();
    saveRankingHistory();

  } catch (e) {
    console.error("fetchRankingData 失敗:", e);
    toast("ランキング更新に失敗しました");
  } finally {
    isFetching = false;
  }
}

/* =========================
   ランキング計算（rateRank, rankChange, rateChange, bonus）
   ここで rateGain, bonus, rateRank などを確実に計算・初期化
========================= */
function processRanking(data){
  // defensive copy
  const arr = data.map(p => Object.assign({}, p));

  // ensure standard fields exist
  arr.forEach(p => {
    p.playerId = p.playerId ?? (p.id ?? "unknown");
    p.rank = Number.isFinite(p.rank) ? p.rank : null;
    p.rate = Number.isFinite(p.rate) ? Number(p.rate) : 0;
    p.bonus = Number.isFinite(p.bonus) ? Number(p.bonus) : 0; // may be computed below
    p.titles = Array.isArray(p.titles) ? p.titles : [];
  });

  // attach previous data & compute basic deltas
  arr.forEach(p => {
    const prev = playerData.get(p.playerId) || {};
    p.prevRate = prev.rate ?? p.rate;
    p.prevRank = prev.lastRank ?? p.rank;
    p.prevRateRank = prev.prevRateRank ?? 0;

    // rateGain: now - prev
    p.rateGain = (p.rate ?? 0) - (prev.rate ?? p.rate ?? 0);

    // bonus: define as same-rank bonus: example business rule:
    // if rank unchanged => bonus = gained rate; else bonus = p.rate (fallback)
    p.bonus = (p.prevRank === p.rank) ? (p.rate - (prev.rate ?? p.rate)) : (p.bonus ?? 0);
    if (!Number.isFinite(p.bonus)) p.bonus = 0;
  });

  // compute rateRank (by rate desc)
  arr.sort((a,b)=> (b.rate ?? 0) - (a.rate ?? 0));
  let rankCounter = 1;
  arr.forEach((p,i)=>{
    if (i>0 && p.rate === arr[i-1].rate) p.rateRank = arr[i-1].rateRank;
    else p.rateRank = rankCounter++;
  });

  // compute rankChange & rateRankChange
  arr.forEach(p=>{
    p.rankChange = (p.prevRank ?? p.rank) - (p.rank ?? 0);
    p.rateRankChange = (p.prevRateRank ?? p.rateRank) - (p.rateRank ?? 0);
  });

  // update playerData base record with computed baseline (but keep other stats)
  arr.forEach(p=>{
    const prev = playerData.get(p.playerId) || {};
    playerData.set(p.playerId, normalizeStoredPlayer({
      ...prev,
      rate: p.rate,
      lastRank: p.rank,
      prevRateRank: p.rateRank,
      bonus: p.bonus,
      // preserve titles until assignTitles runs
      titles: prev.titles ?? p.titles ?? []
    }));
  });

  // store a snapshot in rankingHistory (keep size bounded)
  rankingHistory.push({ date: new Date().toISOString(), snapshot: arr.map(x=>({playerId:x.playerId, rank:x.rank, rate:x.rate})) });
  if (rankingHistory.length > 1000) rankingHistory.shift();
  saveRankingHistory();

  // return defensive copy
  return arr.map(p => ({...p}));
}

/* =========================
   称号付与・描画関連（商品の品質で）
   - 未定義プロパティはここで全て初期化／計算
   - 既存の演出・永続化は全て残す
========================= */

/* TITLE sounds & animation helpers */
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

/* popup queue to avoid overlapping */
const popupQueue=[]; let popupActive=false;
function enqueueTitlePopup(playerId,titleObj){ popupQueue.push({playerId,titleObj}); if(!popupActive) processPopupQueue(); }
function processPopupQueue(){
  if(popupQueue.length===0){ popupActive=false; return; }
  popupActive=true;
  const {playerId,titleObj}=popupQueue.shift();
  showTitlePopup(playerId,titleObj);
  setTimeout(processPopupQueue, window.innerWidth<768?1000:700);
}
function showTitlePopup(playerId, titleObj){
  const unlocked = titleCatalog[titleObj.name]?.unlocked ?? false;
  const popup = document.createElement("div");
  popup.className = "title-popup " + getTitleAnimationClass(titleObj.name);
  const titleName = unlocked ? titleObj.name : "？？？";
  const titleDesc = unlocked ? titleObj.desc : "？？？";
  popup.innerHTML = `<strong>${playerId}</strong><br><strong>${titleName}</strong><br><small>${titleDesc}</small>`;
  document.body.appendChild(popup);
  try {
    const audio = new Audio(unlocked ? (TITLE_SOUNDS[titleObj.name]||TITLE_SOUNDS.default) : TITLE_SOUNDS.default);
    audio.volume = volume; audio.play().catch(()=>{});
  } catch(e){}

  // partices
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

/* title catalog and rendering */
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

/* particles */
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
   称号付与・履歴（商品化レベルで完全版）
   - ここで未定義変数を全て初期化・計算
   - 既存ロジックは保持（ポップアップ、カタログ、履歴、永続化）
========================= */
function assignTitles(player) {
  // defensive copy
  if (!player || !player.playerId) return;
  if (!player.titles) player.titles = [];

  const prevData = normalizeStoredPlayer(playerData.get(player.playerId) || {});

  // =========================
  // 基本情報の初期化
  // =========================
  // consecutiveGames: 参加回数の連続カウント（リセットロジックは別途）
  const consecutiveGames = (prevData.consecutiveGames ?? 0) + 1;
  player.consecutiveGames = consecutiveGames;
  player.prevGames = prevData.prevGames ?? 0;
  player.totalTitles = (Array.isArray(prevData.titles) ? prevData.titles.length : 0);

  // =========================
  // レート関連・差分
  // =========================
  player.rate = Number.isFinite(player.rate) ? Number(player.rate) : 0;
  player.rateGain = (player.rate ?? 0) - (prevData.rate ?? player.rate ?? 0);

  // =========================
  // 連勝・1位回数
  // - winStreak: 前回 winStreak を継承して判定。1位で増加、そうでなければ0
  // - rank1Count: 累積で1位を取った回数
  // =========================
  player.winStreak = prevData.winStreak ?? 0;
  player.winStreak = (player.rank === 1) ? (player.winStreak + 1) : 0;

  player.rank1Count = prevData.rank1Count ?? 0;
  if (player.rank === 1) player.rank1Count += 1;

  // =========================
  // rateTrend: 連続上昇回数（簡易実装）
  // - 前回 rate が存在し、今回 rate が上昇なら増加、逆ならリセット
  // =========================
  player.rateTrend = prevData.rateTrend ?? 0;
  if ((prevData.rate ?? player.rate) < player.rate) player.rateTrend += 1;
  else player.rateTrend = 0;

  // =========================
  // maxBonusCount: 累積して「ボーナスが最大値だった回数」を保持
  // - prevData.maxBonusCount と今回 bonus を比較して更新
  // =========================
  player.bonus = Number.isFinite(player.bonus) ? Number(player.bonus) : (prevData.bonus ?? 0);
  const prevMaxBonusCount = prevData.maxBonusCount ?? 0;
  player.maxBonusCount = Math.max(prevMaxBonusCount, (player.bonus ?? 0));

  // =========================
  // lastBabaSafe: フラグ（外部で avoidedLastBaba を渡す想定）
  // =========================
  player.lastBabaSafe = prevData.lastBabaSafe ?? false;
  if (player.avoidedLastBaba === true) player.lastBabaSafe = true;

  // =========================
  // currentRankingLength: for checks like "from last place"
  // =========================
  player.currentRankingLength = lastProcessedRows?.length ?? player.currentRankingLength ?? null;

  // =========================
  // Podium 称号 (1-3位)
  // =========================
  const podiumTitles = ["キングババ","シルバーババ","ブロンズババ"];
  if (player.rank && player.rank >= 1 && player.rank <= 3) {
    const title = podiumTitles[player.rank - 1];
    if (!player.titles.includes(title)) {
      player.titles.push(title);
      const t = ALL_TITLES.find(tt => tt.name === title);
      if (t) updateTitleCatalog(t);
      enqueueTitlePopup(player.playerId, ALL_TITLES.find(tt=>tt.name===title) || {name:title, desc:""});
      titleHistory.push({ playerId: player.playerId, title, date: new Date().toISOString() });
    }
  }

  // =========================
  // 固定称号判定
  // - 全称号を網羅、各条件は安全に prevData を参照
  // =========================
  const FIXED_TITLES = ALL_TITLES.filter(t => !podiumTitles.includes(t.name) && !RANDOM_TITLES.includes(t.name));

  // safe max computations (if lastProcessedRows empty default to 0)
  const maxRateGain = lastProcessedRows && lastProcessedRows.length ? Math.max(...lastProcessedRows.map(x => x.rateGain ?? 0)) : 0;
  const maxBonus = lastProcessedRows && lastProcessedRows.length ? Math.max(...lastProcessedRows.map(x => x.bonus ?? 0)) : 0;

  FIXED_TITLES.forEach(t => {
    let cond = false;
    switch (t.name) {
      case "逆転の達人":
        // 前回より順位が3以上上がった（prev lastRank が存在することを期待）
        cond = ((prevData.lastRank ?? player.rank) - (player.rank ?? prevData.lastRank ?? 0)) >= 3;
        break;
      case "サプライズ勝利":
        // 前回が最下位（prevData.lastRank === previous ranking length）から1位になった
        cond = ( (prevData.lastRank ?? player.currentRankingLength) === (player.currentRankingLength ?? prevData.currentRankingLength) )
               && (player.rank === 1);
        break;
      case "幸運の持ち主":
        cond = (player.titles.filter(tt => RANDOM_TITLES.includes(tt)).length >= 2);
        break;
      case "不屈の挑戦者":
        cond = (player.consecutiveGames >= 3);
        break;
      case "レートブースター":
        cond = (player.rateGain !== undefined && player.rateGain === maxRateGain && maxRateGain > 0);
        break;
      case "反撃の鬼":
        cond = ((prevData.lastRank ?? player.rank) > (player.rank ?? 999)) && (player.rank !== null && player.rank <= 3);
        break;
      case "チャンスメーカー":
        cond = (player.bonus !== undefined && player.bonus === maxBonus && maxBonus > 0);
        break;
      case "連勝街道":
        cond = (player.winStreak >= 2);
        break;
      case "勝利の方程式":
        cond = (player.rateTrend >= 3);
        break;
      case "挑戦者":
        cond = ((prevData.prevGames ?? 0) === 0) && (player.rank !== null && player.rank <= 5);
        break;
      case "エピックババ":
        cond = (player.totalTitles >= 5);
        break;
      case "ババキング":
        cond = (player.rank1Count >= 3);
        break;
      case "観察眼":
        cond = (player.maxBonusCount >= 3);
        break;
      case "運命の番人":
        cond = (player.lastBabaSafe === true);
        break;
      case "究極のババ":
        // FIXED_TITLES の数だけ集める（雑に計算）
        const fixedNames = FIXED_TITLES.map(ft=>ft.name);
        cond = player.titles.filter(tn => fixedNames.includes(tn)).length === fixedNames.length;
        break;
      default:
        cond = false;
    }
    if (cond && !player.titles.includes(t.name)) {
      player.titles.push(t.name);
      updateTitleCatalog(t);
      enqueueTitlePopup(player.playerId, t);
      titleHistory.push({ playerId: player.playerId, title: t.name, date: new Date().toISOString() });
    }
  });

  // =========================
  // ランダム称号
  // =========================
  RANDOM_TITLES.forEach(name => {
    const t = ALL_TITLES.find(tt => tt.name === name) || {name, desc:""};
    if (!player.titles.includes(name) && Math.random() < (RANDOM_TITLE_PROB[name] ?? 0) && canAssignRandom(player.playerId)) {
      player.titles.push(name);
      updateTitleCatalog(t);
      enqueueTitlePopup(player.playerId, t);
      registerRandomAssign(player.playerId);
      titleHistory.push({ playerId: player.playerId, title: name, date: new Date().toISOString() });
    }
  });

  // =========================
  // playerData更新・永続化（ここで確実に全フィールド保存）
  // =========================
  const merged = {
    ...prevData,
    rate: player.rate,
    lastRank: player.rank ?? prevData.lastRank,
    prevRateRank: player.rateRank ?? prevData.prevRateRank,
    bonus: player.bonus ?? prevData.bonus ?? 0,
    titles: Array.from(new Set([...(prevData.titles||[]), ...(player.titles||[])])),
    consecutiveGames: player.consecutiveGames,
    prevGames: player.prevGames,
    rateGain: player.rateGain,
    winStreak: player.winStreak,
    rateTrend: player.rateTrend,
    rank1Count: player.rank1Count,
    maxBonusCount: player.maxBonusCount,
    lastBabaSafe: player.lastBabaSafe,
    // store last activity
    lastUpdated: new Date().toISOString()
  };

  playerData.set(player.playerId, normalizeStoredPlayer(merged));
  savePlayerData();
  saveTitleHistory();
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
    
    // 管理者専用列は常に作るが、displayで切り替える
    tr.innerHTML = `
      <td>${p.rank ?? "-"}</td>
      <td>${p.playerId ?? "-"}</td>
      <td>${p.rate ?? "-"}</td>
      <td>${fmtChange(p.rankChange)}</td>
      <td>${fmtChange(p.rateRankChange)}</td>
      <td>${Array.isArray(p.titles) ? p.titles.join(", ") : ""}</td>
      <td class="admin-only"><button data-id="${p.playerId ?? ""}" style="display:${isAdmin ? "inline-block" : "none"}">削除</button></td>
    `;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

function exportCSV(data){
  const header=["Rank","PlayerId","Rate","RankChange","RateRankChange","Titles"];
  const csv=[header.join(",")].concat(data.map(p=>[p.rank,p.playerId,p.rate,p.rankChange,p.rateRankChange,(p.titles||[]).join(";")].map(escapeCSV).join(","))).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`ranking_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* Chart rendering (Chart.js must be loaded in page) */
/**
 * 上昇TOP・下降TOP グラフを描画する
 * @param {Array<Object>} data - ランキングデータ配列
 *   期待するプロパティ: { playerId: string, rankChange: number }
 */
function renderTopCharts(data) {
  const upCanvas = document.getElementById("chartTopUp");
  const downCanvas = document.getElementById("chartTopDown");
  const upContainer = upCanvas?.parentElement;
  const downContainer = downCanvas?.parentElement;

  // データが無い場合：既存チャート破棄 & 非表示
  if (!Array.isArray(data) || data.length === 0) {
    if (window.chartUp) { window.chartUp.destroy(); window.chartUp = null; }
    if (window.chartDown) { window.chartDown.destroy(); window.chartDown = null; }
    if (upContainer) upContainer.style.display = "none";
    if (downContainer) downContainer.style.display = "none";
    return;
  }

  // データがある場合は表示
  if (upContainer) upContainer.style.display = "";
  if (downContainer) downContainer.style.display = "";

  // 上昇TOP（rankChangeが大きい順に10件）
  const topUp = [...data]
    .sort((a, b) => (b.rankChange ?? 0) - (a.rankChange ?? 0))
    .slice(0, 10);

  // 下降TOP（rankChangeが小さい順に10件）
  const topDown = [...data]
    .sort((a, b) => (a.rankChange ?? 0) - (b.rankChange ?? 0))
    .slice(0, 10);

  const ctxUp = upCanvas?.getContext("2d");
  const ctxDown = downCanvas?.getContext("2d");
  if (!ctxUp || !ctxDown) return;

  // 既存チャート破棄
  if (window.chartUp) window.chartUp.destroy();
  if (window.chartDown) window.chartDown.destroy();

  // 上昇TOPチャート
  window.chartUp = new Chart(ctxUp, {
    type: "bar",
    data: {
      labels: topUp.map(p => p.playerId ?? "-"),
      datasets: [{
        label: "上昇TOP",
        data: topUp.map(p => p.rankChange ?? 0),
        backgroundColor: "hsl(120,80%,60%)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `変動: ${ctx.raw ?? 0}`
          }
        }
      },
      scales: {
        x: {
          ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "順位変動数" }
        }
      }
    }
  });

  // 下降TOPチャート
  window.chartDown = new Chart(ctxDown, {
    type: "bar",
    data: {
      labels: topDown.map(p => p.playerId ?? "-"),
      datasets: [{
        label: "下降TOP",
        data: topDown.map(p => p.rankChange ?? 0),
        backgroundColor: "hsl(0,80%,60%)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `変動: ${ctx.raw ?? 0}`
          }
        }
      },
      scales: {
        x: {
          ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "順位変動数" }
        }
      }
    }
  });
}

function resetLocalTitlesAndHistory() {
  if(!isAdmin){ toast("管理者モードでのみ実行可能です"); return; }

  // playerData 初期化
  playerData.forEach((p, id) => {
    playerData.set(id, normalizeStoredPlayer({
      ...p,
      titles: [],
      consecutiveGames:0,
      winStreak:0,
      rank1Count:0,
      rateTrend:0,
      maxBonusCount:0,
      lastBabaSafe:false
    }));
  });
  savePlayerData();

  // 履歴・カウント初期化
  titleHistory = [];
  rankingHistory = [];
  dailyRandomCount = {};
  lastProcessedRows = [];
  saveTitleHistory();
  saveRankingHistory();
  saveDailyRandomCount();

  // カタログリセット
  Object.keys(titleCatalog).forEach(k => delete titleCatalog[k]);

  // UI再描画
  renderTitleCatalog();
  renderRankingTable([]);

  toast("ローカルの称号と履歴を初期化しました");
}


/* =========================
   自動更新
========================= */
function startAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); autoRefreshTimer=setInterval(fetchRankingData,AUTO_REFRESH_INTERVAL*1000); }
function stopAutoRefresh(){ if(autoRefreshTimer){ clearInterval(autoRefreshTimer); autoRefreshTimer=null;} }

/* =========================
   初期化
========================= */
document.addEventListener("DOMContentLoaded", () => {

  // 管理者モード切替ボタン
  const toggleBtn = document.getElementById("toggleAdminBtn");
  if(toggleBtn){
    toggleBtn.addEventListener("click", () => {
      setAdminMode(!isAdmin);
    });
  }

  // 称号初期化ボタン
  const resetBtn = document.getElementById("resetLocalBtn");
  if(resetBtn){
    resetBtn.addEventListener("click", () => {
      if(confirm("本当にローカルの称号と履歴を初期化しますか？")){
        resetLocalTitlesAndHistory();
      }
    });
  }

  // 保存されている管理者モードを反映
  const savedAdmin = JSON.parse(localStorage.getItem("isAdmin") || "false");
  setAdminMode(savedAdmin);

  // ランキングテーブル内の削除ボタン処理
  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-id]");
    if(btn && btn.dataset.id && isAdmin){
      const id = btn.dataset.id;
      deletedPlayers.add(id);
      saveDeletedPlayers();
      toast(`${id} を削除リストに追加しました`);
      fetchRankingData();
    }
  });
});

function init(){
  loadPlayerData();
  loadDeletedPlayers();
  loadRankingHistory();
  loadTitleHistory();
  loadTitleState();
  loadVolumeSetting();
  loadNotificationSetting();
  loadDailyRandomCount();
  setAdminMode(JSON.parse(localStorage.getItem("isAdmin")||"false"));
  fetchRankingData();
  startAutoRefresh();
  window.addEventListener("resize",debounce(()=>scheduleRenderTitleCatalog(),200));

  // example UI hookups (if present)
  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-id]");
    if(btn && btn.dataset.id && isAdmin){
      const id = btn.dataset.id;
      deletedPlayers.add(id);
      saveDeletedPlayers();
      toast(`${id} を削除リストに追加しました`);
      // optionally remove from UI
      fetchRankingData();
    }
  });
}

document.addEventListener("DOMContentLoaded",()=>init());
