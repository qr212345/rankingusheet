const GAS_URL = "https://script.google.com/macros/s/AKfycbw3t8B_olroaQziFqRFesGU5cWUkYo5r8vM2ddsLRn3YYX0_aMZolPaLSd-301ME5o/exec";
const SECRET = "kosen-brain-super-secret";

// 2. レート順位をソートし、playerDataを使って獲得レートや順位変動・称号を計算
let playerData = {}; // ← GASなどから読み込んだ過去データ

function processRankingData(rows) {
  // 総合レート(rate)で降順ソート（高い順）
  rows.sort((a, b) => b["レート"] - a["レート"]);

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const playerId = p["Player ID"];

    // playerDataの過去情報取得（なければ初期値）
    const prev = playerData[playerId] || {};
    const prevRate = prev.rate ?? p["レート"]; // 未定義なら今回レートを使う
    const prevRank = prev.lastRank ?? i + 1;

    // 今回順位
    p.currentRank = i + 1;

    // 獲得レート = 今回レート - 過去レート
    p.gainRate = Number(p["レート"]) - prevRate;

    // 順位変動 = 過去順位 - 今回順位
    p.rankChange = prevRank - p.currentRank;

    // 特別ポイント（ボーナス）はデータ優先
    p.specialPoint = Number(p["ボーナス"]) || prev.bonus || 0;

    // 称号：過去称号引き継ぎ（あとで上書き）
    p.title = "";
  }

  // 上位3人に称号を付与
  const titles = ["⚡雷", "🌪風", "🔥火"];
  for (let i = 0; i < 3 && i < rows.length; i++) {
    rows[i].title = titles[i];
  }

  return rows;
}

// ランキング表の描画
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
  // 上位3人を表彰台風に表示
  const podiumDiv = document.getElementById("podium");
  podiumDiv.innerHTML = ""; // リセット
  // ✓ 正しい
    rows.slice(0, 3).forEach(p => {
    const div = document.createElement("div");
    div.className = "podium-entry"; // CSSで見た目を整える
    div.innerHTML = `
      <h2>${p.currentRank}位 🏆</h2>
      <p>ID: ${p.id}</p>
      <p>レート: ${p.rate}</p>
      <p>${p.title}</p>
    `;
    podiumDiv.appendChild(div);
  });
}

// GASから読み込んで処理＋描画
async function refreshRanking() {
  try {
    const res = await fetch(GAS_URL + "?mode=ranking");
    const data = await res.json();

    // プレイヤーデータ（過去情報）を格納
    playerData = data.playerData || {};

    // 現在のランキング行データ
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

document.getElementById("loadRankingBtn").addEventListener("click", refreshRanking);
window.addEventListener("DOMContentLoaded", refreshRanking);
