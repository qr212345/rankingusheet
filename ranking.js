"use strict";

/* =========================
   設定
========================= */
const GAS_URL = "https://script.google.com/macros/s/AKfycbxnqDdZJPE0BPN5TRpqR49ejScQKyKADygXzw5tcp6RdCauKbeTfeQTWpP6WAKYK7Ue/exec";
const SECRET_KEY = "kosen-brain-super-secret";
const ADMIN_PASSWORD = "babanuki123";
const TITLES = ["⚡雷","🌪風","🔥火"];
const STORAGE_KEY = "rankingPlayerData_v2";
const DELETED_KEY = "rankingDeletedPlayers";
const HISTORY_KEY = "rankingHistory_v2";

/* =========================
   State
========================= */
let playerData = new Map();
let deletedPlayers = new Set();
let lastProcessedRows = [];
let isAdmin = false;
let rankingHistory = [];
let isFetching = false;
let autoRefreshTimer = null;
let historyChartInstance = null;

/* =========================
   ユーティリティ
========================= */
const $ = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
function debounce(fn, wait=250){let t; return (...args)=>{clearTimeout(t); t=setTimeout(()=>fn(...args),wait);};}
function fmtChange(val,up="↑",down="↓"){return val>0?`${up}${val}`:val<0?`${down}${-val}`:"—";}
function toast(msg,sec=2500){const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),sec);}

/* =========================
   LocalStorage
========================= */
function loadFromStorage(key, fallback){ try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw):fallback; }catch(e){return fallback;} }
function saveToStorage(key,value){ try{ localStorage.setItem(key,JSON.stringify(value)); }catch(e){}}
function loadPlayerData(){ const raw=loadFromStorage(STORAGE_KEY,null); if(raw) playerData=new Map(raw);}
function savePlayerData(){ saveToStorage(STORAGE_KEY,Array.from(playerData.entries()));}
function loadDeletedPlayers(){ deletedPlayers=new Set(loadFromStorage(DELETED_KEY,[]));}
function saveDeletedPlayers(){ saveToStorage(DELETED_KEY,Array.from(deletedPlayers));}
function loadRankingHistory(){ rankingHistory=loadFromStorage(HISTORY_KEY,[]);}
function saveRankingHistory(){ saveToStorage(HISTORY_KEY,rankingHistory);}

/* =========================
   管理者モード
========================= */
function setAdminMode(enabled){
  isAdmin=Boolean(enabled);
  $$("th.admin-only,td.admin-only").forEach(el=>el.style.display=isAdmin?"table-cell":"none");
}

/* =========================
   ランキング計算
========================= */
function processRanking(data){
  // 過去データ反映
  data.forEach(p=>{ const prev=playerData.get(p.playerId)||{}; p.prevRate=prev.rate??p.rate; p.prevRank=prev.lastRank??0; p.prevRateRank=prev.prevRateRank??0; p.bonus=prev.bonus??p.bonus??0; });

  // レート差
  data.forEach(p=>p.rateGain=p.rate-p.prevRate);

  // ランク決定
  data.sort((a,b)=>b.rate-a.rate);
  let rank=1;
  data.forEach((p,i)=>{ p.rateRank=i>0&&p.rate===data[i-1].rate?data[i-1].rateRank:rank++; p.rank=p.rateRank; p.rankChange=(p.prevRank??p.rank)-p.rank; p.rateRankChange=(p.prevRateRank??p.rateRank)-p.rateRank; });
  data.forEach((p,i)=>p.title=i<TITLES.length?TITLES[i]:"");

  // 保存
  data.forEach(p=>playerData.set(p.playerId,{rate:p.rate,lastRank:p.rank,prevRateRank:p.rateRank,bonus:p.bonus}));
  savePlayerData();

  // 表示用
  return data.map(p=>({...p,gain:p.rateGain>=0?`+${p.rateGain}`:p.rateGain,rankChangeStr:fmtChange(p.rankChange),rateRankChangeStr:fmtChange(p.rateRankChange)}));
}

/* =========================
   描画
========================= */
function renderRankingTable(data){
  const tbody=$("#rankingTable tbody");
  tbody.innerHTML="";
  const frag=document.createDocumentFragment();
  data.forEach(p=>{
    const tr=document.createElement("tr");
    tr.dataset.playerId=p.playerId;
    if(p.rank<=3) tr.classList.add(`rank-${p.rank}`);
    if(p.rateGain>0) tr.classList.add("gain-up"); else if(p.rateGain<0) tr.classList.add("gain-down");
    tr.innerHTML=`
      <td>${p.rank}</td>
      <td>${p.playerId}</td>
      <td>${p.rate}</td>
      <td>${p.gain}</td>
      <td>${p.bonus}</td>
      <td>${p.rankChangeStr}</td>
      <td>${p.prevRank??'—'}</td>
      <td class="${p.title==='⚡雷'?'title-thunder':p.title==='🌪風'?'title-wind':p.title==='🔥火'?'title-fire':''}">${p.title}</td>
      <td class="admin-only"><button data-playerid="${p.playerId}" class="bg-red-500 text-white px-2 py-1 rounded">削除</button></td>
    `;
    tr.addEventListener("click",e=>{ if(!e.target.closest("button")) showPlayerChart(p.playerId); });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  renderSideAwards(data);
  renderPodium(data.slice(0,3));
}

function renderPodium(top3){
  const pod=$("#podium");
  pod.innerHTML="";
  top3.forEach((p,i)=>{
    const div=document.createElement("div");
    div.className="podium-player "+(i===0?"first":i===1?"second":"third");
    div.textContent=`${p.playerId} (${p.rate})`;
    pod.appendChild(div);
  });
}

function renderSideAwards(data){
  const up=$("#awardUp"),down=$("#awardDown");
  up.innerHTML=data.sort((a,b)=>b.rateGain-a.rateGain).slice(0,3).map(p=>`<li>${p.playerId} (${p.gain})</li>`).join('');
  down.innerHTML=data.sort((a,b)=>a.rateGain-b.rateGain).slice(0,3).map(p=>`<li>${p.playerId} (${p.gain})</li>`).join('');
}

/* =========================
   データ取得
========================= */
async function fetchRankingJSON(){
  try{
    isFetching=true;
    const res=await fetch(`${GAS_URL}?mode=getRanking`,{cache:"no-store"});
    if(!res.ok) throw new Error(res.status);
    const json=await res.json();
    if(!json.ranking) throw new Error("データなし");
    return Object.entries(json.ranking).map(([id,[rate,bonus]])=>({playerId:id,rate:Number(rate)||0,bonus:Number(bonus)||0}));
  }catch(e){ toast("取得失敗:"+e.message); return []; } finally{ isFetching=false; }
}

async function refreshRanking(){
  if(isFetching) return;
  const data=await fetchRankingJSON();
  const filtered=data.filter(p=>!deletedPlayers.has(p.playerId));
  lastProcessedRows=processRanking(filtered);
  renderRankingTable(lastProcessedRows);
  rankingHistory.push({date:new Date().toISOString(),snapshot:lastProcessedRows.map(p=>({playerId:p.playerId,rate:p.rate,bonus:p.bonus}))});
  saveRankingHistory();
}

/* =========================
   モーダル
========================= */
function attachModalControls(){
  const modal=$("#chartModal");
  const close=$("#chartCloseBtn");
  close.addEventListener("click",()=>modal.classList.add("hidden"));
}
async function showPlayerChart(playerId){
  if(isFetching) return toast("前回処理中…");
  try{
    isFetching=true;
    const data=lastProcessedRows.find(p=>p.playerId===playerId);
    if(!data) return;
    const ctx=$("#chartCanvas").getContext("2d");
    if(historyChartInstance) historyChartInstance.destroy();
    historyChartInstance=new Chart(ctx,{type:"line",data:{labels:["前回","今回"],datasets:[{label:data.playerId,data:[data.prevRate,data.rate],borderColor:'blue',tension:0.2}]},options:{responsive:true}});
    $("#chartModal").classList.remove("hidden");
  }finally{ isFetching=false; }
}

/* =========================
   イベント
========================= */
function attachEvents(){
  $("#searchInput").addEventListener("input",debounce(e=>{
    const term=e.target.value.toLowerCase();
    renderRankingTable(lastProcessedRows.filter(p=>p.playerId.toLowerCase().includes(term)));
  }));
  $("#downloadCSVBtn").addEventListener("click",()=>downloadCSV());
  $("#loadRankingBtn").addEventListener("click",()=>refreshRanking());
  $("#adminToggleBtn").addEventListener("click",()=>{
    const pwd=prompt("管理者パスワード");
    setAdminMode(pwd===ADMIN_PASSWORD);
  });
  $("#autoRefreshToggle").addEventListener("change",e=>{
    if(e.target.checked){ const sec=$("#autoRefreshSec").value||30; autoRefreshTimer=setInterval(refreshRanking,sec*1000); }
    else clearInterval(autoRefreshTimer);
  });
}

/* =========================
   CSV
========================= */
function downloadCSV(){
  const csv=["順位,生徒ID,総合レート,獲得レート,特別ポイント,順位変動,前回順位,称号"];
  lastProcessedRows.forEach(p=>csv.push([p.rank,p.playerId,p.rate,p.gain,p.bonus,p.rankChangeStr,p.prevRank??"",p.title].join(",")));
  const blob=new Blob([csv.join("\n")],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="ranking.csv"; a.click();
}

/* =========================
   初期化
========================= */
function init(){
  loadPlayerData();
  loadDeletedPlayers();
  loadRankingHistory();
  attachEvents();
  attachModalControls();
  refreshRanking();
}

document.addEventListener("DOMContentLoaded",init);
