// ===============================
// 定数設定
// ===============================
const GAS_URL = "https://script.google.com/macros/s/…/exec";
const TITLES = ["⚡雷", "🌪風", "🔥火"];
let playerData = new Map();
let autoRefreshTimer = null;

// ===============================
// 基本処理
// ===============================
function applyPreviousData(entries) {
  entries.forEach(p => {
    const prev = playerData.get(p.playerId) || {};
    p.prevRate = prev.rate ?? p.rate;
    p.prevRank = prev.lastRank ?? p.rank ?? 0;
    p.prevRateRank = prev.prevRateRank ?? p.rateRank ?? 0;
    p.bonus = p.bonus ?? prev.bonus ?? 0;
  });
}

function calculateRanking(entries) {
  entries.forEach(p => p.rateGain = p.rate - p.prevRate);
  entries.sort((a, b) => b.rate - a.rate);
  entries.forEach((p, i) => p.rateRank = i + 1);
  entries.forEach(p => {
    if (p.prevRateRank == null) p.prevRateRank = p.rateRank;
    p.rankChange = p.prevRank - (p.rank ?? p.prevRank);
    p.rateRankChange = p.prevRateRank - p.rateRank;
  });
  entries.forEach((p, i) => p.title = i < TITLES.length ? TITLES[i] : "");
}

function storeCurrentData(entries) {
  entries.forEach(p => {
    playerData.set(p.playerId, {
      rate: p.rate,
      lastRank: p.rank,
      prevRateRank: p.rateRank,
      bonus: p.bonus
    });
  });
}

function formatForDisplay(entries) {
  return entries.map(p => {
    const gainDisplay = p.rateGain >= 0 ? "+" + p.rateGain : p.rateGain.toString();
    const rankChangeStr = p.rankChange > 0 ? `↑${p.rankChange}` :
                          p.rankChange < 0 ? `↓${-p.rankChange}` : "—";
    const rateRankChangeStr = p.rateRankChange > 0 ? `↑${p.rateRankChange}` :
                              p.rateRankChange < 0 ? `↓${-p.rateRankChange}` : "—";
    return { ...p, gain: gainDisplay, rankChangeStr, rateRankChangeStr };
  });
}

function processRanking(entries) {
  applyPreviousData(entries);
  calculateRanking(entries);
  storeCurrentData(entries);
  return formatForDisplay(entries);
}

// ===============================
// 描画系
// ===============================
function renderRankingTable(processedRows) {
  const tbody = document.querySelector("#rankingTable tbody");
  const frag = document.createDocumentFragment();

  processedRows.forEach(p => {
    const tr = document.createElement("tr");

    // ===== 順位クラス付与 =====
    if (p.rank === 1) tr.classList.add("rank-1");
    else if (p.rank === 2) tr.classList.add("rank-2");
    else if (p.rank === 3) tr.classList.add("rank-3");

    // ===== レート増減クラス付与 =====
    if (p.rateGain > 0) tr.classList.add("gain-up");
    else if (p.rateGain < 0) tr.classList.add("gain-down");

    // ===== HTML構築 =====
    tr.innerHTML = `
      <td title="現在順位">${p.rank}</td>
      <td>${p.playerId}</td>
      <td>${p.rate}</td>
      <td title="レート差分">${p.gain}</td>
      <td>${p.bonus}</td>
      <td title="順位変動">${p.rankChangeStr}</td>
      <td>${p.prevRank ?? "—"}</td>
      <td class="${
        p.title === "⚡雷" ? "title-thunder" :
        p.title === "🌪風" ? "title-wind" :
        p.title === "🔥火" ? "title-fire" : ""
      }">${p.title}</td>
    `;

    // 個別履歴グラフイベント
    tr.addEventListener("click", () => showPlayerChart(p.playerId));

    frag.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(frag);

  renderSideAwards(processedRows);
}

function renderSideAwards(rows) {
  const topUp = [...rows].sort((a,b)=>b.rateGain-a.rateGain).slice(0,3);
  const topDown = [...rows].sort((a,b)=>a.rateGain-b.rateGain).slice(0,3);
  document.getElementById("awardUp").innerHTML = topUp.map(p=>`<li>${p.playerId} (${p.gain})</li>`).join("");
  document.getElementById("awardDown").innerHTML = topDown.map(p=>`<li>${p.playerId} (${p.gain})</li>`).join("");
}

// ===============================
// 検索・ソート・期間
// ===============================
document.getElementById("searchInput")?.addEventListener("input", e => {
  const term = e.target.value.toLowerCase();
  document.querySelectorAll("#rankingTable tbody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
  });
});

document.querySelectorAll("#rankingTable th").forEach((th, idx) => {
  let asc = true;
  th.addEventListener("click", () => {
    sortTable(idx, asc);
    asc = !asc;
  });
});

function sortTable(idx, asc) {
  const tbody = document.querySelector("#rankingTable tbody");
  const rows = Array.from(tbody.querySelectorAll("tr"));
  rows.sort((a,b)=>a.cells[idx].textContent.localeCompare(b.cells[idx].textContent, 'ja', { numeric:true })*(asc?1:-1));
  tbody.innerHTML = "";
  rows.forEach(r=>tbody.appendChild(r));
}

// ===============================
// 自動更新
// ===============================
function setAutoRefresh(sec) {
  clearInterval(autoRefreshTimer);
  if (sec > 0) autoRefreshTimer = setInterval(refreshRanking, sec*1000);
}

// ===============================
// 履歴グラフ（Chart.js想定）
// ===============================
function showPlayerChart(playerId) {
  fetch(`${GAS_URL}?mode=history&id=${playerId}`)
    .then(res=>res.json())
    .then(history=>{
      const ctx = document.getElementById("historyChart").getContext("2d");
      new Chart(ctx, {
        type:'line',
        data: {
          labels: history.map(h=>h.date),
          datasets: [{ label:`${playerId} レート推移`, data: history.map(h=>h.rate), borderColor:'#36a2eb', fill:false }]
        }
      });
      document.getElementById("chartModal").style.display="block";
    });
}

// ===============================
// データ更新
// ===============================
async function refreshRanking() {
  try {
    const res = await fetch(GAS_URL);
    const csvText = await res.text();
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length<=1) return;
    const [, ...dataLines] = lines;
    const rows = dataLines.map(line=>{
      const [playerId, rank, rate] = line.split(",");
      return { playerId, rank:Number(rank), rate:Number(rate) };
    });
    renderRankingTable(processRanking(rows));
  } catch(e) {
    console.error("更新失敗", e);
  }
}

// ===============================
// 初期化
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  refreshRanking();
  setupAwardUI();
});
