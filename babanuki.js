function renderRankingTable(data) {
  const tbody = document.querySelector("#rankingTable tbody");
  tbody.innerHTML = "";

  data.sort((a, b) => a.rank - b.rank);

  data.forEach((entry, i) => {
    const tr = document.createElement("tr");

    const rankEmoji = ["🥇", "🥈", "🥉"][entry.rank - 1] || `#${entry.rank}`;
    const trendColor = entry.rankTrend === "↑" ? "green" : entry.rankTrend === "↓" ? "red" : "gray";
    const rateChangeStyled = `<span style="color:${entry.bonus >= 0 ? 'green' : 'red'}">${entry.rateChange}</span>`;
    
    tr.className = `ranking-row rank-${entry.rank}`;
    tr.style.animationDelay = `${i * 0.1}s`; // ← ずらして順番に表示

    const rateChangeClass = entry.bonus >= 0 ? "rank-change-positive" : "rank-change-negative";

    tr.innerHTML = `
      <td>${entry.rank}</td>
      <td>${entry.playerId}</td>
      <td>${entry.name}</td>
      <td>${entry.rate}</td>
      <td class="${rateChangeClass}">${entry.rateChange}</td>
      <td>${entry.consecutiveLast >= 2 ? `🔥 ${entry.consecutiveLast}` : entry.consecutiveLast}</td>
      <td>${entry.title || ""}</td>
      <td>${entry.rankTrend}</td>
    `;
     tbody.appendChild(tr);
   });
 }
