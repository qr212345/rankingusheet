"use strict";

/* ===============================
   定数・ユーティリティ
   =============================== */
const GAS_URL = "https://script.google.com/macros/s/実際のID/exec";
const TITLES = ["⚡雷", "🌪風", "🔥火"];
const STORAGE_KEY = "rankingPlayerData_v2";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const collatorJa = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ===============================
   状態
   =============================== */
let playerData = new Map();
let autoRefreshTimer = null;
let historyChartInstance = null;
let lastProcessedRows = [];
let currentSort = { idx: 0, asc: true };
let isFetching = false;

/* ===============================
   ストレージ
   =============================== */
function loadPlayerData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    playerData = new Map(JSON.parse(raw));
  } catch { console.warn("PlayerData load failed"); }
}

function savePlayerData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(playerData.entries())));
  } catch { console.warn("PlayerData save failed"); }
}

/* ===============================
   CSV パース
   =============================== */
function parseCSV(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim());
  if (!lines.length) return [];

  return lines.map(line => {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; continue; }
          inQ = false;
        } else cur += c;
      } else {
        if (c === '"') { inQ = true; continue; }
        if (c === ',') { out.push(cur); cur = ""; continue; }
        cur += c;
      }
    }
    out.push(cur);
    return out;
  });
}

/* ===============================
   データ処理
   =============================== */
function applyPreviousData(entries) {
  entries.forEach(p => {
    const prev = playerData.get(p.playerId) || {};
    p.prevRate = Number.isFinite(prev.rate) ? prev.rate : p.rate;
    p.prevRank = Number.isFinite(prev.lastRank) ? prev.lastRank : (Number.isFinite(p.rank) ? p.rank : 0);
    p.prevRateRank = Number.isFinite(prev.prevRateRank) ? prev.prevRateRank : (Number.isFinite(p.rateRank) ? p.rateRank : 0);
    p.bonus = Number.isFinite(p.bonus) ? p.bonus : (Number.isFinite(prev.bonus) ? prev.bonus : 0);
  });
}

function calculateRanking(entries, { tieMode = "competition" } = {}) {
  entries.forEach(p => p.rateGain = (Number.isFinite(p.rate) && Number.isFinite(p.prevRate)) ? p.rate - p.prevRate : 0);

  // 安定ソート
  entries = entries.map((p, i) => ({ p, i })).sort((a,b)=> (b.p.rate - a.p.rate) || (a.i - b.i)).map(x=>x.p);

  // 順位計算
  if (tieMode === "competition") {
    let rank = 1;
    for (let i = 0; i < entries.length; i++) {
      entries[i].rateRank = (i > 0 && entries[i].rate === entries[i-1].rate) ? entries[i-1].rateRank : rank;
      rank++;
    }
  } else {
    entries.forEach((p,i)=>p.rateRank = i+1);
  }
  entries.forEach(p=>p.rank = p.rateRank);

  // 変動計算
  entries.forEach(p => {
    if (p.prevRateRank == null) p.prevRateRank = p.rateRank;
    p.rankChange = (Number.isFinite(p.prevRank) ? p.prevRank : p.rank) - p.rank;
    p.rateRankChange = (Number.isFinite(p.prevRateRank) ? p.prevRateRank : p.rateRank) - p.rateRank;
  });

  // タイトル付与
  entries.forEach((p,i)=> p.title = i < TITLES.length ? TITLES[i] : "");

  return entries;
}

function storeCurrentData(entries) {
  entries.forEach(p => playerData.set(p.playerId, { rate: p.rate, lastRank: p.rank, prevRateRank: p.rateRank, bonus: p.bonus }));
  savePlayerData();
}

function formatForDisplay(entries) {
  return entries.map(p => {
    const gainDisplay = (Number.isFinite(p.rateGain) && p.rateGain >= 0) ? `+${p.rateGain}` : `${p.rateGain ?? 0}`;
    const rankChangeStr = p.rankChange > 0 ? `↑${p.rankChange}` : p.rankChange < 0 ? `↓${-p.rankChange}` : "—";
    const rateRankChangeStr = p.rateRankChange > 0 ? `↑${p.rateRankChange}` : p.rateRankChange < 0 ? `↓${-p.rateRankChange}` : "—";
    return { ...p, gain: gainDisplay, rankChangeStr, rateRankChangeStr };
  });
}

function processRanking(entries) {
  applyPreviousData(entries);
  const ranked = calculateRanking(entries);
  storeCurrentData(ranked);
  return formatForDisplay(ranked);
}

/* ===============================
   描画
   =============================== */
function renderRankingTable(processedRows) {
  const tbody = $("#rankingTable tbody");
  if (!tbody) return;
  const frag = document.createDocumentFragment();

  processedRows.forEach(p => {
    const tr = document.createElement("tr");
    if (p.rank === 1) tr.classList.add("rank-1");
    else if (p.rank === 2) tr.classList.add("rank-2");
    else if (p.rank === 3) tr.classList.add("rank-3");
    if (p.rateGain > 0) tr.classList.add("gain-up");
    else if (p.rateGain < 0) tr.classList.add("gain-down");

    tr.addEventListener("click", () => showPlayerChart(p.playerId));

    tr.innerHTML = `
      <td title="現在順位" data-sort="${p.rank}">${p.rank}</td>
      <td data-sort="${p.playerId}">${p.playerId}</td>
      <td data-sort="${p.rate}">${p.rate}</td>
      <td title="レート差分" data-sort="${p.rateGain}">${p.gain}</td>
      <td data-sort="${p.bonus}">${p.bonus}</td>
      <td title="順位変動" data-sort="${p.rankChange}">${p.rankChangeStr}</td>
      <td data-sort="${p.prevRank ?? ''}">${p.prevRank ?? "—"}</td>
      <td class="${p.title === "⚡雷" ? "title-thunder" : p.title === "🌪風" ? "title-wind" : p.title === "🔥火" ? "title-fire" : ""}" data-sort="${p.title}">${p.title}</td>
    `;

    frag.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(frag);
  renderSideAwards(processedRows);
  announce(`${processedRows.length}件のランキングを更新しました`);
}

function renderSideAwards(rows) {
  const upUl = $("#awardUp");
  const downUl = $("#awardDown");
  if (!upUl || !downUl) return;

  const topUp = [...rows].sort((a,b)=> b.rateGain - a.rateGain).slice(0,3);
  const topDown = [...rows].sort((a,b)=> a.rateGain - b.rateGain).slice(0,3);

  upUl.innerHTML = topUp.map(p=>`<li>${p.playerId} (${p.gain})</li>`).join("");
  downUl.innerHTML = topDown.map(p=>`<li>${p.playerId} (${p.gain})</li>`).join("");
}

/* ===============================
   検索・ソート
   =============================== */
function attachSearch() {
  const input = $("#searchInput");
  if (!input) return;
  input.addEventListener("input", debounce(() => {
    const term = input.value.trim().toLowerCase();
    $$("#rankingTable tbody tr").forEach(row => row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none");
  }, 200));
}

function attachSorting() {
  const ths = $$("#rankingTable thead th");
  ths.forEach((th, idx) => {
    const type = th.getAttribute("data-type") || inferColumnType(idx);
    let asc = true;
    th.addEventListener("click", () => {
      currentSort = { idx, asc };
      sortTable(idx, asc, type);
      updateSortIndicators(ths, idx, asc);
      asc = !asc;
    });
  });
}

function inferColumnType(idx) {
  const numberCols = new Set([0,2,3,4,5,6]);
  return numberCols.has(idx) ? "number" : "string";
}

function sortTable(idx, asc, type) {
  const tbody = $("#rankingTable tbody");
  if (!tbody) return;
  const dir = asc ? 1 : -1;
  const rows = Array.from(tbody.querySelectorAll("tr"));

  const cmp = (a,b) => {
    const va = a.cells[idx]?.getAttribute("data-sort") ?? a.cells[idx]?.textContent ?? "";
    const vb = b.cells[idx]?.getAttribute("data-sort") ?? b.cells[idx]?.textContent ?? "";
    if (type === "number") {
      const na = Number(va), nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
    }
    return collatorJa.compare(String(va), String(vb)) * dir;
  };

  const indexed = rows.map((r,i)=>({r,i})).sort((x,y)=>{const c=cmp(x.r,y.r); return c!==0?c:x.i - y.i;});
  tbody.innerHTML = "";
  indexed.forEach(({r})=>tbody.appendChild(r));
}

function updateSortIndicators(ths, activeIdx, asc) {
  ths.forEach((th,i)=>{
    if(i===activeIdx){
      th.setAttribute("aria-sort", asc?"ascending":"descending");
      th.classList.toggle("sort-asc",asc);
      th.classList.toggle("sort-desc",!asc);
    }else{
      th.removeAttribute("aria-sort");
      th.classList.remove("sort-asc","sort-desc");
    }
  });
}

/* ===============================
   自動更新・UI
   =============================== */
function setAutoRefresh(sec){
  clearInterval(autoRefreshTimer);
  if(sec>0) autoRefreshTimer=setInterval(refreshRanking, sec*1000);
}

function showLoading(show){ const el=$("#loadingSpinner"); if(el) el.style.display=show?"block":"none"; }
function showError(msg){ const el=$("#errorBanner"); if(el){ el.textContent=msg; el.style.display="block"; } else console.error(msg); }
function hideError(){ const el=$("#errorBanner"); if(el) el.style.display="none"; }
function announce(text){ const live=$("#ariaLive"); if(live) live.textContent=text; }

/* ===============================
   Chart.js
   =============================== */
function closeChartModal(){ const modal=$("#chartModal"); if(modal) modal.style.display="none"; }
function attachModalControls(){
  const modal=$("#chartModal"); if(!modal) return;
  const closeBtn=$("#chartClose")||modal.querySelector(".modal-close");
  if(closeBtn) closeBtn.addEventListener("click",closeChartModal);
  modal.addEventListener("click",e=>{if(e.target===modal)closeChartModal();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeChartModal();});
}

function showPlayerChart(playerId){
  if(isFetching){ announce("前回更新中…"); return; }
  isFetching=true;
  if(historyChartInstance){ historyChartInstance.destroy(); historyChartInstance=null; }
  fetch(`${GAS_URL}?mode=history&id=${encodeURIComponent(playerId)}`,{cache:"no-store"})
    .then(res=>{if(!res.ok)throw new Error(`history ${res.status}`); return res.json();})
    .then(history=>{
      const canvas=$("#historyChart"); if(!canvas) return;
      const ctx=canvas.getContext("2d");
      const labels=history.map(h=>h.date);
      const data=history.map(h=>Number(h.rate));
      historyChartInstance=new Chart(ctx,{type:"line",data:{labels,datasets:[{label:`${playerId} レート推移`,data,borderColor:"#36a2eb",backgroundColor:"rgba(54,162,235,0.08)",tension:0.25,fill:true,pointRadius:2} ] }, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true},tooltip:{mode:"index",intersect:false}},interaction:{mode:"nearest",intersect:false},scales:{x:{display:true,title:{display:true,text:"日付"}},y:{display:true,title:{display:true,text:"レート"},beginAtZero:false}}} });
      const modal=$("#chartModal"); if(modal) modal.style.display="block";
    })
    .catch(err=>showError(`履歴取得失敗: ${err.message}`))
    .finally(()=>isFetching=false);
}

/* ===============================
   データ更新
   =============================== */
async function refreshRanking(){
  if(isFetching) return;
  isFetching=true;
  try{
    showLoading(true); hideError();
    const res=await fetch(GAS_URL,{cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const csvText=await res.text();
    const rowsCSV=parseCSV(csvText);
    if(rowsCSV.length<=1){ renderRankingTable([]); return; }

    const [header,...dataLines]=rowsCSV;
    const hmap=header.map(h=>h.trim().toLowerCase());
    const idxId=hmap.indexOf("playerid")!==-1?hmap.indexOf("playerid"):0;
    const idxRank=hmap.indexOf("rank")!==-1?hmap.indexOf("rank"):1;
    const idxRate=hmap.indexOf("rate")!==-1?hmap.indexOf("rate"):2;
    const idxBonus=hmap.indexOf("bonus");

    const rows=dataLines.map(cols=>{
      const playerId=cols[idxId];
      const rank=Number(cols[idxRank]);
      const rate=Number(cols[idxRate]);
      const bonus=idxBonus>=0?Number(cols[idxBonus]):undefined;
      return {playerId,rank,rate, ...(idxBonus>=0?{bonus}:{} )};
    }).filter(r=>r.playerId&&Number.isFinite(r.rate));

    lastProcessedRows=processRanking(rows);
    renderRankingTable(lastProcessedRows);

    const ths=$$("#rankingTable thead th");
    if(ths.length && currentSort){
      const type=ths[currentSort.idx]?.getAttribute("data-type")||inferColumnType(currentSort.idx);
      sortTable(currentSort.idx,currentSort.asc,type);
      updateSortIndicators(ths,currentSort.idx,currentSort.asc);
    }
  }catch(e){ showError(`更新失敗: ${e.message}`); }
  finally{ showLoading(false); isFetching=false; }
}

/* ===============================
   初期化
   =============================== */
document.addEventListener("DOMContentLoaded",()=>{
  loadPlayerData();
  attachSearch();
  attachSorting();
  attachModalControls();
  refreshRanking();

  // 自動更新例: 60秒
  // setAutoRefresh(60);
});
