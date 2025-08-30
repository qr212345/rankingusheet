"use strict";

/* ===============================
   Configuration
   =============================== */
const GAS_URL = "https://script.google.com/macros/s/AKfycbxnqDdZJPE0BPN5TRpqR49ejScQKyKADygXzw5tcp6RdCauKbeTfeQTWpP6WAKYK7Ue/exec";
const SECRET_KEY = "kosen-brain-super-secret"; // GAS の doPost が期待する secret
const ADMIN_PASSWORD = "babanuki123";         // 管理者モード切替の簡易パスワード（任意で変更）
const TITLES = ["⚡雷", "🌪風", "🔥火"];
const STORAGE_KEY = "rankingPlayerData_v2";
const DELETED_KEY = "rankingDeletedPlayers";
const HISTORY_KEY = "rankingHistory_v2";

/* ===============================
   Small utilities
   =============================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const collatorJa = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function debounce(fn, wait = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function fmtChange(val, up = "↑", down = "↓") {
  return val > 0 ? `${up}${val}` : val < 0 ? `${down}${-val}` : "—";
}

/* ===============================
   App state
   =============================== */
let playerData = new Map();
let deletedPlayers = new Set();
let lastProcessedRows = [];
let currentSort = { idx: 0, asc: true };
let isFetching = false;
let autoRefreshTimer = null;
let historyChartInstance = null;
let isAdmin = false;
let rankingHistory = [];

/* ===============================
   Local storage helpers
   =============================== */
function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn("loadFromStorage failed", key, e);
    return fallback;
  }
}
function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn("saveToStorage failed", key, e); }
}

function loadPlayerData() {
  const raw = loadFromStorage(STORAGE_KEY, null);
  if (raw) playerData = new Map(raw);
}
function savePlayerData() { saveToStorage(STORAGE_KEY, Array.from(playerData.entries())); }

function loadDeletedPlayers() {
  const arr = loadFromStorage(DELETED_KEY, []);
  deletedPlayers = new Set(arr);
}
function saveDeletedPlayers() { saveToStorage(DELETED_KEY, Array.from(deletedPlayers)); }

function loadRankingHistory() { rankingHistory = loadFromStorage(HISTORY_KEY, []); }
function saveRankingHistory() { saveToStorage(HISTORY_KEY, rankingHistory); }

/* ===============================
   Admin mode
   =============================== */
function setAdminMode(enabled) {
  isAdmin = Boolean(enabled);
  document.body.classList.toggle("admin-mode", isAdmin);
  // 表の削除ボタン表示制御（存在するものすべて）
  $$("#rankingTable .delete-btn").forEach(btn => btn.style.display = isAdmin ? "inline-block" : "none");
  const autoRefreshControls = $("#autoRefreshToggle")?.parentElement;
  if (autoRefreshControls) autoRefreshControls.style.display = isAdmin ? "block" : "none";
}

/* ===============================
   CSV parser (simple, handles quoted fields)
   =============================== */
function parseCSV(text) {
  if (!text) return [];
  // normalize newlines
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== "");
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
   Ranking computation helpers
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

  // sort by rate desc, stable via original index
  entries = entries.map((p, i) => ({ p, i })).sort((a, b) => (b.p.rate - a.p.rate) || (a.i - b.i)).map(x => x.p);

  if (tieMode === "competition") {
    let rank = 1;
    for (let i = 0; i < entries.length; i++) {
      entries[i].rateRank = (i > 0 && entries[i].rate === entries[i - 1].rate) ? entries[i - 1].rateRank : rank;
      rank++;
    }
  } else {
    entries.forEach((p, i) => p.rateRank = i + 1);
  }

  entries.forEach(p => p.rank = p.rateRank);

  entries.forEach(p => {
    if (p.prevRateRank == null) p.prevRateRank = p.rateRank;
    p.rankChange = (Number.isFinite(p.prevRank) ? p.prevRank : p.rank) - p.rank;
    p.rateRankChange = (Number.isFinite(p.prevRateRank) ? p.prevRateRank : p.rateRank) - p.rateRank;
  });

  entries.forEach((p, i) => p.title = i < TITLES.length ? TITLES[i] : "");

  return entries;
}

function storeCurrentData(entries) {
  entries.forEach(p => playerData.set(p.playerId, { rate: p.rate, lastRank: p.rank, prevRateRank: p.rateRank, bonus: p.bonus }));
  savePlayerData();
}

function formatForDisplay(entries) {
  return entries.map(p => ({
    ...p,
    gain: (Number.isFinite(p.rateGain) && p.rateGain >= 0) ? `+${p.rateGain}` : `${p.rateGain ?? 0}`,
    rankChangeStr: fmtChange(p.rankChange),
    rateRankChangeStr: fmtChange(p.rateRankChange)
  }));
}

function processRanking(entries) {
  applyPreviousData(entries);
  const ranked = calculateRanking(entries);
  storeCurrentData(ranked);
  return formatForDisplay(ranked);
}

/* ===============================
   Render functions
   =============================== */
function renderSideAwards(rows) {
  const upUl = $("#awardUp"), downUl = $("#awardDown");
  if (!upUl || !downUl) return;
  const topUp = [...rows].sort((a, b) => b.rateGain - a.rateGain).slice(0, 3);
  const topDown = [...rows].sort((a, b) => a.rateGain - b.rateGain).slice(0, 3);
  upUl.innerHTML = topUp.map(p => `<li>${p.playerId} (${p.gain})</li>`).join("");
  downUl.innerHTML = topDown.map(p => `<li>${p.playerId} (${p.gain})</li>`).join("");
}

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

    // store id for convenience
    tr.dataset.playerId = p.playerId;

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

    // clicking row opens chart
    tr.addEventListener("click", (e) => {
      // ignore clicks on delete button
      if (e.target.closest(".delete-btn")) return;
      showPlayerChart(p.playerId);
    });

    frag.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(frag);
  renderSideAwards(processedRows);
  announce(`${processedRows.length}件のランキングを更新しました`);

  // show/hide delete buttons depending on admin
  $$("#rankingTable .delete-btn").forEach(btn => btn.style.display = isAdmin ? "inline-block" : "none");
}

/* ===============================
   Delete handling (delegated)
   - Sends a POST with URLSearchParams: mode=delete, playerId, secret
   - Expects JSON { status: "ok" } on success
   =============================== */
async function performDeleteOnServer(playerId) {
  const body = new URLSearchParams({
    mode: "delete",
    playerId,
    secret: SECRET_KEY
  });

  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString()
  });

  // try parse json, but be defensive
  let json;
  try { json = await res.json(); } catch (e) { throw new Error("Server returned non-JSON response"); }
  if (!json || json.status !== "ok") {
    throw new Error(json && json.error ? json.error : "削除に失敗しました");
  }

  return json;
}

/* Attach one delegated listener for delete */
(function attachDelegatedDelete() {
  const tbody = $("#rankingTable tbody");
  if (!tbody) return;
  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn) return;
    // only admin can delete
    if (!isAdmin) { alert("管理者モードでのみ削除できます"); return; }
    e.stopPropagation();

    const id = btn.dataset.playerid;
    if (!id) return;
    if (!confirm(`${id} をランキングから削除しますか？`)) return;

    // optimistic UI disabled until server confirms
    try {
      showLoading(true);
      await performDeleteOnServer(id);
    } catch (err) {
      showError("削除リクエスト失敗: " + (err.message || err));
      showLoading(false);
      return;
    } finally {
      showLoading(false);
    }

    // update client state and UI
    lastProcessedRows = lastProcessedRows.filter(p => p.playerId !== id);
    playerData.delete(id);
    savePlayerData();
    deletedPlayers.add(id);
    saveDeletedPlayers();

    renderRankingTable(lastProcessedRows);
    announce(`${id} を削除しました`);
  });
})();

/* ===============================
   Search / Sort
   =============================== */
function attachSearch() {
  const input = $("#searchInput");
  if (!input) return;
  input.addEventListener("input", debounce(() => {
    const term = input.value.trim().toLowerCase();
    $$("#rankingTable tbody tr").forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
    });
  }, 200));
}

function inferColumnType(idx) {
  const numberCols = new Set([0, 2, 3, 4, 5, 6]);
  return numberCols.has(idx) ? "number" : "string";
}

function sortTable(idx, asc, type) {
  const tbody = $("#rankingTable tbody");
  if (!tbody) return;
  const dir = asc ? 1 : -1;
  const rows = Array.from(tbody.querySelectorAll("tr"));

  const cmp = (a, b) => {
    const va = a.cells[idx]?.getAttribute("data-sort") ?? a.cells[idx]?.textContent ?? "";
    const vb = b.cells[idx]?.getAttribute("data-sort") ?? b.cells[idx]?.textContent ?? "";
    if (type === "number") {
      const na = Number(va), nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
    }
    return collatorJa.compare(String(va), String(vb)) * dir;
  };

  const indexed = rows.map((r, i) => ({ r, i })).sort((x, y) => {
    const c = cmp(x.r, y.r);
    return c !== 0 ? c : x.i - y.i;
  });

  tbody.innerHTML = "";
  indexed.forEach(({ r }) => tbody.appendChild(r));
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

function updateSortIndicators(ths, activeIdx, asc) {
  ths.forEach((th, i) => {
    if (i === activeIdx) {
      th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      th.classList.toggle("sort-asc", asc);
      th.classList.toggle("sort-desc", !asc);
    } else {
      th.removeAttribute("aria-sort");
      th.classList.remove("sort-asc", "sort-desc");
    }
  });
}

/* ===============================
   Expand table / side-click expand
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
    expandedContainer.innerHTML = "";
    const tableClone = originalTable.cloneNode(true);
    tableClone.style.width = "100%";
    tableClone.style.borderCollapse = "collapse";
    expandedContainer.appendChild(tableClone);
    expandOverlay.style.display = "block";
  });

  closeBtn.addEventListener("click", () => expandOverlay.style.display = "none");
  expandOverlay.addEventListener("click", (e) => { if (e.target === expandOverlay) expandOverlay.style.display = "none"; });
}

function attachSideClickExpand() {
  const expandOverlay = $("#expandOverlay");
  const expandedContainer = $("#expandedRankingContainer");
  const originalTable = $("#rankingTable");
  if (!expandOverlay || !expandedContainer || !originalTable) return;

  const renderSinglePlayer = (playerId) => {
    expandedContainer.innerHTML = "";
    const row = Array.from(originalTable.rows).find(tr => tr.cells[1]?.textContent === playerId);
    if (!row) return;
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.appendChild(originalTable.querySelector("thead").cloneNode(true));
    const tbody = document.createElement("tbody");
    tbody.appendChild(row.cloneNode(true));
    table.appendChild(tbody);
    expandedContainer.appendChild(table);
    expandOverlay.style.display = "block";
  };

  const renderMultiplePlayers = (playerIds, title) => {
    expandedContainer.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<h2 style="margin:0 0 1rem 0;">${title}</h2>`;
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.appendChild(originalTable.querySelector("thead").cloneNode(true));
    const tbody = document.createElement("tbody");
    playerIds.forEach(pid => {
      const row = Array.from(originalTable.rows).find(tr => tr.cells[1]?.textContent === pid);
      if (row) tbody.appendChild(row.cloneNode(true));
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    expandedContainer.appendChild(wrapper);
    expandOverlay.style.display = "block";
  };

  function bindList(ul) {
    if (!ul) return;
    ul.querySelectorAll("li").forEach(li => {
      li.style.cursor = "pointer";
      li.addEventListener("click", () => {
        const playerId = li.textContent.split(" ")[0];
        renderSinglePlayer(playerId);
      });
    });
  }

  bindList($("#awardUp"));
  bindList($("#awardDown"));

  const upBtn = document.querySelector("h4[data-role='expand-up']");
  const downBtn = document.querySelector("h4[data-role='expand-down']");
  if (upBtn) upBtn.addEventListener("click", () => {
    const ids = Array.from($("#awardUp")?.querySelectorAll("li") || []).map(li => li.textContent.split(" ")[0]);
    renderMultiplePlayers(ids, "📈 上昇TOP3");
  });
  if (downBtn) downBtn.addEventListener("click", () => {
    const ids = Array.from($("#awardDown")?.querySelectorAll("li") || []).map(li => li.textContent.split(" ")[0]);
    renderMultiplePlayers(ids, "📉 下降TOP3");
  });
}

/* ===============================
   Auto refresh UI
   =============================== */
function setAutoRefresh(sec) {
  clearInterval(autoRefreshTimer);
  if (sec > 0) autoRefreshTimer = setInterval(refreshRanking, sec * 1000);
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
    let sec = parseInt(secInput.value, 10);
    if (!Number.isFinite(sec) || sec < 5) { secInput.value = 5; announce("間隔は5秒以上"); return; }
    if (toggle.checked) { setAutoRefresh(sec); announce(`自動更新間隔を${sec}秒に変更`); }
  });
}

/* ===============================
   Loading / Error / Live announce
   =============================== */
function showLoading(show) {
  const el = $("#loadingStatus");
  if (!el) return;
  el.style.display = show ? "block" : "none";
  el.textContent = show ? "更新中…" : "";
}
function showError(msg) {
  const el = $("#errorBanner");
  if (el) { el.textContent = msg; el.style.display = "block"; } else console.error(msg);
}
function hideError() {
  const el = $("#errorBanner");
  if (el) el.style.display = "none";
}
function announce(text) {
  const live = $("#ariaLive");
  if (live) live.textContent = text;
}

/* ===============================
   Chart modal
   =============================== */
function attachModalControls() {
  const modal = $("#chartModal"); if (!modal) return;
  const closeBtn = $("#chartCloseBtn") || modal.querySelector(".modal-close");
  if (closeBtn) closeBtn.addEventListener("click", () => modal.style.display = "none");
  modal.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") modal.style.display = "none"; });
}

async function showPlayerChart(playerId) {
  if (isFetching) { announce("前回更新中…"); return; }
  isFetching = true;
  if (historyChartInstance) { historyChartInstance.destroy(); historyChartInstance = null; }

  try {
    const res = await fetch(`${GAS_URL}?mode=history&id=${encodeURIComponent(playerId)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const history = await res.json();
    const canvas = $("#historyChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const labels = history.map(h => h.date);
    const data = history.map(h => Number(h.rate));
    historyChartInstance = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ label: `${playerId} レート推移`, data, borderColor: "#36a2eb", backgroundColor: "rgba(54,162,235,0.08)", tension: 0.25, fill: true, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } } }
    });
    $("#chartModal").style.display = "block";
  } catch (err) {
    showError("履歴取得失敗: " + (err.message || err));
  } finally {
    isFetching = false;
  }
}

/* ===============================
   Fetch ranking CSV and convert to objects
   =============================== */
async function fetchRankingCSV() {
  try {
    isFetching = true; showLoading(true); hideError();
    const res = await fetch(`${GAS_URL}?mode=ranking`, { cache: "no-store" });
    if (!(res.status >= 200 && res.status < 300)) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    if (rows.length <= 1) return [];
    const [header, ...data] = rows;
    const hmap = header.map(h => h.trim().toLowerCase());
    const idxId = hmap.indexOf("playerid") !== -1 ? hmap.indexOf("playerid") : 0;
    const idxRate = hmap.indexOf("rate") !== -1 ? hmap.indexOf("rate") : 2;
    const idxBonus = hmap.indexOf("bonus");

    return data.map(cols => {
      const playerId = cols[idxId];
      const rate = Number(cols[idxRate]);
      const bonus = idxBonus >= 0 ? Number(cols[idxBonus]) : 0;
      return { playerId, rate, bonus };
    }).filter(r => r.playerId && Number.isFinite(r.rate));
  } catch (err) {
    showError("ランキング取得失敗: " + (err.message || err));
    return [];
  } finally {
    showLoading(false); isFetching = false;
  }
}

/* ===============================
   Download CSV (client-side)
   =============================== */
function downloadCSV() {
  if (!lastProcessedRows || !lastProcessedRows.length) { alert("ダウンロードするデータがありません"); return; }
  const header = ["Rank", "PlayerId", "Rate", "Gain", "Bonus", "RankChange", "PrevRank", "Title"];
  const rows = lastProcessedRows.map(p => [p.rank, p.playerId, p.rate, p.gain, p.bonus, p.rankChangeStr, p.prevRank ?? "—", p.title]);
  const csvContent = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ranking_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===============================
   Main refresh pipeline
   =============================== */
async function refreshRanking() {
  const rows = await fetchRankingCSV();
  const filtered = rows.filter(r => !deletedPlayers.has(r.playerId));
  lastProcessedRows = processRanking(filtered);
  renderRankingTable(lastProcessedRows);

  // preserve sort if applicable
  const ths = $$("#rankingTable thead th");
  if (ths.length && currentSort) {
    const type = ths[currentSort.idx].getAttribute("data-type") || inferColumnType(currentSort.idx);
    sortTable(currentSort.idx, currentSort.asc, type);
    updateSortIndicators(ths, currentSort.idx, currentSort.asc);
  }

  // history save (latest 5)
  if (lastProcessedRows.length) {
    rankingHistory.push({ time: new Date().toLocaleString(), rows: JSON.parse(JSON.stringify(lastProcessedRows)) });
    if (rankingHistory.length > 5) rankingHistory.shift();
    saveRankingHistory();
  }
}

/* ===============================
   Initialization
   =============================== */
document.addEventListener("DOMContentLoaded", () => {
  // load caches
  loadPlayerData();
  loadDeletedPlayers();
  loadRankingHistory();

  // wire UI
  attachSearch();
  attachSorting();
  attachModalControls();
  attachAutoRefreshControls();
  attachExpandTable();
  attachSideClickExpand();

  // initial fetch
  refreshRanking();

  // admin toggle
  document.getElementById("adminToggleBtn")?.addEventListener("click", () => {
    const pw = prompt("管理者パスワードを入力してください:");
    if (pw === ADMIN_PASSWORD) { setAdminMode(true); alert("管理者モード ON"); }
    else { alert("パスワードが違います"); setAdminMode(false); }
  });

  // latest logs modal
  const logBtn = $("#showLatestLogBtn");
  const logOverlay = $("#logOverlay");
  const logContent = $("#logContent");
  const closeLogBtn = $("#closeLogBtn");
  if (logBtn && logOverlay && logContent && closeLogBtn) {
    logBtn.addEventListener("click", () => {
      if (rankingHistory.length === 0) {
        logContent.innerHTML = "<em>まだランキングが取得されていません</em>";
      } else {
        const html = rankingHistory.map(snapshot => {
          const time = snapshot.time;
          const rowsHtml = snapshot.rows.map(p => `<div><strong>${p.rank}. ${p.playerId}</strong> 総合レート: ${p.rate} / 獲得: ${p.gain} / ボーナス: ${p.bonus} / 順位変動: ${p.rankChangeStr}</div>`).join("");
          return `<div style="margin-bottom:1rem;"><em>${time}</em>${rowsHtml}</div>`;
        }).join("<hr>");
        logContent.innerHTML = html;
      }
      logOverlay.style.display = "block";
    });
    closeLogBtn.addEventListener("click", () => logOverlay.style.display = "none");
    logOverlay.addEventListener("click", e => { if (e.target === logOverlay) logOverlay.style.display = "none"; });
  }
});

/* ===============================
   Expose some functions to global (optional)
   - Useful for debugging or hooking buttons
   =============================== */
window.refreshRanking = refreshRanking;
window.downloadCSV = downloadCSV;
window.setAdminMode = setAdminMode;
window.saveDeletedPlayers = saveDeletedPlayers;
