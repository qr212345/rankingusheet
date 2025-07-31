const GAS_URL = "https://script.google.com/macros/s/AKfycbxmwhP8STmIUtypIMSFuiltAWOiQDlvPaVNAWT_5D7jGCM-xbAz44N2mStbideuckw/exec";
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
      <p>ID: ${p.playerId}</p>
      <p>レート: ${p["レート"]}</p>
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

async function showLatestLog() {
  const res = await fetch(GAS_URL);
  const logs = await res.json();

  const latest = logs[logs.length - 1];
  const html = [`<p>${latest.timestamp}</p><ul>`];
  latest.log.forEach(p => {
    html.push(`<li>${p.playerId}: 順位${p.lastRank}, レート${p.rate}</li>`);
  });
  html.push("</ul>");

  document.getElementById("logContent").innerHTML = html.join("");
  document.getElementById("logModal").style.display = "block";
}

function downloadCSV() {
  const url = GAS_URL + "?mode=csv";
  fetch(url)
    .then(res => res.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ranking_log.csv";
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch(err => {
      console.error("CSVダウンロード失敗:", err);
      alert("CSVのダウンロードに失敗しました。");
    });
}

document.getElementById("loadRankingBtn").addEventListener("click", refreshRanking);
window.addEventListener("DOMContentLoaded", refreshRanking);
