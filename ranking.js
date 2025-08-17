const GAS_URL = "https://script.google.com/macros/s/AKfycbxzBcssjOX5-bJrS0jfIQC2I-3m8pZi2hpmo3UjJZEe0HfV7ypDZEH9R1JrBfoZDQU/exec";
const SECRET = "kosen-brain-super-secret";  // ※未使用。将来的な認証用などに。

// 過去データを保持（GASから読み込み）
let playerData = {};

function processRanking(entries) {
  // entriesの各playerIdにprevデータをセット（なければ初期化）
  entries.forEach(player => {
    const playerId = player["Player ID"];
    const prev = playerData[playerId] || {};
    
    player.prevRate = prev.rate ?? player.rate;
    player.prevRank = prev.lastRank ?? player.rank ?? 0;
    player.prevRateRank = prev.prevRateRank ?? 0;
    player.bonus = player.bonus ?? prev.bonus ?? 0;
  });

  // 獲得レート計算（差分）
  entries.forEach(player => {
    player.rateGain = player.rate - player.prevRate;
  });

  // 最新レートでソート → レート順位付け
  entries.sort((a, b) => b.rate - a.rate);
  entries.forEach((player, idx) => {
    player.rateRank = idx + 1;
  });

  // 前回レート順位がなければ今回の順位を代入
  entries.forEach(player => {
    if (!player.prevRateRank) player.prevRateRank = player.rateRank;
  });

  // 順位変動計算
  entries.forEach(player => {
    player.rankChange = player.prevRank - (player.rank ?? player.prevRank);
    player.rateRankChange = player.prevRateRank - player.rateRank;
  });

  // 称号付与（上位3名）
  const titles = ["⚡雷", "🌪風", "🔥火"];
  entries.forEach(player => player.title = "");
  for (let i = 0; i < 3 && i < entries.length; i++) {
    entries[i].title = titles[i];
  }

  // 表示用に加工
  const processedRows = entries.map(player => {
    // 同順位チェック
    const sameRankCount = entries.filter(p => p.rank === player.rank).length;
    const sameRank = sameRankCount > 1;

    // 獲得レート or 特別ポイントに振り分け
    const gainDisplay = sameRank ? "" : (player.rateGain >= 0 ? "+" + player.rateGain : player.rateGain.toString());
    const bonusDisplay = sameRank ? (player.rateGain >= 0 ? "+" + player.rateGain : player.rateGain.toString()) : player.bonus;

    // 順位変動表示
    const rankChangeStr = player.rankChange > 0 ? `↑${player.rankChange}` :
                          player.rankChange < 0 ? `↓${-player.rankChange}` : "—";
    const rateRankChangeStr = player.rateRankChange > 0 ? `↑${player.rateRankChange}` :
                              player.rateRankChange < 0 ? `↓${-player.rateRankChange}` : "—";

    return {
      playerId: player["Player ID"],
      rank: player.rank ?? "—",
      rate: player.rate,
      gain: gainDisplay,
      bonus: bonusDisplay,
      rankChange: rankChangeStr,
      lastRank: player.prevRank ?? "—",
      title: player.title,
      rateRank: player.rateRank,
      rateRankChange: rateRankChangeStr
    };
  });

  return processedRows;
}

/**
 * renderRankingTableも合わせて修正例
 */
function renderRankingTable(processedRows) {
  const tbody = document.querySelector("#rankingTable tbody");
  tbody.innerHTML = "";

  processedRows.forEach(p => {
    const tr = document.createElement("tr");
    tr.classList.add(`rank-${p.rank}`);

    tr.innerHTML = `
      <td>${p.rank}</td>
      <td>${p.playerId}</td>
      <td>${p.rate}</td>
      <td>${p.gain}</td>
      <td>${p.bonus}</td>
      <td>${p.rankChange}</td>
      <td>${p.lastRank}</td>
      <td>${p.title}</td>
    `;
    tbody.appendChild(tr);
  });

  // 表彰台表示は前回のままでOK
  const podiumDiv = document.getElementById("podium");
  podiumDiv.innerHTML = "";
  processedRows.slice(0, 3).forEach(p => {
    const div = document.createElement("div");
    div.className = "podium-player";
    if (p.rank === 1) {
      div.classList.add("first", "title-thunder");
    } else if (p.rank === 2) {
      div.classList.add("second", "title-wind");
    } else if (p.rank === 3) {
      div.classList.add("third", "title-fire");
    }

    div.innerHTML = `
      <h2>${p.rank}位 🏆</h2>
      <p>ID: ${p.playerId}</p>
      <p>レート: ${p.rate}</p>
      <p>${p.title}</p>
    `;
    podiumDiv.appendChild(div);
  });
}

/**
 * refreshRanking()の一部変更例
 */
async function refreshRanking() {
  const statusDiv = document.getElementById("loadingStatus");
  try {
    statusDiv.textContent = "ランキングデータを読み込み中…";
    const res = await fetch(`${GAS_URL}?mode=ranking&secret=${encodeURIComponent(SECRET)}`, {
      method: "GET",
      mode: "cors"
    });
    if (!res.ok) throw new Error("HTTP error " + res.status);
    const data = await res.json();

    // 過去データを更新
    playerData = data.playerData || {};

    const rows = data.rateRanking;
    if (!rows || rows.length === 0) {
      statusDiv.textContent = "❌ ランキングデータがありません。";
      return;
    }

    statusDiv.textContent = "✅ ランキングデータを読み込みました。";

    // processRankingに渡して加工
    const processedRows = processRanking(rows);

    renderRankingTable(processedRows);
  } catch (err) {
    statusDiv.textContent = "⚠️ ランキングデータの読み込みに失敗しました。";
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


// 拡大ボタン＆閉じるボタン取得
const expandBtn = document.getElementById("expandTableBtn");
const expandOverlay = document.getElementById("expandOverlay");
const closeExpandBtn = document.getElementById("closeExpandBtn");
const expandedRankingContainer = document.getElementById("expandedRankingContainer");

// 拡大表示を開く
expandBtn.addEventListener("click", () => {
  // ランキング表のコピーを作成
  const originalTable = document.getElementById("rankingTable");
  if (!originalTable) return;

  // コピーしてから拡大表示領域に挿入
  expandedRankingContainer.innerHTML = ""; // クリア
  const tableClone = originalTable.cloneNode(true);

  // 拡大用にフォントサイズ大きめなど追加スタイル調整
  tableClone.style.fontSize = "1.5rem";
  tableClone.style.width = "100%";
  tableClone.style.maxWidth = "100%";

  expandedRankingContainer.appendChild(tableClone);

  // モーダル表示
  expandOverlay.style.display = "block";

  // スクロール位置トップに
  window.scrollTo(0, 0);
});

// 拡大モードを閉じる
closeExpandBtn.addEventListener("click", () => {
  expandOverlay.style.display = "none";
  expandedRankingContainer.innerHTML = ""; // 内容クリア
});

// オーバーレイの空白クリックでも閉じる
expandOverlay.addEventListener("click", (e) => {
  if (e.target === expandOverlay) {
    expandOverlay.style.display = "none";
    expandedRankingContainer.innerHTML = "";
  }
});


/**
 * 初期処理
 */
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  refreshRanking();
});
