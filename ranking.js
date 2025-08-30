"use strict";

/* ===============================
   定数・ユーティリティ
   =============================== */
const GAS_URL = "https://script.google.com/macros/s/AKfycbyhvqBiHIAsVYfUDw5e3Bz6L83OkwuZEFL-YCFHCNBi7MrUb7zQx1EV1RxZKTD62QED/exec";
const TITLES = ["⚡雷", "🌪風", "🔥火"];
const STORAGE_KEY = "rankingPlayerData_v2";
const DELETED_KEY = "rankingDeletedPlayers";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const collatorJa = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ===============================
   状態
   =============================== */
let playerData = new Map();
let autoRefreshTimer = null;
let historyChartInstance = null;
let lastProcessedRows = [];
let currentSort = { idx: 0, asc: true };
let isFetching = false;
let deletedPlayers = new Set();
/* ===============================
   ストレージ
   =============================== */
function loadPlayerData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    playerData = new Map(JSON.parse(raw));
  } catch { console.warn("PlayerData load failed"); }
}

function savePlayerData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(playerData.entries())));
  } catch { console.warn("PlayerData save failed"); }
}

function loadDeletedPlayers() {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    if (!raw) return;
    deletedPlayers = new Set(JSON.parse(raw));
  } catch { console.warn("DeletedPlayers load failed"); }
}

function saveDeletedPlayers() {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...deletedPlayers]));
  } catch { console.warn("DeletedPlayers save failed"); }
}

/* ===============================
   CSV パース
   =============================== */
function parseCSV(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim());
  if (!lines.length) return [];

  return lines.map(line => {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; continue; }
          inQ = false;
        } else cur += c;
      } else {
        if (c === '"') { inQ = true; continue; }
        if (c === ',') { out.push(cur); cur = ""; continue; }
        cur += c;
      }
    }
    out.push(cur);
    return out;
  });
}

/* ===============================
   データ処理
   =============================== */
function applyPreviousData(entries) {
  entries.forEach(p => {
    const prev = playerData.get(p.playerId) || {};
    p.prevRate = Number.isFinite(prev.rate) ? prev.rate : p.rate;
    p.prevRank = Number.isFinite(prev.lastRank) ? prev.lastRank : (Number.isFinite(p.rank) ? p.rank : 0);
    p.prevRateRank = Number.isFinite(prev.prevRateRank) ? prev.prevRateRank : (Number.isFinite(p.rateRank) ? p.rateRank : 0);
    p.bonus = Number.isFinite(p.bonus) ? p.bonus : (Number.isFinite(prev.bonus) ? prev.bonus : 0);
  });
}

function calculateRanking(entries, { tieMode = "competition" } = {}) {
  entries.forEach(p => p.rateGain = (Number.isFinite(p.rate) && Number.isFinite(p.prevRate)) ? p.rate - p.prevRate : 0);

  entries = entries.map((p, i) => ({ p, i })).sort((a,b)=> (b.p.rate - a.p.rate) || (a.i - b.i)).map(x=>x.p);

  if (tieMode === "competition") {
    let rank = 1;
    for (let i = 0; i < entries.length; i++) {
      entries[i].rateRank = (i > 0 && entries[i].rate === entries[i-1].rate) ? entries[i-1].rateRank : rank;
      rank++;
    }
  } else {
    entries.forEach((p,i)=>p.rateRank = i+1);
  }
  entries.forEach(p=>p.rank = p.rateRank);

  entries.forEach(p => {
    if (p.prevRateRank == null) p.prevRateRank = p.rateRank;
    p.rankChange = (Number.isFinite(p.prevRank) ? p.prevRank : p.rank) - p.rank;
    p.rateRankChange = (Number.isFinite(p.prevRateRank) ? p.prevRateRank : p.rateRank) - p.rateRank;
  });

  entries.forEach((p,i)=> p.title = i < TITLES.length ? TITLES[i] : "");

  return entries;
}

function storeCurrentData(entries) {
  entries.forEach(p => playerData.set(p.playerId, { rate: p.rate, lastRank: p.rank, prevRateRank: p.rateRank, bonus: p.bonus }));
  savePlayerData();
}

function formatForDisplay(entries) {
  return entries.map(p => {
    const gainDisplay = (Number.isFinite(p.rateGain) && p.rateGain >= 0) ? `+${p.rateGain}` : `${p.rateGain ?? 0}`;
    const rankChangeStr = p.rankChange > 0 ? `↑${p.rankChange}` : p.rankChange < 0 ? `↓${-p.rankChange}` : "—";
    const rateRankChangeStr = p.rateRankChange > 0 ? `↑${p.rateRankChange}` : p.rateRankChange < 0 ? `↓${-p.rateRankChange}` : "—";
    return { ...p, gain: gainDisplay, rankChangeStr, rateRankChangeStr };
  });
}

function processRanking(entries) {
  applyPreviousData(entries);
  const ranked = calculateRanking(entries);
  storeCurrentData(ranked);
  return formatForDisplay(ranked);
}

/* ===============================
   描画
   =============================== */
function renderRankingTable(processedRows) {
  const tbody = $("#rankingTable tbody");
  if (!tbody) return;
  const frag = document.createDocumentFragment();

  processedRows.forEach(p => {
    const tr = document.createElement("tr");
    if (p.rank === 1) tr.classList.add("rank-1");
    else if (p.rank === 2) tr.classList.add("rank-2");
    else if (p.rank === 3) tr.classList.add("rank-3");
    if (p.rateGain > 0) tr.classList.add("gain-up");
    else if (p.rateGain < 0) tr.classList.add("gain-down");

    tr.addEventListener("click", () => showPlayerChart(p.playerId));

    tr.innerHTML = `
      <td title="現在順位" data-sort="${p.rank}">${p.rank}</td>
      <td data-sort="${p.playerId}">${p.playerId}</td>
      <td data-sort="${p.rate}">${p.rate}</td>
      <td title="レート差分" data-sort="${p.rateGain}">${p.gain}</td>
      <td data-sort="${p.bonus}">${p.bonus}</td>
      <td title="順位変動" data-sort="${p.rankChange}">${p.rankChangeStr}</td>
      <td data-sort="${p.prevRank ?? ''}">${p.prevRank ?? "—"}</td>
      <td class="${p.title === "⚡雷" ? "title-thunder" : p.title === "🌪風" ? "title-wind" : p.title === "🔥火" ? "title-fire" : ""}" data-sort="${p.title}">${p.title}</td>
      <td><button class="delete-btn" data-playerid="${p.playerId}">削除</button></td>
    `;

    frag.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(frag);
  renderSideAwards(processedRows);
  announce(`${processedRows.length}件のランキングを更新しました`);

  // -----------------------
  // 削除ボタンのイベント設定
  // -----------------------
  $$(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.playerid;
      if (!id) return;

      if (!confirm(`${id} をランキングから削除しますか？`)) return;

      // lastProcessedRows から削除
      lastProcessedRows = lastProcessedRows.filter(p => p.playerId !== id);

      // playerData から削除
      playerData.delete(id);
      savePlayerData();

      // 削除済みプレイヤーリストにも追加して自動更新でも消す
      deletedPlayers.add(id);
      saveDeletedPlayers();

      // テーブルを再描画
      renderRankingTable(lastProcessedRows);
    });
  });
}

function renderSideAwards(rows) {
  const upUl = $("#awardUp");
  const downUl = $("#awardDown");
  if (!upUl || !downUl) return;

  const topUp = [...rows].sort((a,b)=> b.rateGain - a.rateGain).slice(0,3);
  const topDown = [...rows].sort((a,b)=> a.rateGain - b.rateGain).slice(0,3);

  upUl.innerHTML = topUp.map(p=>`<li>${p.playerId} (${p.gain})</li>`).join("");
  downUl.innerHTML = topDown.map(p=>`<li>${p.playerId} (${p.gain})</li>`).join("");
}

/* ===============================
   検索・ソート
   =============================== */
function attachSearch() {
  const input = $("#searchInput");
  if (!input) return;
  input.addEventListener("input", debounce(() => {
    const term = input.value.trim().toLowerCase();
    $$("#rankingTable tbody tr").forEach(row => row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none");
  }, 200));
}

function attachSorting() {
  const ths = $$("#rankingTable thead th");
  ths.forEach((th, idx) => {
    const type = th.getAttribute("data-type") || inferColumnType(idx);
    let asc = true;
    th.addEventListener("click", () => {
      currentSort = { idx, asc };
      sortTable(idx, asc, type);
      updateSortIndicators(ths, idx, asc);
      asc = !asc;
    });
  });
}

function inferColumnType(idx) {
  const numberCols = new Set([0,2,3,4,5,6]);
  return numberCols.has(idx) ? "number" : "string";
}

function sortTable(idx, asc, type) {
  const tbody = $("#rankingTable tbody");
  if (!tbody) return;
  const dir = asc ? 1 : -1;
  const rows = Array.from(tbody.querySelectorAll("tr"));

  const cmp = (a,b) => {
    const va = a.cells[idx]?.getAttribute("data-sort") ?? a.cells[idx]?.textContent ?? "";
    const vb = b.cells[idx]?.getAttribute("data-sort") ?? b.cells[idx]?.textContent ?? "";
    if (type === "number") {
      const na = Number(va), nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
    }
    return collatorJa.compare(String(va), String(vb)) * dir;
  };

  const indexed = rows.map((r,i)=>({r,i})).sort((x,y)=>{const c=cmp(x.r,y.r); return c!==0?c:x.i - y.i;});
  tbody.innerHTML = "";
  indexed.forEach(({r})=>tbody.appendChild(r));
}

function updateSortIndicators(ths, activeIdx, asc) {
  ths.forEach((th,i)=>{
    if(i===activeIdx){
      th.setAttribute("aria-sort", asc?"ascending":"descending");
      th.classList.toggle("sort-asc",asc);
      th.classList.toggle("sort-desc",!asc);
    }else{
      th.removeAttribute("aria-sort");
      th.classList.remove("sort-asc","sort-desc");
    }
  });
}

/* ===============================
   表拡大モーダル
   =============================== */
function attachExpandTable() {
  const expandBtn = $("#expandTableBtn");
  const expandOverlay = $("#expandOverlay");
  const expandedContainer = $("#expandedRankingContainer");
  const closeBtn = $("#closeExpandBtn");

  if (!expandBtn || !expandOverlay || !expandedContainer || !closeBtn) return;

  expandBtn.addEventListener("click", () => {
    const originalTable = $("#rankingTable");
    if (!originalTable) return;

    // コピーして挿入
    expandedContainer.innerHTML = "";
    const tableClone = originalTable.cloneNode(true);
    tableClone.style.width = "100%";
    tableClone.style.borderCollapse = "collapse";
    expandedContainer.appendChild(tableClone);

    expandOverlay.style.display = "block";
  });

  closeBtn.addEventListener("click", () => {
    expandOverlay.style.display = "none";
  });

  expandOverlay.addEventListener("click", (e) => {
    if (e.target === expandOverlay) expandOverlay.style.display = "none";
  });
}

/* ===============================
   サイドの上昇/下降TOP3クリックで拡大
   =============================== */
function attachSideClickExpand() {
  const expandOverlay = $("#expandOverlay");
  const expandedContainer = $("#expandedRankingContainer");
  const originalTable = $("#rankingTable");
  if (!expandOverlay || !expandedContainer || !originalTable) return;

  // -----------------------------
  // 1. 個別プレイヤー表示
  // -----------------------------
  const renderSinglePlayer = (playerId) => {
    expandedContainer.innerHTML = "";

    const row = Array.from(originalTable.rows)
      .find(tr => tr.cells[1]?.textContent === playerId);
    if (!row) return;

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";

    const thead = originalTable.querySelector("thead").cloneNode(true);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    tbody.appendChild(row.cloneNode(true));
    table.appendChild(tbody);

    expandedContainer.appendChild(table);
    expandOverlay.style.display = "block";
  };

  // 各 li にクリックイベント
  const bindList = (ul) => {
    if (!ul) return;
    ul.querySelectorAll("li").forEach(li => {
      li.style.cursor = "pointer";
      li.addEventListener("click", () => {
        const playerId = li.textContent.split(" ")[0]; // "ID (gain)" 形式
        renderSinglePlayer(playerId);
      });
    });
  };
  bindList($("#awardUp"));
  bindList($("#awardDown"));

  // -----------------------------
  // 2. TOP3まとめ表示（ボタン化）
  // -----------------------------
  const renderMultiplePlayers = (playerIds, title) => {
    expandedContainer.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<h2 style="margin:0 0 1rem 0;">${title}</h2>`;

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";

    const thead = originalTable.querySelector("thead").cloneNode(true);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    playerIds.forEach(pid => {
      const row = Array.from(originalTable.rows)
        .find(tr => tr.cells[1]?.textContent === pid);
      if (row) tbody.appendChild(row.cloneNode(true));
    });
    table.appendChild(tbody);

    wrapper.appendChild(table);
    expandedContainer.appendChild(wrapper);
    expandOverlay.style.display = "block";
  };

  const upBtn = document.querySelector("h4[data-role='expand-up']");
  const downBtn = document.querySelector("h4[data-role='expand-down']");

  if (upBtn) {
    upBtn.style.cursor = "pointer";
    upBtn.addEventListener("click", () => {
      const ids = Array.from($("#awardUp")?.querySelectorAll("li") || [])
        .map(li => li.textContent.split(" ")[0]);
      renderMultiplePlayers(ids, "📈 上昇TOP3");
    });
  }

  if (downBtn) {
    downBtn.style.cursor = "pointer";
    downBtn.addEventListener("click", () => {
      const ids = Array.from($("#awardDown")?.querySelectorAll("li") || [])
        .map(li => li.textContent.split(" ")[0]);
      renderMultiplePlayers(ids, "📉 下降TOP3");
    });
  }
}

/* ===============================
   自動更新・UI
   =============================== */
function setAutoRefresh(sec){
  clearInterval(autoRefreshTimer);
  if(sec>0) autoRefreshTimer=setInterval(refreshRanking, sec*1000);
}

function attachAutoRefreshControls() {
  const toggle = $("#autoRefreshToggle");
  const secInput = $("#autoRefreshSec");
  if (!toggle || !secInput) return;

  if (toggle.checked) {
    const sec = parseInt(secInput.value, 10);
    if (Number.isFinite(sec) && sec >= 5) setAutoRefresh(sec);
  }

  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      const sec = parseInt(secInput.value, 10);
      if (Number.isFinite(sec) && sec >= 5) { setAutoRefresh(sec); announce(`自動更新ON、間隔:${sec}秒`); }
    } else {
      clearInterval(autoRefreshTimer);
      announce("自動更新OFF");
    }
  });

  secInput.addEventListener("change", () => {
    let sec = parseInt(secInput.value,10);
    if(!Number.isFinite(sec)||sec<5){ secInput.value=5; announce("間隔は5秒以上"); return;}
    if(toggle.checked){ setAutoRefresh(sec); announce(`自動更新間隔を${sec}秒に変更`); }
  });
}

/* ===============================
   ローディング・エラー表示
   =============================== */
function showLoading(show){ const el=$("#loadingStatus"); if(el) el.style.display=show?"block":"none"; el.textContent=show?"更新中…":""; }
function showError(msg){ const el=$("#errorBanner"); if(el){ el.textContent=msg; el.style.display="block"; } else console.error(msg); }
function hideError(){ const el=$("#errorBanner"); if(el) el.style.display="none"; }
function announce(text){ const live=$("#ariaLive"); if(live) live.textContent=text; }

/* ===============================
   Chart.js（CORS対応）
   =============================== */
function closeChartModal(){ const modal=$("#chartModal"); if(modal) modal.style.display="none"; }
function attachModalControls(){
  const modal=$("#chartModal"); if(!modal) return;
  const closeBtn=$("#chartCloseBtn")||modal.querySelector(".modal-close");
  if(closeBtn) closeBtn.addEventListener("click",closeChartModal);
  modal.addEventListener("click",e=>{if(e.target===modal)closeChartModal();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeChartModal();});
}

function showPlayerChart(playerId) {
  if(isFetching){ announce("前回更新中…"); return; }
  isFetching=true;
  if(historyChartInstance){ historyChartInstance.destroy(); historyChartInstance=null; }

  fetch(`${GAS_URL}?mode=history&id=${encodeURIComponent(playerId)}`, {cache:"no-store"})
    .then(r=>{if(!r.ok)throw new Error(r.statusText); return r.json();})
    .then(history=>{
      const canvas=$("#historyChart"); if(!canvas) return;
      const ctx = canvas.getContext("2d");
      const labels = history.map(h=>h.date);
      const data = history.map(h=>Number(h.rate));

      historyChartInstance = new Chart(ctx,{
        type:"line",
        data:{labels,datasets:[{label:`${playerId} レート推移`,data,borderColor:"#36a2eb",backgroundColor:"rgba(54,162,235,0.08)",tension:0.25,fill:true,pointRadius:2}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true}}}
      });
      $("#chartModal").style.display="block";
    })
    .catch(e=>showError(`履歴取得失敗: ${e.message}`))
    .finally(()=>isFetching=false);
}

/* ===============================
   CSV fetch & ランキング更新
   =============================== */
async function fetchRankingCSV() {
  try {
    isFetching = true;
    showLoading(true); hideError();

    const res = await fetch(`${GAS_URL}?mode=ranking`, {cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    if(rows.length<=1) return [];

    const [header,...data] = rows;
    const hmap = header.map(h=>h.trim().toLowerCase());
    const idxId = hmap.indexOf("playerid")!==-1?hmap.indexOf("playerid"):0;
    const idxRate = hmap.indexOf("rate")!==-1?hmap.indexOf("rate"):2;
    const idxBonus = hmap.indexOf("bonus");

    return data.map(cols=>{
      const playerId = cols[idxId];
      const rate = Number(cols[idxRate]);
      const bonus = idxBonus>=0?Number(cols[idxBonus]):0;
      return {playerId, rate, bonus};
    }).filter(r=>r.playerId && Number.isFinite(r.rate));
  } catch(e){ showError(`ランキング取得失敗: ${e.message}`); return []; }
  finally { showLoading(false); isFetching=false; }
}

function downloadCSV() {
  if (!lastProcessedRows || !lastProcessedRows.length) {
    alert("ダウンロードするデータがありません");
    return;
  }

  const header = ["Rank","PlayerId","Rate","Gain","Bonus","RankChange","PrevRank","Title"];
  const rows = lastProcessedRows.map(p => [
    p.rank, p.playerId, p.rate, p.gain, p.bonus, p.rankChangeStr, p.prevRank ?? "—", p.title
  ]);

  const csvContent = [header, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ranking_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function refreshRanking() {
  const rows = await fetchRankingCSV();
  lastProcessedRows = processRanking(rows);
  renderRankingTable(lastProcessedRows);

  // 前回ソートを維持
  const ths = $$("#rankingTable thead th");
  if(ths.length && currentSort) {
    const type = ths[currentSort.idx].getAttribute("data-type")||inferColumnType(currentSort.idx);
    sortTable(currentSort.idx, currentSort.asc, type);
    updateSortIndicators(ths, currentSort.idx, currentSort.asc);
  }
}

/* ===============================
   初期化
   =============================== */
document.addEventListener("DOMContentLoaded", () => {
  loadPlayerData();
  attachSearch();
  attachSorting();
  attachModalControls();
  attachAutoRefreshControls();
  refreshRanking();
  attachExpandTable();
  attachSideClickExpand();

  // ===== 最新ログ表示用モーダル（履歴蓄積版） =====
  const logBtn = $("#showLatestLogBtn");
  const logOverlay = $("#logOverlay");
  const logContent = $("#logContent");
  const closeLogBtn = $("#closeLogBtn");

  // 履歴配列
  const rankingHistory = [];

  if (logBtn && logOverlay && logContent && closeLogBtn) {
    // ボタンで表示
    logBtn.addEventListener("click", () => {
      if (rankingHistory.length === 0) {
        logContent.innerHTML = "<em>まだランキングが取得されていません</em>";
      } else {
        const html = rankingHistory.map((snapshot, idx) => {
          const time = snapshot.time;
          const rowsHtml = snapshot.rows.map(p => 
            `<div>
              <strong>${p.rank}. ${p.playerId}</strong> 
              総合レート: ${p.rate} / 獲得: ${p.gain} / ボーナス: ${p.bonus} / 順位変動: ${p.rankChangeStr}
            </div>`
          ).join("");
          return `<div style="margin-bottom:1rem;"><em>${time}</em>${rowsHtml}</div>`;
        }).join("<hr>");
        logContent.innerHTML = html;
      }
      logOverlay.style.display = "block";
    });

    closeLogBtn.addEventListener("click", () => logOverlay.style.display = "none");
    logOverlay.addEventListener("click", e => { if (e.target === logOverlay) logOverlay.style.display = "none"; });
  }

  // ===== refreshRanking の後で履歴に追加 =====
  const originalRefreshRanking = refreshRanking;
  refreshRanking = async function() {
    await originalRefreshRanking();
    if (lastProcessedRows && lastProcessedRows.length) {
      rankingHistory.push({
        time: new Date().toLocaleString(),
        rows: JSON.parse(JSON.stringify(lastProcessedRows)) // ディープコピー
      });
      // 履歴を最新5件だけに制限
      if (rankingHistory.length > 5) rankingHistory.shift();
    }
  };
});
