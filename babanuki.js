function renderRankingTable() {
  const tbody = document.querySelector("#rankingTable tbody");
  tbody.innerHTML = "";

  // 総合レートで降順ソート（上位から表示）
  const sortedPlayers = Object.entries(playerData)
    .sort((a, b) => b[1].rate - a[1].rate);

  sortedPlayers.forEach(([pid, p], i) => {
    const tr = document.createElement("tr");

    // 獲得レートカラー設定
    const rateChangeClass = p.bonus >= 0 ? "rate-positive" : "rate-negative";
    const rateChangeText = (p.bonus >= 0 ? "+" : "") + p.bonus;

    // 連続最下位表示
    const consecutiveLastDisplay = p.consecutiveLast >= 2
      ? `🔥${p.consecutiveLast}`
      : (p.consecutiveLast > 0 ? p.consecutiveLast : "");

    // 順位変動のクラス付け＆アイコン
    let rankTrendClass = "rank-trend-same";
    let rankTrendIcon = "＝";
    if (p.rankTrend === "↑") {
      rankTrendClass = "rank-trend-up";
      rankTrendIcon = "↑";
    } else if (p.rankTrend === "↓") {
      rankTrendClass = "rank-trend-down";
      rankTrendIcon = "↓";
    }

    // 称号のクラス（絵文字そのままclass名にするとトラブルなので置換）
    let titleClass = "";
    if (p.title) {
      if (p.title.includes("👑")) titleClass = "👑";
      else if (p.title.includes("🥈")) titleClass = "🥈";
      else if (p.title.includes("🥉")) titleClass = "🥉";
    }

    tr.innerHTML = `
      <td style="font-weight:bold; font-size:1.2em;">${p.lastRank || (i + 1)}</td>
      <td>${pid}</td>
      <td>${p.rate}</td>
      <td><span class="${rateChangeClass}">${rateChangeText}</span></td>
      <td>${consecutiveLastDisplay}</td>
      <td class="${rankTrendClass}">${rankTrendIcon}</td>
      <td class="${titleClass}">${p.title || ""}</td>
    `;

    tbody.appendChild(tr);
  });
}

function convertRawDataToAppData(rawData) {
  // 1. seatMapはそのまま代入
  const seatMap = rawData.seatMap || {};

  // 2. playerDataは最低限のキーを補完しつつコピー
  const playerData = {};

  for (const [pid, pdata] of Object.entries(rawData.playerData || {})) {
    playerData[pid] = {
      name: pdata.name || pid,
      rate: typeof pdata.rate === 'number' ? pdata.rate : 30,
      lastRank: typeof pdata.lastRank === 'number' ? pdata.lastRank : null,
      consecutiveLastPlace: typeof pdata.consecutiveLastPlace === 'number' ? pdata.consecutiveLastPlace : 0,
      title: pdata.title || null,
      bonus: pdata.bonus || 0,
      // もしrankTrend（順位変動）を計算するならここに
      rankTrend: 0
    };
  }

  // 3. rankTrend (順位変動) 計算例
  // 例えば前回のlastRankと今回のlastRankの差で↑↓判定するイメージ
  // ※今回のlastRankはまだ決まっていないことが多いので、決定後に再計算が必要かも
  for (const pid in playerData) {
    const p = playerData[pid];
    if (p.lastRank != null) {
      // 仮に今回のlastRankが決まっているなら計算可能
      // ここでは0固定。後で更新してください。
      p.rankTrend = 0;
    }
  }

  return { seatMap, playerData };
}
