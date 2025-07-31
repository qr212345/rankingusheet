const GAS_URL = "https://script.google.com/macros/s/AKfycbxmwhP8STmIUtypIMSFuiltAWOiQDlvPaVNAWT_5D7jGCM-xbAz44N2mStbideuckw/exec";
const SECRET = "kosen-brain-super-secret";  // ※未使用。将来的な認証用などに。

// 過去データを保持（GASから読み込み）
let playerData = {};

/**
 * ランキングデータ処理
 */
function processRankingData(rows) {
  rows.sort((a, b) => b["レート"] - a["レート"]);

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const playerId = p["Player ID"];

    const prev = playerData[playerId] || {};
    const prevRate = prev.rate ?? p["レート"];
    const prevRank = prev.lastRank ?? i + 1;

    p.currentRank = i + 1;
    p.gainRate = Number(p["レート"]) - prevRate;
    p.rankChange = prevRank - p.currentRank;
    p.specialPoint = Number(p["ボーナス"]) || prev.bonus || 0;
    p.title = "";
  }

  const titles = ["⚡雷", "🌪風", "🔥火"];
  for (let i = 0; i < 3 && i < rows.length; i++) {
    rows[i].title = titles[i];
  }

  return rows;
}

/**
 * ランキング表の描画
 */
function renderRankingTable(rows) {
  const tbody = document.querySelector("#rankingTable tbody");
  tbody.innerHTML = "";

  rows.forEach(p => {
    let changeText = "—";
    if (p.rankChange > 0) changeText = `↑${p.rankChange}`;
    else if (p.rankChange < 0) changeText = `↓${-p.rankChange}`;

    const gainRateText = `${p.gainRate >= 0 ? "+" : ""}${p.gainRate}`;
    const bonusText = p.specialPoint > 0 ? `${p.specialPoint}🔥` : "";

    const tr = document.createElement("tr");
    tr.classList.add(`rank-${p.currentRank}`);

    tr.innerHTML = `
      <td>${p.currentRank}</td>
      <td>${p["Player ID"]}</td>
      <td>${p["レート"]}</td>
      <td>${gainRateText}</td>
      <td>${bonusText}</td>
      <td>${changeText}</td>
      <td>${playerData[p["Player ID"]]?.lastRank ?? "—"}</td>
      <td>${p.title}</td>
    `;
    tbody.appendChild(tr);
  });

  const podiumDiv = document.getElementById("podium");
  podiumDiv.innerHTML = "";
  rows.slice(0, 3).forEach(p => {
    const div = document.createElement("div");
    div.className = "podium-player";
    if (p.currentRank === 1) {
      div.classList.add("first");
      div.classList.add("title-thunder");
    } else if (p.currentRank === 2) {
      div.classList.add("second");
      div.classList.add("title-wind");
    } else if (p.currentRank === 3) {
      div.classList.add("third");
      div.classList.add("title-fire");
    }

    div.innerHTML = `
      <h2>${p.currentRank}位 🏆</h2>
      <p>ID: ${p["Player ID"]}</p>
      <p>レート: ${p["レート"]}</p>
      <p>${p.title}</p>
    `;
    podiumDiv.appendChild(div);
  });
}

/**
 * GASからランキング情報を取得
 */
async function refreshRanking() {
  try {
    const res = await fetch(GAS_URL + "?mode=ranking");
    const data = await res.json();

    playerData = data.playerData || {};
    const rows = data.rateRanking;
    if (!rows) {
      console.warn("❌ ランキングデータなし");
      return;
    }

    const processedRows = processRankingData(rows);
    renderRankingTable(processedRows);
  } catch (err) {
    console.error("読み込み失敗:", err);
  }
}

/**
 * 最新ログをモーダルで表示
 */
async function showLatestLog() {
  try {
    const res = await fetch(GAS_URL + "?mode=log");
    const logs = await res.json();

    if (!Array.isArray(logs) || logs.length === 0 || !logs[logs.length - 1]?.log) {
      alert("ログデータが見つかりません。");
      return;
    }

    const latest = logs[logs.length - 1];
    const html = [`<p>${latest.timestamp}</p><ul>`];
    latest.log.forEach(p => {
      html.push(`<li>${p.playerId}: 順位${p.lastRank}, レート${p.rate}</li>`);
    });
    html.push("</ul>");

    document.getElementById("logContent").innerHTML = html.join("");
    document.getElementById("logOverlay").style.display = "block";
  } catch (err) {
    alert("ログの取得に失敗しました。");
    console.error(err);
  }
}

/**
 * CSVログをダウンロード
 */
function downloadCSV() {
  const url = GAS_URL + "?mode=csv";
  fetch(url)
    .then(res => res.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "ranking_log.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    })
    .catch(err => {
      console.error("CSVダウンロード失敗:", err);
      alert("CSVのダウンロードに失敗しました。");
    });
}

/**
 * イベント登録まとめ
 */
function setupEventListeners() {
  const showLogBtn = document.getElementById("showLatestLogBtn");
  if (showLogBtn) {
    showLogBtn.addEventListener("click", showLatestLog);
  } else {
    console.warn("📛 showLatestLogBtn が見つかりません。");
  }

  const loadBtn = document.getElementById("loadRankingBtn");
  if (loadBtn) {
    loadBtn.addEventListener("click", refreshRanking);
  }

  const backBtn = document.getElementById("backButton");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      document.getElementById("logOverlay").style.display = "none";
    });
  }

  const closeBtn = document.getElementById("closeLogBtn");
  const overlay = document.getElementById("logOverlay");
  if (closeBtn && overlay) {
    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });
  }
}

/**
 * 初期処理
 */
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  refreshRanking();
});
