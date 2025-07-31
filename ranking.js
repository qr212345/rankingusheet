const GAS_URL = "https://script.google.com/macros/s/AKfycbxmwhP8STmIUtypIMSFuiltAWOiQDlvPaVNAWT_5D7jGCM-xbAz44N2mStbideuckw/exec";
const SECRET = "kosen-brain-super-secret";  // ※未使用。将来的な認証用などに。

// 過去データを保持（GASから読み込み）
let playerData = {};

/**
 * ランキングデータ処理：
 * - 総合レートで降順ソート
 * - 過去データから獲得レート、順位変動、称号を計算
 * @param {Array} rows ランキングデータ配列 [{ Player ID, レート, ボーナス, ... }, ...]
 * @returns {Array} 処理済みデータ配列（称号付与済み）
 */
function processRankingData(rows) {
  // レート降順ソート
  rows.sort((a, b) => b["レート"] - a["レート"]);

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const playerId = p["Player ID"];

    const prev = playerData[playerId] || {};
    const prevRate = prev.rate ?? p["レート"];  // 過去レートがなければ今回レートを使う
    const prevRank = prev.lastRank ?? i + 1;    // 過去順位がなければ現順位

    p.currentRank = i + 1;  // 今回順位

    // 獲得レート = 今回レート - 過去レート
    p.gainRate = Number(p["レート"]) - prevRate;

    // 順位変動 = 過去順位 - 今回順位
    p.rankChange = prevRank - p.currentRank;

    // 特別ポイント（ボーナス）：今回データ優先、無ければ過去のbonus
    p.specialPoint = Number(p["ボーナス"]) || prev.bonus || 0;

    p.title = "";  // 称号はあとで付与
  }

  // 上位3名に称号付与
  const titles = ["⚡雷", "🌪風", "🔥火"];
  for (let i = 0; i < 3 && i < rows.length; i++) {
    rows[i].title = titles[i];
  }

  return rows;
}

/**
 * ランキング表の描画
 * @param {Array} rows 処理済みランキングデータ
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
    tr.classList.add(`rank-${p.currentRank}`); // 上位3人の強調用クラス

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

  // 表彰台表示（上位3人）
  const podiumDiv = document.getElementById("podium");
  podiumDiv.innerHTML = "";
  rows.slice(0, 3).forEach(p => {
    const div = document.createElement("div");
    div.className = "podium-player";
    if (p.currentRank === 1) div.classList.add("first");
    else if (p.currentRank === 2) div.classList.add("second");
    else if (p.currentRank === 3) div.classList.add("third");

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
 * GASからランキング情報を取得して表示更新
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
    const res = await fetch(GAS_URL + "?mode=log"); // ログ取得
    const logs = await res.json();

    // ✅ ログデータが空 or 不正な場合をチェック
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

document.getElementById("closeLogBtn").addEventListener("click", () => {
  document.getElementById("logOverlay").style.display = "none";
});

/**
 * CSVログをダウンロードする関数
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

function setupEventListeners() {
  const btn = document.getElementById("showLatestLogBtn");
  if (btn) {
    btn.addEventListener("click", showLatestLog);
  } else {
    console.warn("📛 showLatestLogBtn が見つかりませんでした。");
  }
}

// DOM構築後にイベント登録を実行
document.addEventListener("DOMContentLoaded", setupEventListeners);

/**
 * 初期イベント登録
 */
function setupEventListeners() {
  document.getElementById("loadRankingBtn").addEventListener("click", refreshRanking);
  document.getElementById("backButton").addEventListener("click", () => {
  document.getElementById("logOverlay").style.display = "none";
});
  window.addEventListener("DOMContentLoaded", refreshRanking);
}

setupEventListeners();
