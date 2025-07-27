const GAS_URL = "https://script.google.com/macros/s/AKfycbw28e5sBBlApdwyNory0rQgY-Yx_mvHqAdjqIk4FIX4U0HnSJeW7w_kf65pWsRBISw/exec";

// 事前に別ページで読み込まれている想定
// let playerData = {
//   "player1": { rate: 120, lastRank: 3, bonus: 0, title: "" },
//   "player2": { rate: 110, lastRank: 1, bonus: 2, title: "🍭連続ボーナス" },
//   // ...
// };

// 1. GASからデータ取得
async function loadRankingData() {
  try {
    const response = await fetch(GAS_URL, { method: "GET", mode: "cors" });
    if (!response.ok) throw new Error("ネットワークエラー");

    const data = await response.json();
    if (data.status !== "success") throw new Error(data.message || "ランキング取得失敗");

    return data.rows;  // GASのdoGetが返す配列
  } catch (err) {
    console.error("ランキング読み込みエラー:", err);
    alert("ランキングの読み込みに失敗しました");
    return null;
  }
}

// 2. レート順位をソートし、playerDataを使って獲得レートや順位変動・称号を計算
function processRankingData(rows) {
  // 総合レート(rate)で降順ソート（高い順）
  rows.sort((a, b) => b["レート"] - a["レート"]);

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const playerId = p["Player ID"];

    // playerDataの過去情報取得（なければ初期値）
    const prevData = playerData[playerId] || { rate: 0, lastRank: 0, bonus: 0, title: "" };

    // 今回順位
    p.currentRank = i + 1;

    // 獲得レート = 今回レート - 過去レート
    p.gainRate = Number(p["レート"]) - prevData.rate;

    // 順位変動 = 過去順位 - 今回順位
    p.rankChange = prevData.lastRank > 0 ? prevData.lastRank - p.currentRank : 0;

    // 特別ポイント（ボーナス）は最新データ優先、それがなければ過去データ
    p.specialPoint = Number(p["ボーナス"]) || prevData.bonus || 0;

    // 称号：上書きか過去保持か
    p.title = prevData.title || "";

    // 特殊ボーナス検知例
    if (p.specialPoint >= 2) {
      p.title = (p.title ? p.title + " " : "") + "🍭連続ボーナス";
    }
  }

  // 上位3位に称号を付与（既存称号に追加する形）
  const titles = ["⚡雷", "🌪風", "🔥火"];
  for (let i = 0; i < 3 && i < rows.length; i++) {
    rows[i].title = (rows[i].title ? rows[i].title + " " : "") + titles[i];
  }

  return rows;
}

// 3. 表示用描画関数
function renderRankingTable(rows) {
  const tbody = document.querySelector("#rankingTable tbody");
  tbody.innerHTML = "";

  rows.forEach(p => {
    let changeText = "";
    if (p.rankChange > 0) changeText = `↑${p.rankChange}`;
    else if (p.rankChange < 0) changeText = `↓${-p.rankChange}`;
    else changeText = "—";

    let specialPointText = p.specialPoint > 0 ? `${p.specialPoint}🔥` : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.currentRank}</td>
      <td>${p["Player ID"]}</td>
      <td>${p["レート"]}</td>
      <td>${p.gainRate >= 0 ? "+" : ""}${p.gainRate}</td>
      <td>${specialPointText}</td>
      <td>${changeText}</td>
      <td>${p.title}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 4. ボタン押下で最新ランキング取得＆表示
async function refreshRanking() {
  const rows = await loadRankingData();
  if (!rows) return;

  const processedRows = processRankingData(rows);
  renderRankingTable(processedRows);
}

document.getElementById("loadRankingBtn").addEventListener("click", refreshRanking);
window.addEventListener("DOMContentLoaded", refreshRanking);
