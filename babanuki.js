const GAS_URL = "https://script.google.com/macros/s/AKfycbxxxxxxx/exec"; // あなたのGAS URL

async function loadRankingData() {
  const res = await fetch(GAS_URL + "?mode=ranking");
  const json = await res.json();
  return json.players;
}

function getTitleEffect(rank) {
  if (rank === 1) return 'title-thunder';
  if (rank === 2) return 'title-wind';
  if (rank === 3) return 'title-fire';
  return '';
}

function renderPodium(top3) {
  const podium = document.getElementById("podium");
  podium.innerHTML = '';

  top3.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = `podium-player ${["first", "second", "third"][i]}`;
    div.innerHTML = `#${i + 1}<br>${p.id}`;
    podium.appendChild(div);
  });
}

function renderTable(players) {
  const tbody = document.querySelector("#rankingTable tbody");
  tbody.innerHTML = "";

  players.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${p.id}</td>
      <td>${p.rate}</td>
      <td>${p.bonus ?? 0}</td>
      <td>${p.bonus ?? 0}</td>
      <td>${p.lastRank != null ? (p.lastRank - (i + 1)) : "N/A"}</td>
      <td><span class="${getTitleEffect(i + 1)}">${p.title ?? ""}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// 🔁 ランキングを再読み込みする処理
async function refreshRanking() {
  const players = await loadRankingData();
  players.sort((a, b) => b.rate - a.rate);
  renderPodium(players.slice(0, 3));
  renderTable(players);
}

// 初期読み込みとボタン設定
document.addEventListener("DOMContentLoaded", () => {
  refreshRanking();

  document.getElementById("loadRankingBtn").addEventListener("click", () => {
    refreshRanking();
  });
});
