"use strict";

/* ===============================
   Configuration
   =============================== */
const CONFIG = {
  GAS_URL: "https://script.google.com/macros/s/AKfycbxnqDdZJPE0BPN5TRpqR49ejScQKyKADygXzw5tcp6RdCauKbeTfeQTWpP6WAKYK7Ue/exec",
  SECRET_KEY: "kosen-brain-super-secret",
  ADMIN_PASSWORD: "babanuki123",
  TITLES: ["⚡雷", "🌪風", "🔥火"],
  STORAGE_KEY: "rankingPlayerData_v2",
  DELETED_KEY: "rankingDeletedPlayers",
  HISTORY_KEY: "rankingHistory_v2",
  AUTO_REFRESH_MIN: 5 // 秒
};

/* ===============================
   Utilities
   =============================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const collatorJa = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
const debounce = (fn, wait=250) => { let t; return (...args)=>{clearTimeout(t); t=setTimeout(()=>fn(...args),wait);}; };
const fmtChange = (val, up="↑", down="↓") => val>0?`${up}${val}`:val<0?`${down}${-val}`:"—";

/* ===============================
   App state
   =============================== */
let state = {
  playerData: new Map(),
  deletedPlayers: new Set(),
  lastProcessedRows: [],
  currentSort: { idx:0, asc:true },
  isFetching: false,
  refreshQueue: false,
  autoRefreshTimer: null,
  historyChartInstance: null,
  isAdmin: false,
  rankingHistory: []
};

/* ===============================
   Storage helpers
   =============================== */
const Storage = {
  load(key, fallback){ try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch(e){ console.warn("Storage load failed", key,e); return fallback; } },
  save(key,value){ try { localStorage.setItem(key,JSON.stringify(value)); } catch(e){ console.warn("Storage save failed", key,e); } }
};

const loadAppData = () => {
  state.playerData = new Map(Storage.load(CONFIG.STORAGE_KEY, []));
  state.deletedPlayers = new Set(Storage.load(CONFIG.DELETED_KEY, []));
  state.rankingHistory = Storage.load(CONFIG.HISTORY_KEY, []);
};
const saveAppData = () => {
  Storage.save(CONFIG.STORAGE_KEY, Array.from(state.playerData.entries()));
  Storage.save(CONFIG.DELETED_KEY, Array.from(state.deletedPlayers));
  Storage.save(CONFIG.HISTORY_KEY, state.rankingHistory);
};

/* ===============================
   Admin mode
   =============================== */
function setAdminMode(enabled){
  state.isAdmin=Boolean(enabled);
  document.body.classList.toggle("admin-mode", state.isAdmin);
  $$("#rankingTable .delete-btn").forEach(btn => btn.style.display = state.isAdmin?"inline-block":"none");
}

/* ===============================
   Ranking computation
   =============================== */
function applyPreviousData(entries){
  entries.forEach(p=>{
    const prev = state.playerData.get(p.playerId)||{};
    p.prevRate = Number.isFinite(prev.rate)?prev.rate:p.rate;
    p.prevRank = Number.isFinite(prev.lastRank)?prev.lastRank:p.rank??0;
    p.prevRateRank = Number.isFinite(prev.prevRateRank)?prev.prevRateRank:p.rateRank??0;
    p.bonus = Number.isFinite(p.bonus)?p.bonus:prev.bonus??0;
  });
}

function calculateRanking(entries,tieMode="competition"){
  entries.forEach(p=>p.rateGain=(p.rate??0)-(p.prevRate??0));
  entries.sort((a,b)=>(b.rate - a.rate) || 0);
  if(tieMode==="competition"){
    let rank=1;
    entries.forEach((p,i)=>{p.rateRank=(i>0 && p.rate===entries[i-1].rate)?entries[i-1].rateRank:rank++;});
  }else{ entries.forEach((p,i)=>p.rateRank=i+1); }
  entries.forEach(p=>{
    p.rank=p.rateRank;
    p.rankChange=(p.prevRank??p.rank)-p.rank;
    p.rateRankChange=(p.prevRateRank??p.rateRank)-p.rateRank;
  });
  entries.forEach((p,i)=>p.title=CONFIG.TITLES[i]??"");
  return entries;
}

function processRanking(entries){
  applyPreviousData(entries);
  const ranked=calculateRanking(entries);
  ranked.forEach(p=>state.playerData.set(p.playerId,{rate:p.rate,lastRank:p.rank,prevRateRank:p.rateRank,bonus:p.bonus}));
  saveAppData();
  return ranked.map(p=>({...p,gain:(p.rateGain>=0?"+":"")+p.rateGain,rankChangeStr:fmtChange(p.rankChange),rateRankChangeStr:fmtChange(p.rateRankChange)}));
}

/* ===============================
   Rendering
   =============================== */
function renderRankingTable(rows){
  const tbody=$("#rankingTable tbody");
  if(!tbody) return;
  const frag=document.createDocumentFragment();
  rows.forEach(p=>{
    const tr=document.createElement("tr");
    tr.dataset.playerId=p.playerId;
    tr.className=[p.rank===1?'rank-1':'',p.rank===2?'rank-2':'',p.rank===3?'rank-3':'',p.rateGain>0?'gain-up':'',p.rateGain<0?'gain-down':''].join(' ');
    tr.innerHTML=`
      <td data-sort="${p.rank}">${p.rank}</td>
      <td data-sort="${p.playerId}">${p.playerId}</td>
      <td data-sort="${p.rate}">${p.rate}</td>
      <td data-sort="${p.rateGain}">${p.gain}</td>
      <td data-sort="${p.bonus}">${p.bonus}</td>
      <td data-sort="${p.rankChange}">${p.rankChangeStr}</td>
      <td data-sort="${p.prevRank??''}">${p.prevRank??'—'}</td>
      <td data-sort="${p.title}">${p.title}</td>
      <td><button class="delete-btn" data-playerid="${p.playerId}">削除</button></td>
    `;
    tr.addEventListener("click",e=>{if(!e.target.closest(".delete-btn")) showPlayerChart(p.playerId);});
    frag.appendChild(tr);
  });
  tbody.innerHTML="";
  tbody.appendChild(frag);
  attachDeleteHandlers();
}

/* ===============================
   Delete
   =============================== */
function attachDeleteHandlers(){
  const tbody=$("#rankingTable tbody");
  if(!tbody) return;
  tbody.querySelectorAll(".delete-btn").forEach(btn=>{
    btn.onclick=async (e)=>{
      if(!state.isAdmin){ alert("管理者モードでのみ削除できます"); return; }
      const id=btn.dataset.playerid;
      if(!id||!confirm(`${id} を削除しますか？`)) return;
      try{ showLoading(true); await performDeleteOnServer(id); } 
      catch(err){ showError("削除失敗:"+err.message||err); return; }
      finally{ showLoading(false); }
      state.lastProcessedRows=state.lastProcessedRows.filter(p=>p.playerId!==id);
      state.playerData.delete(id);
      state.deletedPlayers.add(id);
      saveAppData();
      renderRankingTable(state.lastProcessedRows);
    };
  });
}

async function performDeleteOnServer(playerId){
  const body=new URLSearchParams({mode:"delete",playerId,secret:CONFIG.SECRET_KEY});
  const res=await fetch(CONFIG.GAS_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});
  const json=await res.json().catch(()=>null);
  if(!json||json.status!=="ok") throw new Error(json?.error||"削除に失敗");
  return json;
}

/* ===============================
   Fetch & Refresh
   =============================== */
async function fetchRankingJSON(){
  try{
    const res=await fetch(`${CONFIG.GAS_URL}?mode=getRanking`,{cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json=await res.json();
    if(!json?.ranking) throw new Error("ランキングデータなし");
    return Object.entries(json.ranking).map(([playerId,[rate,bonus]])=>({playerId,rate:Number(rate)||0,bonus:Number(bonus)||0}));
  }catch(e){ showError("取得失敗:"+e.message); return []; }
}

async function refreshRanking(){
  if(state.isFetching){ state.refreshQueue=true; return; }
  state.isFetching=true;
  try{
    const data=(await fetchRankingJSON()).filter(p=>!state.deletedPlayers.has(p.playerId));
    const processed=processRanking(data);
    state.lastProcessedRows=processed;
    renderRankingTable(processed);
    state.rankingHistory.push({date:new Date().toISOString(),snapshot:processed});
    saveAppData();
  }catch(e){ showError("更新失敗:"+e.message); }
  finally{
    state.isFetching=false;
    if(state.refreshQueue){ state.refreshQueue=false; refreshRanking(); }
  }
}

/* ===============================
   Loading/Error
   =============================== */
function showLoading(show){ const el=$("#loadingStatus"); if(el){ el.style.display=show?"block":"none"; el.textContent=show?"更新中…":""; } }
function showError(msg){ const el=$("#errorBanner"); if(el){ el.style.display="block"; el.textContent=msg; } else console.error(msg);}
function hideError(){ const el=$("#errorBanner"); if(el) el.style.display="none"; }

/* ===============================
   Chart modal
   =============================== */
async function showPlayerChart(playerId){
  if(state.isFetching){ alert("前回処理中…"); return; }
  try{
    state.isFetching=true;
    showLoading(true); hideError();
    const res=await fetch(`${CONFIG.GAS_URL}?mode=getHistory&playerId=${encodeURIComponent(playerId)}`,{cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json=await res.json();
    if(!json?.history) throw new Error("履歴データなし");
    const data=json.history.map(p=>({date:p.date,rate:p.rate}));
    const ctx=$("#chartCanvas").getContext("2d");
    $("#chartModal").style.display="block";
    if(state.historyChartInstance) state.historyChartInstance.destroy();
    state.historyChartInstance=new Chart(ctx,{type:"line",data:{labels:data.map(d=>d.date),datasets:[{label:playerId,data:data.map(d=>d.rate),borderColor:"#f00",fill:false}]},options:{responsive:true}});
  }catch(err){ showError("チャート取得失敗:"+err.message||err); }
  finally{ showLoading(false); state.isFetching=false; }
}

/* ===============================
   CSV Download
   =============================== */
function downloadCSV(){
  const rows=state.lastProcessedRows; if(!rows?.length) return alert("データなし");
  const header=["順位","名前","レート","増減","ボーナス","順位変動","前回順位","称号"];
  const lines=[header.join(",")].concat(rows.map(p=>[p.rank,p.playerId,p.rate,p.gain,p.bonus,p.rankChangeStr,p.prevRank,p.title].map(s=>`"${s}"`).join(",")));
  const blob=new Blob([lines.join("\r\n")],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`ranking_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ===============================
   Search & Sort
   =============================== */
function attachSearch(){
  const input=$("#searchInput"); if(!input) return;
  input.addEventListener("input",debounce(()=>{
    const term=input.value.trim().toLowerCase();
    $$("#rankingTable tbody tr").forEach(row=>row.style.display=row.textContent.toLowerCase().includes(term)?"":"none");
  },200));
}

function inferColumnType(idx){ return new Set([0,2,3,4,5,6]).has(idx)?"number":"string"; }

function sortTable(idx,asc,type){
  const tbody=$("#rankingTable tbody"); if(!tbody) return;
  const dir=asc?1:-1;
  const rows=Array.from(tbody.querySelectorAll("tr"));
  const cmp=(a,b)=>{
    const va=a.cells[idx]?.dataset.sort??a.cells[idx]?.textContent??"";
    const vb=b.cells[idx]?.dataset.sort??b.cells[idx]?.textContent??"";
    if(type==="number"){ const na=Number(va),nb=Number(vb); if(Number.isFinite(na)&&Number.isFinite(nb)) return (na-nb)*dir; }
    return collatorJa.compare(String(va),String(vb))*dir;
  };
  const indexed=rows.map((r,i)=>({r,i})).sort((x,y)=>{ const c=cmp(x.r,y.r); return c!==0?c:x.i-y.i; });
  tbody.innerHTML=""; indexed.forEach(({r})=>tbody.appendChild(r));
}

function attachSorting(){
  const ths=$$("#rankingTable thead th");
  ths.forEach((th,idx)=>{
    const type=th.dataset.type||inferColumnType(idx);
    let asc=true;
    th.addEventListener("click",()=>{
      state.currentSort={idx,asc};
      sortTable(idx,asc,type);
      ths.forEach((th2,i)=>{ if(i===idx){th2.setAttribute("aria-sort",asc?"ascending":"descending"); th2.classList.toggle("sort-asc",asc); th2.classList.toggle("sort-desc",!asc);} else {th2.removeAttribute("aria-sort"); th2.classList.remove("sort-asc"); th2.classList.remove("sort-desc");}});
      asc=!asc;
    });
  });
}

/* ===============================
   Auto Refresh
   =============================== */
function setAutoRefresh(sec){ clearInterval(state.autoRefreshTimer); if(sec>=CONFIG.AUTO_REFRESH_MIN) state.autoRefreshTimer=setInterval(refreshRanking,sec*1000); }

function attachAutoRefreshControls(){
  const toggle=$("#autoRefreshToggle"),secInput=$("#autoRefreshSec"); if(!toggle||!secInput) return;
  if(toggle.checked){ const sec=parseInt(secInput.value,10); if(sec>=CONFIG.AUTO_REFRESH_MIN)setAutoRefresh(sec);}
  toggle.addEventListener("change",()=>{ const sec=parseInt(secInput.value,10); toggle.checked && sec>=CONFIG.AUTO_REFRESH_MIN ? setAutoRefresh(sec) : clearInterval(state.autoRefreshTimer); });
  secInput.addEventListener("change",()=>{ let sec=parseInt(secInput.value,10); if(sec<CONFIG.AUTO_REFRESH_MIN) secInput.value=CONFIG.AUTO_REFRESH_MIN; if(toggle.checked) setAutoRefresh(sec); });
}

/* ===============================
   Modal Controls
   =============================== */
function attachModalControls(){
  const modal=$("#chartModal"); if(!modal) return;
  const closeBtn=$("#chartCloseBtn")||modal.querySelector(".modal-close");
  if(closeBtn) closeBtn.addEventListener("click",()=>modal.style.display="none");
  modal.addEventListener("click",e=>{if(e.target===modal) modal.style.display="none";});
  document.addEventListener("keydown",e=>{if(e.key==="Escape") modal.style.display="none";});
}

/* ===============================
   Initialization
   =============================== */
document.addEventListener("DOMContentLoaded",()=>{
  loadAppData();
  setAdminMode(false);
  attachSearch();
  attachSorting();
  attachAutoRefreshControls();
  attachModalControls();
  refreshRanking();
  $("#refreshBtn")?.addEventListener("click",refreshRanking);
  $("#downloadCSVBtn")?.addEventListener("click",downloadCSV);
  $("#adminToggleBtn")?.addEventListener("click",()=>{
    const pass=prompt("管理者パスワードを入力"); setAdminMode(pass===CONFIG.ADMIN_PASSWORD);
  });
});
