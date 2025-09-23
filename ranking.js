"use strict";

/* =========================
   設定・定数
========================= */
const GAS_URL = "https://script.google.com/macros/s/AKfycbwk2-v8b1XpoF-3RNB39o3xBJLPxzenmKBuJWRlDJ2LNvuUnuoBEv3QJkTrBMOjots/exec";
const ENDPOINT = "https://script.google.com/macros/s/AKfycbzJ0-yF5R7NSvEahxv15ke0AU2lNT8mHSHCLoop74MpUy_-RiFa5Y3OGlq0OBUTr6_t/exec";
const ADMIN_PASSWORD = "babanuki123";
const STORAGE_KEY = "rankingPlayerData_v4"; // local cache (but GAS is authoritative)
const DELETED_KEY = "rankingDeletedPlayers";
const HISTORY_KEY = "rankingHistory_v4";
const TITLE_HISTORY_KEY = "titleHistory_v4";
const AUTO_REFRESH_INTERVAL = 40; // seconds

const RANDOM_TITLES = ["ミラクルババ","ラッキーババ"];
const RANDOM_TITLE_PROB = { "ミラクルババ": 0.005, "ラッキーババ": 0.01 }; // 0.5% / 1%
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
let playerData = new Map(); // playerId -> playerState object (authoritative copy mirrored from GAS)
let deletedPlayers = new Set(); // authoritative deleted list from GAS
let lastProcessedRows = []; // last processed ranking array (with computed fields)
let rankingHistory = []; // local per-user log
let titleHistory = [];   // local per-user log
let isAdmin = false;
let autoRefreshTimer = null;
let volume = 1.0;
let notificationEnabled = true;
let titleFilter = "all";
let titleSearch = "";
const titleCatalog = {};
let assignedRandomTitles = new Set();
let dailyRandomCount = {}; // { "YYYY-MM-DD": count }  local
let renderScheduled = false;
let isFetching = false;
let rankingArray = null;
let playerSearch = "";

/* =========================
   DOM & Utility
========================= */
const $ = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
function debounce(fn, wait=250){let t; return (...args)=>{clearTimeout(t); t=setTimeout(()=>fn(...args),wait);};}
function fmtChange(val,up="↑",down="↓"){return val>0?`${up}${val}`:val<0?`${down}${-val}`:"—";}
function toast(msg,sec=2500){ if(!notificationEnabled) return; const t=$("#toast"); if(t){ t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),sec); }}
function escapeCSV(s){return `"${String(s).replace(/"/g,'""')}"`;}

/* =========================
   Normalization & Local storage helpers
========================= */
function normalizeStoredPlayer(p){
  if(!p || typeof p !== "object") p = {};
  return {
    playerId: p.playerId ?? p.id ?? null,
    rate: p.rate ?? 0,
    lastRank: p.lastRank ?? null,
    prevRateRank: p.prevRateRank ?? 0,
    bonus: p.bonus ?? 0,
    titles: Array.isArray(p.titles) ? p.titles : [],
    consecutiveGames: p.consecutiveGames ?? 0,
    prevGames: p.prevGames ?? 0,
    rateGain: p.rateGain ?? 0,
    winStreak: p.winStreak ?? 0,
    rateTrend: p.rateTrend ?? 0,
    rank1Count: p.rank1Count ?? 0,
    maxBonusCount: p.maxBonusCount ?? 0,
    lastBabaSafe: p.lastBabaSafe ?? false,
    randomTitleCount: p.randomTitleCount ?? 0,
    deleted: p.deleted ?? false,
    lastUpdated: p.lastUpdated ?? null,
    ...p
  };
}

function loadFromStorage(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){
    return fallback;
  }
}
function saveToStorage(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
  }catch(e){
    console.error("saveToStorage error", e);
  }
}

/* =========================
   Local user settings & logs (keep local only)
========================= */
function saveTitleState(){ saveToStorage("titleFilter", titleFilter); saveToStorage("titleSearch", titleSearch); }
function loadTitleState(){ titleFilter = loadFromStorage("titleFilter","all"); titleSearch = loadFromStorage("titleSearch",""); }

function saveVolumeSetting(){ saveToStorage("volumeSetting", volume); }
function loadVolumeSetting(){ volume = loadFromStorage("volumeSetting", 1.0); }

function saveNotificationSetting(){ saveToStorage("notificationEnabled", notificationEnabled); }
function loadNotificationSetting(){ notificationEnabled = loadFromStorage("notificationEnabled", true); }

function saveRankingHistory(){ try{ saveToStorage(HISTORY_KEY, rankingHistory); }catch(e){console.error(e);} }
function loadRankingHistory(){ rankingHistory = loadFromStorage(HISTORY_KEY, []); }

function saveTitleHistory(){ try{ saveToStorage(TITLE_HISTORY_KEY, titleHistory); }catch(e){console.error(e);} }
function loadTitleHistory(){ titleHistory = loadFromStorage(TITLE_HISTORY_KEY, []); }

/* =========================
   管理者モード UI
========================= */
function setAdminMode(enabled){
  isAdmin = Boolean(enabled);
  saveToStorage("isAdmin", isAdmin);
  $$("th.admin-only, td.admin-only").forEach(el => el.style.display = isAdmin ? "table-cell" : "none");
  const resetBtn = document.getElementById("resetLocalBtn");
  if(resetBtn) resetBtn.style.display = isAdmin ? "inline-block" : "none";
  const toggleBtn = document.getElementById("toggleAdminBtn");
  if(toggleBtn) toggleBtn.textContent = isAdmin ? "管理者モード解除" : "管理者モード切替";
  // update buttons visibility inside table
  $$("button[data-id]").forEach(btn => btn.style.display = isAdmin ? "inline-block" : "none");
}

/* =========================
   リアルタイム検索フィルタ
========================= */
function setPlayerSearch(query){
  playerSearch = query.trim().toLowerCase();
  renderRankingTable(lastProcessedRows);
}

/* =========================
   差分ハイライト強化
========================= */
function highlightChanges(rowEl, player){
  rowEl.classList.remove("highlight-up","highlight-down","highlight-gold","highlight-blue","highlight-fire");

  if(player.rankChange > 0) rowEl.classList.add("highlight-up");        // 上昇：緑
  else if(player.rankChange < 0) rowEl.classList.add("highlight-down"); // 下降：赤

  const newTitles = player.titles.filter(t => !(playerData.get(player.playerId)?.titles || []).includes(t));
  if(newTitles.length) rowEl.classList.add("highlight-gold");            // 称号獲得：金

  if(player.bonus && player.bonus > (playerData.get(player.playerId)?.bonus || 0))
    rowEl.classList.add("highlight-blue");                               // ボーナス獲得：青

  if(player.winStreak && player.winStreak >= 2)
    rowEl.classList.add("highlight-fire");                               // 連勝：炎
}

/* =========================
   ランキング描画拡張（検索・フィルタ反映）
========================= */
function renderRankingTable(data){
  const tbody = $("#rankingTable tbody");
  if(!tbody) return;
  tbody.innerHTML = "";
  if(!Array.isArray(data) || data.length === 0){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center">ランキングデータがありません</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  data.forEach(player=>{
    // 検索フィルタ適用
    if(playerSearch && !player.playerId.toLowerCase().includes(playerSearch)) return;
    if(titleFilter !== "all" && !player.titles.some(t => t === titleFilter)) return;
    if(titleSearch && !player.titles.some(t => t.toLowerCase().includes(titleSearch.toLowerCase()))) return;

    const tr = document.createElement("tr");
    tr.dataset.playerId = player.playerId;
    tr.innerHTML = `
      <td>${player.rateRank ?? "-"}</td>
      <td>${player.playerId}</td>
      <td>${player.rate}</td>
      <td>${player.rankChange ?? 0}</td>
      <td>${player.bonus ?? 0}</td>
      <td>${player.titles.join(", ")}</td>
      <td class="admin-only"><button data-id="${player.playerId}">削除</button></td>
    `;
    highlightChanges(tr, player);
    tr.addEventListener("click", ()=>showPlayerDetailPopup(player.playerId));
    fragment.appendChild(tr);
  });
  tbody.appendChild(fragment);
}

/* =========================
   プレイヤー詳細ポップアップ
========================= */
function showPlayerDetailPopup(playerId){
  const p = playerData.get(playerId);
  if(!p) return;
  const overlay = document.createElement("div");
  overlay.className = "player-detail-overlay";
  overlay.innerHTML = `
    <div class="player-detail-popup">
      <h3>${playerId}</h3>
      <p>現在ランク: ${p.rank ?? "-"}</p>
      <p>スコア: ${p.rate ?? 0}</p>
      <p>連勝: ${p.winStreak ?? 0}</p>
      <p>称号: ${p.titles.join(", ") || "-"}</p>
      <canvas id="scoreChart" width="400" height="200"></canvas>
      <button id="closePlayerDetail">閉じる</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const ctx = overlay.querySelector("#scoreChart").getContext("2d");
  if(ctx && Array.isArray(p.history?.score)){
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: p.history.score.map((_,i)=>`#${i+1}`),
        datasets: [{ label:'スコア推移', data:p.history.score, borderColor:'blue', fill:false }]
      }
    });
  }

  $("#closePlayerDetail").addEventListener("click", ()=> overlay.remove());
}

/* =========================
   自動/手動更新 UI
========================= */
let autoRefreshIntervalSec = AUTO_REFRESH_INTERVAL;
function startAutoRefresh(){
  stopAutoRefresh();
  autoRefreshTimer = setInterval(()=> processRankingWithGAS(), autoRefreshIntervalSec*1000);
}
function stopAutoRefresh(){
  if(autoRefreshTimer){ clearInterval(autoRefreshTimer); autoRefreshTimer=null; }
}
function setAutoRefreshInterval(sec){
  autoRefreshIntervalSec = sec;
  if(autoRefreshTimer) startAutoRefresh();
}

/* =========================
   バリデーション強化
========================= */
function validatePlayerSubmission(p){
  if(!p.playerId) { toast("playerId必須"); return false; }
  if(p.rate===undefined || p.rate===null) { toast("rate必須"); return false; }
  if(p.rank===undefined || p.rank===null) { toast("rank必須"); return false; }
  const duplicate = Array.from(playerData.values()).some(x=>x.playerId===p.playerId && x !== p);
  if(duplicate){ toast("playerIdが重複"); return false; }
  if(p.titles){
    const today = (new Date()).toISOString().slice(0,10);
    if(dailyRandomCount[today] >= RANDOM_TITLE_DAILY_LIMIT){ toast("本日のランダム称号上限に達しています"); return false; }
  }
  return true;
}

/* =========================
   複数テーブル統合管理
========================= */
const tablePlayerMap = new Map(); // tableId -> Map(playerId->playerObj)
function setTablePlayers(tableId, players){
  tablePlayerMap.set(tableId, new Map(players.map(p=>[p.playerId, p])));
}
function getMergedPlayers(){
  const merged = new Map();
  tablePlayerMap.forEach(tbl=>{
    tbl.forEach((p,id)=>{
      if(!merged.has(id)) merged.set(id, p);
    });
  });
  return Array.from(merged.values());
}

/* =========================
   GAS: cumulative fetch/update (authoritative)
   - fetchCumulative: returns { cumulative: {...}, deletedPlayers: [...] }
   - updateCumulative: accepts cumulative object and returns GAS response
========================= */
async function fetchCumulative(){
  try{
    const url = `${ENDPOINT}?mode=getCumulative&secret=${SECRET_KEY}`;
    const res = await fetch(url, { cache: "no-cache" });
    if(!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return {
      cumulative: data.cumulative || {},
      deletedPlayers: Array.isArray(data.deletedPlayers) ? data.deletedPlayers : []
    };
  }catch(e){
    console.error("fetchCumulative error", e);
    return { cumulative: {}, deletedPlayers: [] };
  }
}

async function updateCumulative(cumulativeData){
  try{
    const payload = { mode: "updateCumulative", secret: SECRET_KEY, cumulative: cumulativeData };
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      cache: "no-cache"
    });
    if(!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  }catch(e){
    console.error("updateCumulative error", e);
    return null;
  }
}

/* =========================
   GAS: title get/update helpers (for syncing titles if needed)
========================= */
async function fetchTitleDataFromGAS(){
  try{
    const url = `${GAS_URL}?mode=getTitles&secret=${SECRET_KEY}`;
    const res = await fetch(url, { cache: "no-cache" });
    if(!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if(data && Array.isArray(data.titles)){
      data.titles.forEach(entry=>{
        const prev = playerData.get(entry.playerId) || {};
        prev.titles = entry.titles || [];
        playerData.set(entry.playerId, normalizeStoredPlayer(prev));
      });
    }
  }catch(e){
    console.warn("fetchTitleDataFromGAS failed", e);
  }
}

async function saveTitleDataToGAS(){
  try{
    const titlesArray = Array.from(playerData.entries()).map(([playerId, data])=>({
      playerId,
      titles: (data && data.titles) || []
    }));
    const payload = JSON.stringify({ mode: "updateTitles", secret: SECRET_KEY, titles: titlesArray });
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: payload,
      headers: { "Content-Type":"text/plain;charset=UTF-8" },
      cache: "no-cache"
    });
    if(!res.ok) throw new Error(`status ${res.status}`);
    console.log("saveTitleDataToGAS OK");
  }catch(e){
    console.error("saveTitleDataToGAS error", e);
  }
}

/* =========================
   Init playerData from GAS (GAS-priority)
   - This replaces previous loadPlayerData local-first behavior
========================= */
async function initPlayerDataFromGAS(){
  const { cumulative, deletedPlayers: gasDeleted } = await fetchCumulative();
  deletedPlayers = new Set(gasDeleted || []);
  playerData = new Map();
  for(const [id, data] of Object.entries(cumulative || {})){
    const merged = normalizeStoredPlayer({ playerId: id, ...data, deleted: deletedPlayers.has(id) });
    playerData.set(id, merged);
  }
  // keep a local cache for quick reloads if desired (optional)
  try{ saveToStorage(STORAGE_KEY, Array.from(playerData.entries())); }catch(e){}
  console.log("initPlayerDataFromGAS done. players:", playerData.size);
  return playerData;
}

/* =========================
   Utility to persist cumulative to GAS (converts Map -> plain cumulative object)
========================= */
async function savePlayerDataToGAS(){
  const cumulativeData = {};
  playerData.forEach((p, id) => {
    cumulativeData[id] = {
      rate: p.rate ?? 0,
      lastRank: p.lastRank ?? null,
      prevRateRank: p.prevRateRank ?? 0,
      bonus: p.bonus ?? 0,
      consecutiveGames: p.consecutiveGames ?? 0,
      winStreak: p.winStreak ?? 0,
      rank1Count: p.rank1Count ?? 0,
      rateTrend: p.rateTrend ?? 0,
      maxBonusCount: p.maxBonusCount ?? 0,
      lastBabaSafe: p.lastBabaSafe ?? false,
      titles: p.titles ?? [],
      randomTitleCount: p.randomTitleCount ?? 0,
      deleted: p.deleted ?? false,
      lastUpdated: p.lastUpdated ?? null
    };
  });
  return await updateCumulative(cumulativeData);
}

/* =========================
   Deletion: admin-only, GAS-synced
   - deletePlayer marks deleted locally and pushes cumulative to GAS
========================= */
async function deletePlayer(playerId){
  if(!playerId) return;
  // ensure we have latest cumulative before changing
  if(!playerData.size) await initPlayerDataFromGAS();
  if(!playerData.has(playerId)) {
    toast(`${playerId} が見つかりません`);
    return;
  }
  const p = playerData.get(playerId);
  p.deleted = true;
  p.lastUpdated = new Date().toISOString();
  playerData.set(playerId, p);
  deletedPlayers.add(playerId);

  // push updated cumulative
  const res = await savePlayerDataToGAS();
  if(res === null) {
    toast("削除をGASに反映できませんでした（ネットワークエラー）");
  } else {
    toast(`${playerId} を削除しました（GAS同期済み）`);
  }

  // re-render filtered view
  lastProcessedRows = Array.from(playerData.values()).filter(x => !deletedPlayers.has(x.playerId));
  lastProcessedRows.sort((a,b)=> (b.rate ?? 0) - (a.rate ?? 0));
  lastProcessedRows.forEach((r,i,arr)=>{
    r.rateRank = i>0 && r.rate === arr[i-1].rate ? arr[i-1].rateRank : i+1;
  });
  renderRankingTable(lastProcessedRows);
  renderTopCharts(lastProcessedRows);
}

/* =========================
   Process ranking with GAS as authoritative source
   - Fetch cumulative from GAS
   - Fetch latest ranking from GAS_URL (getRanking)
   - Compute diffs, assign titles, update cumulative and push to GAS
========================= */
async function processRankingWithGAS(latestRankingData = null) {
  isFetching = true;
  try {
    // --- 1) 累計情報と削除リストを取得 ---
    const { cumulative, deletedPlayers: gasDeleted } = await fetchCumulative();
    deletedPlayers = new Set(gasDeleted || []);

    playerData = new Map();
    for (const [id, data] of Object.entries(cumulative || {})) {
      playerData.set(id, normalizeStoredPlayer({ playerId: id, ...data, deleted: deletedPlayers.has(id) }));
    }

    // --- 2) ランキング取得 ---
    if (!rankingArray) {
      const res = await fetch(`${GAS_URL}?mode=getRanking&secret=${SECRET_KEY}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();

      // "PlayerId=player1, rate=120, rank=1" をオブジェクトに変換
      const parseRankingString = (str) => {
        const obj = {};
        str.split(",").forEach(part => {
          const [key, value] = part.split("=").map(s => s.trim());
          obj[key.toLowerCase()] = key === "rate" || key === "rank" ? Number(value) : value;
        });
        return obj;
      };

      // --- ランキング形式判定 ---
      if (Array.isArray(json)) {
        if (json.length > 0 && Array.isArray(json[0])) {
          // 形式: [["player3", 120, 1], ...]
          rankingArray = json.map(arr => ({ playerId: arr[0], rate: Number(arr[1]), rank: Number(arr[2]) }));
        } else if (json.length > 0 && typeof json[0] === "object") {
          rankingArray = json.map(obj => typeof obj === "string" ? parseRankingString(obj) : ({
            playerId: obj.playerId ?? obj.id ?? null,
            rate: Number(obj.rate) || 0,
            rank: Number(obj.rank) || null
          }));
        } else if (json.length > 0 && typeof json[0] === "string") {
          // 配列内が文字列の場合は "=" を ":" に置き換えなくても parseRankingString で対応
          rankingArray = json.map(line => parseRankingString(line));
        } else {
          rankingArray = [];
        }
      } else if (json.ranking && typeof json.ranking === "object") {
        rankingArray = Object.entries(json.ranking).map(([id, values]) => {
          if (typeof values === "string") {
            const parsed = parseRankingString(values); // "=" を ":" に変換せず parseRankingString 内で処理
            return { playerId: parsed.playerId || id, rate: parsed.rate || 0, rank: parsed.rank || null };
          } else if (Array.isArray(values)) {
            return { playerId: id, rate: Number(values[0]), rank: Number(values[1]) };
          } else if (typeof values === "object") {
            return { playerId: id, rate: Number(values.rate) || 0, rank: Number(values.rank) || null };
          } else {
            return { playerId: id, rate: 0, rank: null };
          }
        });
      } else {
        rankingArray = [];
      }
    }

    // --- 3) ランキングが空の場合は累計のみ表示 ---
    if (!rankingArray || rankingArray.length === 0) {
      const fallbackRows = Array.from(playerData.values()).filter(p => !deletedPlayers.has(p.playerId));
      fallbackRows.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
      fallbackRows.forEach((p, i, arr) => {
        p.rateRank = i > 0 && p.rate === arr[i - 1].rate ? arr[i - 1].rateRank : i + 1;
        p.rankChange = 0;
        p.rateRankChange = 0;
      });
      lastProcessedRows = fallbackRows;
      renderRankingTable(lastProcessedRows);
      renderTopCharts(lastProcessedRows);
      scheduleRenderTitleCatalog();
      return lastProcessedRows;
    }

    // --- 4) 累計情報と統合して差分計算 ---
    const processed = rankingArray.map(p => {
      const prev = cumulative[p.playerId] || {};
      const rate = Number.isFinite(p.rate) ? Number(p.rate) : 0;
      const rank = Number.isFinite(p.rank) ? Number(p.rank) : null;
      const bonus = Number.isFinite(p.bonus) ? Number(p.bonus) : 0;
      const rateGain = rate - (prev.rate ?? rate);

      return {
        playerId: p.playerId,
        rank,
        rate,
        bonus,
        titles: Array.isArray(prev.titles) ? [...prev.titles] : [],
        prevRate: prev.rate ?? rate,
        prevRank: prev.lastRank ?? rank,
        rateGain,
        consecutiveGames: (prev.consecutiveGames ?? 0) + 1,
        winStreak: rank === 1 ? ((prev.winStreak ?? 0) + 1) : 0,
        rank1Count: (prev.rank1Count ?? 0) + (rank === 1 ? 1 : 0),
        rateTrend: ((prev.rate ?? 0) < rate) ? ((prev.rateTrend ?? 0) + 1) : 0,
        maxBonusCount: Math.max(prev.maxBonusCount ?? 0, bonus),
        lastBabaSafe: prev.lastBabaSafe ?? false,
        deleted: prev.deleted ?? false
      };
    });

    // --- 5) 削除済み除外・レート順ソート・順位差計算 ---
    const filteredProcessed = processed.filter(p => !deletedPlayers.has(p.playerId));
    filteredProcessed.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    filteredProcessed.forEach((p, i, arr) => {
      p.rateRank = i > 0 && p.rate === arr[i - 1].rate ? arr[i - 1].rateRank : i + 1;
      const prevRateRank = p.prevRateRank ?? p.rateRank;
      p.rankChange = (p.prevRank ?? p.rank) - p.rank;
      p.rateRankChange = prevRateRank - p.rateRank;
    });

    lastProcessedRows = filteredProcessed;

    // --- 6) タイトル割り当て（差分ありのみ） ---
    filteredProcessed.forEach(p => {
      const prev = playerData.get(p.playerId);
      const newData = {
        rate: p.rate,
        rank: p.rank,
        };

  // 前回と全く同じならスキップ
      const keysToCompare = ["rate", "rank", ]; // 比較するプロパティだけ選択
      const isSame = prev && keysToCompare.every(k => prev[k] === newData[k]);

      if (!isSame) {
        assignTitles(p); // 差分ありなら称号付与
      }
    });

    // --- 7) 累計更新・GAS同期 ---
    const newCumulative = {};
    filteredProcessed.forEach(p => {
      const merged = normalizeStoredPlayer({
        playerId: p.playerId,
        rate: p.rate,
        lastRank: p.rank,
        prevRateRank: p.rateRank,
        bonus: p.bonus,
        consecutiveGames: p.consecutiveGames,
        winStreak: p.winStreak,
        rank1Count: p.rank1Count,
        rateTrend: p.rateTrend,
        maxBonusCount: p.maxBonusCount,
        lastBabaSafe: p.lastBabaSafe,
        titles: p.titles || [],
        deleted: p.deleted ?? false,
        lastUpdated: new Date().toISOString()
      });
      playerData.set(p.playerId, merged);
      newCumulative[p.playerId] = {
        rate: merged.rate,
        lastRank: merged.lastRank,
        prevRateRank: merged.prevRateRank,
        bonus: merged.bonus,
        consecutiveGames: merged.consecutiveGames,
        winStreak: merged.winStreak,
        rank1Count: merged.rank1Count,
        rateTrend: merged.rateTrend,
        maxBonusCount: merged.maxBonusCount,
        lastBabaSafe: merged.lastBabaSafe,
        titles: merged.titles,
        deleted: merged.deleted ?? false
      };
    });

    // --- 8) 累計に存在するが当日のランキングにないプレイヤーも保持 ---
    playerData.forEach((v, id) => {
      if (!(id in newCumulative)) {
        newCumulative[id] = {
          rate: v.rate ?? 0,
          lastRank: v.lastRank ?? null,
          prevRateRank: v.prevRateRank ?? 0,
          bonus: v.bonus ?? 0,
          consecutiveGames: v.consecutiveGames ?? 0,
          winStreak: v.winStreak ?? 0,
          rank1Count: v.rank1Count ?? 0,
          rateTrend: v.rateTrend ?? 0,
          maxBonusCount: v.maxBonusCount ?? 0,
          lastBabaSafe: v.lastBabaSafe ?? false,
          titles: v.titles ?? [],
          deleted: v.deleted ?? false
        };
      }
    });

    const updRes = await updateCumulative(newCumulative);
    if (!updRes) console.warn("Failed to update cumulative to GAS");
    else console.log("Cumulative updated to GAS");

    // --- 9) 描画 ---
    renderRankingTable(filteredProcessed);
    renderTopCharts(filteredProcessed);
    scheduleRenderTitleCatalog();

    // --- 10) ローカルログ保存 ---
    saveTitleHistory();
    saveRankingHistory();

    return filteredProcessed;
  } catch (e) {
    console.error("processRankingWithGAS error", e);
    const fallback = Array.from(playerData.values()).filter(p => !deletedPlayers.has(p.playerId));
    fallback.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    fallback.forEach((p, i, arr) => {
      p.rateRank = i > 0 && p.rate === arr[i - 1].rate ? arr[i - 1].rateRank : i + 1;
      p.rankChange = 0;
      p.rateRankChange = 0;
    });
    lastProcessedRows = fallback;
    renderRankingTable(lastProcessedRows);
    renderTopCharts(lastProcessedRows);
    scheduleRenderTitleCatalog();
    return lastProcessedRows;
  } finally {
    isFetching = false;
  }
}


/* =========================
   Random title assignment helpers (uses playerData counts stored in cumulative)
========================= */
function canAssignRandom(playerId){
  const prev = playerData.get(playerId) || {};
  const assigned = prev.randomTitleCount ?? 0;
  return assigned < RANDOM_TITLE_DAILY_LIMIT;
}
function registerRandomAssign(playerId){
  const prev = normalizeStoredPlayer(playerData.get(playerId) || { playerId });
  prev.randomTitleCount = (prev.randomTitleCount ?? 0) + 1;
  prev.lastUpdated = new Date().toISOString();
  playerData.set(playerId, normalizeStoredPlayer(prev));
  // persist to GAS (cheap single update of cumulative for that player)
  // To avoid throttling, we defer pushing full cumulative until processRankingWithGAS or explicit save
  saveToStorage(STORAGE_KEY, Array.from(playerData.entries())); // local cache
}

/* =========================
   Title popups, catalog rendering, particles (UI polish)
   (kept largely same as your original, refactored slightly)
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

function getTitlePriority(titleName){
  if(/キング|究極|ラッキー/.test(titleName)) return 3; // 高優先度
  if(/シルバー/.test(titleName)) return 2;               // 中優先度
  return 1;                                             // 低優先度
}

/* =========================
   ポップアップキュー管理（優先度付き）
========================= */
const popupQueue = [];
let popupActive = false;

function enqueueTitlePopup(playerId, titleObj) {
  const priority = getTitlePriority(titleObj.name);
  // 優先度が高いものほど前に挿入
  let inserted = false;
  for(let i=0;i<popupQueue.length;i++){
    if(priority > popupQueue[i].priority){
      popupQueue.splice(i,0,{playerId,titleObj,priority});
      inserted = true;
      break;
    }
  }
  if(!inserted) popupQueue.push({playerId,titleObj,priority});
  if(!popupActive) processPopupQueue();
}

function processPopupQueue() {
  if (popupQueue.length === 0) {
    popupActive = false;
    return;
  }
  popupActive = true;
  const { playerId, titleObj } = popupQueue.shift();
  showTitlePopup(playerId, titleObj);
  setTimeout(processPopupQueue, window.innerWidth < 768 ? 1000 : 700);
}

/* =========================
   ポップアップ表示
========================= */
function showTitlePopup(playerId, titleObj) {
  const unlocked = titleCatalog[titleObj.name]?.unlocked ?? false;

  const popup = document.createElement("div");
  popup.className = "title-popup " + getTitleAnimationClass(titleObj.name);

  const titleName = unlocked ? titleObj.name : "？？？";
  const titleDesc = unlocked ? titleObj.desc : "？？？";

  popup.innerHTML = `<strong>${playerId}</strong><br><strong>${titleName}</strong><br><small>${titleDesc}</small>`;
  document.body.appendChild(popup);

  try {
    const audio = new Audio(unlocked ? (TITLE_SOUNDS[titleObj.name] || TITLE_SOUNDS.default) : TITLE_SOUNDS.default);
    audio.volume = volume; 
    audio.play().catch(()=>{});
  } catch(e){}

  const particleContainer = document.createElement("div"); 
  particleContainer.className="particle-container";
  document.body.appendChild(particleContainer);

  const particleCount = window.innerWidth < 768 ? 10 : window.innerWidth < 1200 ? 20 : 30;
  for(let i = 0; i < particleCount; i++){
    const p = document.createElement("div");
    p.className = "particle";
    p.style.left = Math.random()*100 + "vw";
    p.style.top  = Math.random()*100 + "vh";
    p.style.animationDuration = (0.5 + Math.random()*1.5) + "s";
    p.style.backgroundColor = unlocked ? `hsl(${Math.random()*360},80%,60%)` : `hsl(0,0%,70%)`;
    particleContainer.appendChild(p);
  }

  setTimeout(() => popup.classList.add("show"), 50);

  const removePopup = () => {
    popup.classList.remove("show");
    try { particleContainer.remove(); } catch(e){}
    setTimeout(() => { try{ popup.remove(); } catch(e){} }, 600);
    popup.removeEventListener("click", removePopup);
  };

  popup.addEventListener("click", removePopup);
  setTimeout(removePopup, 2500);
}

/* =========================
   称号カタログ管理
========================= */
function updateTitleCatalog(title) {
  if(!titleCatalog[title.name]) titleCatalog[title.name] = { unlocked: true, desc: title.desc };
  else titleCatalog[title.name].unlocked = true;
  scheduleRenderTitleCatalog();
}

function scheduleRenderTitleCatalog() {
  if(renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(()=>{ renderTitleCatalog(); renderScheduled = false; });
}

/* =========================
   称号カタログ表示
========================= */
function renderTitleCatalog() {
  const container = $("#titleCatalog");
  if(!container) return;
  container.innerHTML = "";

  const cols = window.innerWidth < 480 ? 1 : window.innerWidth < 768 ? 2 : window.innerWidth < 1024 ? 3 : 4;
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;
  container.style.gap = "12px";

  ALL_TITLES.forEach(title => {
    const unlocked = titleCatalog[title.name]?.unlocked ?? false;
    if((titleFilter==="unlocked" && !unlocked) || (titleFilter==="locked" && unlocked)) return;
    if(titleSearch && !title.name.toLowerCase().includes(titleSearch.toLowerCase())) return;

    const historyItems = titleHistory.filter(h => h.title === title.name);
    const latest = historyItems.length ? new Date(Math.max(...historyItems.map(h => new Date(h.date)))) : null;
    const dateStr = latest ? latest.toLocaleDateString() : "";

    const cardContainer = document.createElement("div"); cardContainer.className = "title-card-container";
    const card = document.createElement("div"); card.className = "title-card";

    const front = document.createElement("div"); front.className = "front";
    front.innerHTML = `<strong>？？？</strong><small>？？？</small>`;
    front.title = unlocked ? title.desc : "取得条件: ???";

    const back = document.createElement("div"); back.className = "back " + getRarityClass(title.name);
    back.innerHTML = `<strong>${title.name}</strong><small>${title.desc}</small>${dateStr?`<small>取得日:${dateStr}</small>`:""}`;

    card.appendChild(front); card.appendChild(back);
    cardContainer.appendChild(card);
    container.appendChild(cardContainer);

    if(unlocked && !card.dataset.rendered) {
      card.classList.add("gain");
      card.dataset.rendered = "true";
      createParticles(cardContainer);
    }

    card.addEventListener("click", () => showTitleDetailPopup(title, unlocked));
  });
}

function getRarityClass(titleName){
  if(/キング|ラッキー|究極/.test(titleName)) return "rare-rainbow";
  if(/シルバー/.test(titleName)) return "rare-silver";
  if(/ブロンズ/.test(titleName)) return "rare-bronze";
  return "rare-gold";
}

/* =========================
   詳細ポップアップ表示
========================= */
function showTitleDetailPopup(title, unlocked) {
  const overlay = document.createElement("div"); overlay.className = "title-detail-overlay";

  const nameText = unlocked ? title.name : "？？？";
  const descText = unlocked ? title.desc : "取得条件: ???";

  overlay.innerHTML = `
    <div class="title-detail-popup ${unlocked ? "unlocked" : "locked"}">
      <h3>${nameText}</h3>
      <p>${descText}</p>
      <button id="closeTitleDetail">閉じる</button>
    </div>
  `;
  document.body.appendChild(overlay);

  if(unlocked) createParticles(overlay.querySelector(".title-detail-popup"));

  $("#closeTitleDetail").addEventListener("click", ()=> overlay.remove());
}

/* =========================
   パーティクル生成
========================= */
function createParticles(target){
  const particleContainer = document.createElement("div"); particleContainer.className = "particle-container";
  target.appendChild(particleContainer);

  const particleCount = window.innerWidth < 480 ? 10 : window.innerWidth < 768 ? 15 : window.innerWidth < 1200 ? 20 : 30;
  for(let i=0;i<particleCount;i++){
    const p = document.createElement("div"); p.className = "particle";
    p.style.left = `${Math.random()*100}%`;
    p.style.top = `${Math.random()*100}%`;
    p.style.animationDuration = `${0.5 + Math.random()*1.5}s`;
    p.style.backgroundColor = `hsl(${Math.random()*360},80%,60%)`;
    particleContainer.appendChild(p);
  }
  setTimeout(()=>{ try{ particleContainer.remove(); }catch(e){} }, 1500);
}

/* =========================
   Title assignment & persistence (商品化レベルで完全版)
   - fills missing properties, uses playerData (GAS-authoritative)
========================= */
function assignTitles(player, isNewMatch = false) {
  if (!player || !player.playerId) return;
  if (!player.titles) player.titles = [];

  // authoritative playerData from GAS
  const prevData = normalizeStoredPlayer(playerData.get(player.playerId) || { playerId: player.playerId });

  // === GASデータ差分判定 ===
  // 永続系称号に必要な主要フィールドのみ比較
  const persistentChanged =
    player.rank !== prevData.rank ||
    player.rate !== prevData.rate ||
    player.bonus !== prevData.bonus ||
    player.avoidedLastBaba !== prevData.avoidedLastBaba ||
    isNewMatch;

  // ランダム称号に必要な主要フィールドのみ比較
  const randomChanged =
    player.rank !== prevData.rank ||
    player.rate !== prevData.rate ||
    player.bonus !== prevData.bonus ||
    player.avoidedLastBaba !== prevData.avoidedLastBaba;

  // === 基本情報更新 ===
  player.consecutiveGames = (prevData.consecutiveGames ?? 0) + (isNewMatch ? 1 : 0);
  player.prevGames = prevData.prevGames ?? 0;
  player.totalTitles = (Array.isArray(prevData.titles) ? prevData.titles.length : 0);

  player.rate = Number.isFinite(player.rate) ? Number(player.rate) : 0;
  player.rateGain = (player.rate ?? 0) - (prevData.rate ?? player.rate ?? 0);

  player.winStreak = (player.rank === 1) ? ((prevData.winStreak ?? 0) + 1) : 0;
  player.rank1Count = (player.rank === 1) ? ((prevData.rank1Count ?? 0) + 1) : (prevData.rank1Count ?? 0);
  player.rateTrend = ((prevData.rate ?? 0) < player.rate) ? ((prevData.rateTrend ?? 0) + 1) : 0;

  player.bonus = Number.isFinite(player.bonus) ? Number(player.bonus) : (prevData.bonus ?? 0);
  player.maxBonusCount = Math.max(prevData.maxBonusCount ?? 0, player.bonus ?? 0);

  player.lastBabaSafe = prevData.lastBabaSafe ?? false;
  if (player.avoidedLastBaba === true) player.lastBabaSafe = true;

  player.currentRankingLength = lastProcessedRows?.length ?? player.currentRankingLength ?? null;

  // === 動的称号（順位に応じて毎回判定） ===
  const podiumTitles = ["キングババ", "シルバーババ", "ブロンズババ"];
  if (player.rank && player.rank >= 1 && player.rank <= 3) {
    const dynTitle = podiumTitles[player.rank - 1];
    if (!player.titles.includes(dynTitle)) player.titles.push(dynTitle);
  }

  // === 永続系称号（差分がある場合のみ判定） ===
  if (persistentChanged) {
    const FIXED_TITLES = ALL_TITLES.filter(
      t => !podiumTitles.includes(t.name) && !RANDOM_TITLES.includes(t.name)
    );
    const maxRateGain = lastProcessedRows?.length ? Math.max(...lastProcessedRows.map(x => x.rateGain ?? 0)) : 0;
    const maxBonus = lastProcessedRows?.length ? Math.max(...lastProcessedRows.map(x => x.bonus ?? 0)) : 0;

    FIXED_TITLES.forEach(t => {
      let cond = false;
      switch (t.name) {
        case "逆転の達人":
          cond = ((prevData.lastRank ?? player.rank) - (player.rank ?? prevData.lastRank ?? 0)) >= 3; break;
        case "サプライズ勝利":
          cond = ((prevData.lastRank ?? player.currentRankingLength) === (player.currentRankingLength ?? prevData.currentRankingLength)) && (player.rank === 1); break;
        case "幸運の持ち主":
          cond = (player.titles.filter(tt => RANDOM_TITLES.includes(tt)).length >= 2); break;
        case "不屈の挑戦者": cond = (player.consecutiveGames >= 3); break;
        case "レートブースター": cond = (player.rateGain !== undefined && player.rateGain === maxRateGain && maxRateGain > 0); break;
        case "反撃の鬼": cond = ((prevData.lastRank ?? player.rank) > (player.rank ?? 999)) && (player.rank !== null && player.rank <= 3); break;
        case "チャンスメーカー": cond = (player.bonus !== undefined && player.bonus === maxBonus && maxBonus > 0); break;
        case "連勝街道": cond = (player.winStreak >= 2); break;
        case "勝利の方程式": cond = (player.rateTrend >= 3); break;
        case "挑戦者": cond = isNewMatch && (player.rank !== null && player.rank <= 5); break;
        case "エピックババ": cond = (player.totalTitles >= 5); break;
        case "ババキング": cond = (player.rank1Count >= 3); break;
        case "観察眼": cond = (player.maxBonusCount >= 3); break;
        case "運命の番人": cond = (player.lastBabaSafe === true); break;
        case "究極のババ":
          const fixedNames = FIXED_TITLES.map(ft => ft.name);
          cond = player.titles.filter(tn => fixedNames.includes(tn)).length === fixedNames.length;
          break;
        default: cond = false;
      }

      if (cond && !prevData.titles?.includes(t.name)) {
        player.titles.push(t.name);
        updateTitleCatalog(t);
        enqueueTitlePopup(player.playerId, t);
        titleHistory.push({ playerId: player.playerId, title: t.name, date: new Date().toISOString() });
      }
    });
  }

  // === ランダム称号（差分がある場合のみ抽選） ===
  if (randomChanged) {
    RANDOM_TITLES.forEach(name => {
      const t = ALL_TITLES.find(tt => tt.name === name) || { name, desc: "" };
      if (!player.titles.includes(name) && canAssignRandom(player.playerId)) {
        const prob = RANDOM_TITLE_PROB[name] ?? 0;
        if (Math.random() < prob) {
          player.titles.push(name);
          updateTitleCatalog(t);
          enqueueTitlePopup(player.playerId, t);
          registerRandomAssign(player.playerId);
          titleHistory.push({ playerId: player.playerId, title: name, date: new Date().toISOString() });
        }
      }
    });
  }

  // === playerData にマージ & 永続保存 ===
  const merged = {
    ...normalizeStoredPlayer(prevData),
    rate: player.rate,
    lastRank: player.rank ?? prevData.lastRank,
    prevRateRank: player.rateRank ?? prevData.prevRateRank,
    bonus: player.bonus ?? prevData.bonus ?? 0,
    titles: Array.from(new Set([...(prevData.titles || []), ...(player.titles || [])])),
    consecutiveGames: player.consecutiveGames,
    prevGames: player.prevGames,
    rateGain: player.rateGain,
    winStreak: player.winStreak,
    rateTrend: player.rateTrend,
    rank1Count: player.rank1Count,
    maxBonusCount: player.maxBonusCount,
    lastBabaSafe: player.lastBabaSafe,
    deleted: player.deleted ?? false,
    lastUpdated: new Date().toISOString(),
    playerId: player.playerId
  };

  playerData.set(player.playerId, normalizeStoredPlayer(merged));
  saveTitleHistory();
  saveToStorage(STORAGE_KEY, Array.from(playerData.entries()));
}

/* =========================
   Table rendering / CSV / Charts
========================= */
function renderRankingTable(data){
  const tbody = $("#rankingTable tbody");
  if(!tbody) return;
  if(!Array.isArray(data) || data.length === 0){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center">ランキングデータがありません</td></tr>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  data.forEach(p=>{
    const tr = document.createElement("tr");
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

/* Chart rendering - assumes Chart.js is present */
function renderTopCharts(data){
  const upCanvas = document.getElementById("chartTopUp");
  const downCanvas = document.getElementById("chartTopDown");
  const upContainer = upCanvas?.parentElement;
  const downContainer = downCanvas?.parentElement;
  if(!Array.isArray(data) || data.length === 0){
    if(window.chartUp){ window.chartUp.destroy(); window.chartUp = null; }
    if(window.chartDown){ window.chartDown.destroy(); window.chartDown = null; }
    if(upContainer) upContainer.style.display = "none";
    if(downContainer) downContainer.style.display = "none";
    return;
  }
  if(upContainer) upContainer.style.display = "";
  if(downContainer) downContainer.style.display = "";
  const topUp = [...data].sort((a,b)=>(b.rankChange ?? 0)-(a.rankChange ?? 0)).slice(0,10);
  const topDown = [...data].sort((a,b)=>(a.rankChange ?? 0)-(b.rankChange ?? 0)).slice(0,10);
  const ctxUp = upCanvas?.getContext("2d");
  const ctxDown = downCanvas?.getContext("2d");
  if(!ctxUp || !ctxDown) return;
  if(window.chartUp) window.chartUp.destroy();
  if(window.chartDown) window.chartDown.destroy();
  window.chartUp = new Chart(ctxUp, {
    type: "bar",
    data: {
      labels: topUp.map(p=>p.playerId ?? "-"),
      datasets: [{ label: "上昇TOP", data: topUp.map(p=>p.rankChange ?? 0) }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ y:{ beginAtZero:true, title:{display:true, text:"順位変動数"} } } }
  });
  window.chartDown = new Chart(ctxDown, {
    type: "bar",
    data: {
      labels: topDown.map(p=>p.playerId ?? "-"),
      datasets: [{ label: "下降TOP", data: topDown.map(p=>p.rankChange ?? 0) }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ y:{ beginAtZero:true, title:{display:true, text:"順位変動数"} } } }
  });
}

/* =========================
   Reset local titles/history (admin-only)
========================= */
async function resetLocalTitlesAndHistory(){
  if(!isAdmin){ toast("管理者モードでのみ実行可能です"); return; }
  // reset only local logs & local cached fields (not touching GAS cumulative except titles if you want to push)
  playerData.forEach((p, id) => {
    playerData.set(id, normalizeStoredPlayer({
      ...p,
      titles: [],
      consecutiveGames:0,
      winStreak:0,
      rank1Count:0,
      rateTrend:0,
      maxBonusCount:0,
      lastBabaSafe:false,
      randomTitleCount:0
    }));
  });
  saveToStorage(STORAGE_KEY, Array.from(playerData.entries()));
  titleHistory = [];
  rankingHistory = [];
  lastProcessedRows = [];
  saveTitleHistory();
  saveRankingHistory();
  Object.keys(titleCatalog).forEach(k=>delete titleCatalog[k]);
  renderTitleCatalog();
  renderRankingTable([]);
  toast("ローカルの称号と履歴を初期化しました（ローカルのみ）");
}

/* =========================
   Auto refresh controls
========================= */
function startAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); autoRefreshTimer = setInterval(()=>fetchRankingData(), AUTO_REFRESH_INTERVAL*1000); }
function stopAutoRefresh(){ if(autoRefreshTimer){ clearInterval(autoRefreshTimer); autoRefreshTimer = null; } }

/* =========================
   Top-level fetch wrapper
========================= */
async function fetchRankingData(){
  try{
    await processRankingWithGAS();
  }catch(e){
    console.error("fetchRankingData error", e);
  }
}

/* =========================
   Initialization & Event wiring
========================= */
document.addEventListener("DOMContentLoaded", () => {
  // Wire admin toggle button (if present)
  const toggleBtn = document.getElementById("toggleAdminBtn");
  if(toggleBtn){
    toggleBtn.addEventListener("click", ()=>{
      // simple prompt for password (you can change to better auth)
      if(!isAdmin){
        const pw = prompt("管理者パスワードを入力してください");
        if(pw === ADMIN_PASSWORD){
          setAdminMode(true);
          toast("管理者モードを有効化しました");
        }else{
          toast("パスワードが違います");
        }
      }else{
        setAdminMode(false);
        toast("管理者モード解除");
      }
    });
  }

  // reset local button
  const resetBtn = document.getElementById("resetLocalBtn");
  if(resetBtn){
    resetBtn.addEventListener("click", ()=>{
      if(confirm("本当にローカルの称号と履歴を初期化しますか？（GASは影響を受けません）")){
        resetLocalTitlesAndHistory();
      }
    });
  }

   document.addEventListener("DOMContentLoaded", () => {
  const loadingEl = document.getElementById("loadingMessage");
  if (loadingEl) loadingEl.style.display = "block";

  // 0.8秒遅延してからGAS読み込み開始
  setTimeout(async () => {
    try {
      await processRankingWithGAS();
      renderTitleCatalog();
    } finally {
      if (loadingEl) loadingEl.style.display = "none";
    }
  }, 800);
});

  // general click handler for delete buttons in table (admin-only)
  document.addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-id]");
    if(!btn) return;
    const id = btn.dataset.id;
    if(!id) return;
    if(isAdmin){
      if(confirm(`${id} を削除（GASと同期）しますか？`)){
        await deletePlayer(id);
      }
    }
  });

  // load saved user settings & logs
  loadTitleState(); 
  loadVolumeSetting();
  loadNotificationSetting();
  loadRankingHistory(); 
  loadTitleHistory();
  setAdminMode(loadFromStorage("isAdmin", false));
  startAutoRefresh();
  loadTitleHistory();
  loadTitleState();
  loadVolumeSetting();
  loadNotificationSetting();
  const savedAdmin = loadFromStorage("isAdmin", false);
  setAdminMode(savedAdmin);

  // initialize authoritative data from GAS and start auto refresh
  (async ()=>{
    await initPlayerDataFromGAS(); // populate playerData from GAS
    await fetchRankingData(); // compute, assign titles, push cumulative back to GAS if necessary
    startAutoRefresh();
  })();

  window.addEventListener("resize", debounce(()=>scheduleRenderTitleCatalog(), 200));
});

// compatibility: alias init if external code calls it
async function init(){
  // load local settings/logs and then sync with GAS
  loadTitleState();
  loadVolumeSetting(); 
  loadNotificationSetting();
  loadRankingHistory();
  loadTitleHistory();
  setAdminMode(loadFromStorage("isAdmin", false));
  startAutoRefresh();
  loadTitleHistory();
  loadTitleState();
  loadVolumeSetting();
  loadNotificationSetting();
  setAdminMode(loadFromStorage("isAdmin", false));
  await initPlayerDataFromGAS();
  await fetchRankingData();
  startAutoRefresh();
  window.addEventListener("resize", debounce(()=>scheduleRenderTitleCatalog(),200));
}
window.appInit = init; // expose for debugging if needed
