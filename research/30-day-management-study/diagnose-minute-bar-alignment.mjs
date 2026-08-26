import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");
const CACHE_PATH = path.join(HERE, "schwab-minute-cache.json");
const FAST_CUTOFF_SEC = 209;
const TARGET_N = 19;
const WINDOWS = [300, 600, 900, 1800, 3600];
const TARGET = {
  hold209: 111.30, improved209: 6,
  hold842: 18.16, losers842: 11,
  mfe: { 300: 387, 600: 513, 900: 687, 1800: 858, 3600: 1185 },
  twice: { 300: 15, 600: 16, 3600: 17 },
};

function readJson(p) { if (!fs.existsSync(p)) throw new Error(`Missing local file: ${p}`); return JSON.parse(fs.readFileSync(p, "utf8")); }
function pnl(t) { return Number(t?.realizedPnl ?? t?.realizedGrossPnl); }
function dur(t) { const a=Date.parse(t?.entryAt||""); const b=Date.parse(t?.exitAt||""); return Number.isFinite(a)&&Number.isFinite(b)?(b-a)/1000:null; }
function day(t) { return String(t?.tradingDay || new Date(t.entryAt).toISOString().slice(0,10)); }
function entryPrice(t) { return Number(t?.entryPrice ?? t?.entryVWAP); }
function qty(t) { return Number(t?.initialQuantity ?? t?.quantity); }
function side(t) { return String(t?.direction||"LONG").toUpperCase(); }
function pnlAt(t, px) { const e=entryPrice(t), q=qty(t); if (![e,q,px].every(Number.isFinite)||q<=0) return null; return (side(t)==="SHORT"?e-px:px-e)*q; }
function ms(s) { const n=Date.parse(s?.timestamp||""); return Number.isFinite(n)?n:null; }
function systematic(rows, step, offset) { const out=[]; for(let i=offset;i<rows.length&&out.length<TARGET_N;i+=step) out.push(rows[i]); return out; }
function equalCount(rows,n=TARGET_N,sel="middle") { const out=[]; for(let i=0;i<n;i++){const lo=Math.floor(i*rows.length/n),hi=Math.floor((i+1)*rows.length/n),b=rows.slice(lo,hi); if(!b.length)continue; const j=sel==="last"?b.length-1:sel==="middle"?Math.floor((b.length-1)/2):0; out.push(b[j]);} return out; }
function allocate(groups,target){ const total=[...groups.values()].reduce((s,r)=>s+r.length,0); const a=[]; let assigned=0; for(const [k,r] of groups){const ex=r.length*target/total,base=Math.floor(ex); a.push({k,r,count:base,rem:ex-base});assigned+=base;} a.sort((x,y)=>y.rem-x.rem||String(x.k).localeCompare(String(y.k))); for(let i=0;i<target-assigned;i++)a[i].count++; a.sort((x,y)=>String(x.k).localeCompare(String(y.k))); return a; }
function byDay(rows,mode){const g=new Map(); for(const t of rows){const k=day(t); if(!g.has(k))g.set(k,[]);g.get(k).push(t);} const out=[]; for(const x of allocate(g,TARGET_N)){if(!x.count)continue; let r=[...x.r]; if(mode.startsWith("duration"))r.sort((a,b)=>dur(a)-dur(b)||Date.parse(a.entryAt)-Date.parse(b.entryAt)); else r.sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt)); out.push(...equalCount(r,x.count,mode.endsWith("first")?"first":"middle"));} return out.sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt)); }
function buildCandidates(eligible){const c=[...eligible].sort((a,b)=>Date.parse(a.entryAt)-Date.parse(b.entryAt)); const d=[...eligible].sort((a,b)=>dur(a)-dur(b)||Date.parse(a.entryAt)-Date.parse(b.entryAt)); const out=[]; for(let o=0;o<10;o++){const a=systematic(c,10,o),b=systematic(d,10,o); if(a.length===19)out.push([`chrono systematic offset ${o}`,a]); if(b.length===19)out.push([`duration systematic offset ${o}`,b]);} for(const s of ["first","middle","last"]){out.push([`chrono 19-strata ${s}`,equalCount(c,19,s)]); out.push([`duration 19-strata ${s}`,equalCount(d,19,s)]);} out.push(["day proportional chronological-first",byDay(c,"chronological-first")]); out.push(["day proportional chronological-middle",byDay(c,"chronological-middle")]); out.push(["day proportional duration-middle",byDay(c,"duration-middle")]); return out.filter(([,r])=>r.length===19); }

const CF_MODES = {
  "next-start close": (samples,target)=>samples.filter(s=>ms(s)>=target).sort((a,b)=>ms(a)-ms(b))[0]?.close,
  "containing-bar close": (samples,target)=>samples.filter(s=>ms(s)<=target && target<ms(s)+60000).sort((a,b)=>ms(b)-ms(a))[0]?.close,
  "last-completed close": (samples,target)=>samples.filter(s=>ms(s)+60000<=target).sort((a,b)=>ms(b)-ms(a))[0]?.close,
  "next-start open": (samples,target)=>samples.filter(s=>ms(s)>=target).sort((a,b)=>ms(a)-ms(b))[0]?.open,
};
const MFE_MODES = {
  "exclude-entry-minute": (s,start,end)=>{const t=ms(s); return Number.isFinite(t)&&t>=start&&t<=end;},
  "overlap-entry-minute": (s,start,end)=>{const t=ms(s); return Number.isFinite(t)&&t+60000>start&&t<=end;},
};
function counterfactual(rows,holdSec,cfMode,samplesFor){let agg=0,improved=0,losers=0,n=0; for(const t of rows){const samples=samplesFor(t),target=Date.parse(t.entryAt)+holdSec*1000,px=Number(CF_MODES[cfMode](samples,target)); const v=pnlAt(t,px); if(!Number.isFinite(v))continue; n++; agg+=v; if(v>pnl(t))improved++; if(v<0)losers++;} return {agg,improved,losers,n};}
function mfeForTrade(t,window,mfeMode,samplesFor){const start=Date.parse(t.entryAt),end=start+window*1000,samples=samplesFor(t).filter(s=>MFE_MODES[mfeMode](s,start,end)); const vals=[]; for(const s of samples){const px=side(t)==="SHORT"?Number(s.low):Number(s.high); const v=pnlAt(t,px); if(Number.isFinite(v))vals.push(v);} return vals.length?Math.max(0,...vals):null;}
function aggregateMfe(rows,w,mfeMode,samplesFor){return rows.reduce((sum,t)=>{const v=mfeForTrade(t,w,mfeMode,samplesFor); return sum+(Number.isFinite(v)?v:0);},0);}
function twice(rows,w,mfeMode,samplesFor){return rows.filter(t=>{const v=mfeForTrade(t,w,mfeMode,samplesFor),a=pnl(t); return Number.isFinite(v)&&a>0&&v>=2*a;}).length;}
function dErr(a,t){return Math.abs(a-t)/Math.max(Math.abs(t),25);} function cErr(a,t){return Math.abs(a-t)/19;}
function score(rows,cfMode,mfeMode,samplesFor){const a=counterfactual(rows,209,cfMode,samplesFor),b=counterfactual(rows,842,cfMode,samplesFor); const mfe=Object.fromEntries(WINDOWS.map(w=>[w,aggregateMfe(rows,w,mfeMode,samplesFor)])); const tw={300:twice(rows,300,mfeMode,samplesFor),600:twice(rows,600,mfeMode,samplesFor),3600:twice(rows,3600,mfeMode,samplesFor)}; const s=dErr(a.agg,TARGET.hold209)+cErr(a.improved,TARGET.improved209)+dErr(b.agg,TARGET.hold842)+cErr(b.losers,TARGET.losers842)+WINDOWS.reduce((x,w)=>x+dErr(mfe[w],TARGET.mfe[w]),0)+cErr(tw[300],15)+cErr(tw[600],16)+cErr(tw[3600],17); return {score:s,cf209:a,cf842:b,mfe,tw};}
function money(v){return `${v>=0?"+":""}$${v.toFixed(2)}`;}

const study=readJson(STUDY_PATH); const cache=readJson(CACHE_PATH); const trades=Array.isArray(study?.trades)?study.trades:[]; const eligible=trades.filter(t=>pnl(t)>0&&Number.isFinite(dur(t))&&dur(t)<=FAST_CUTOFF_SEC); const candidates=buildCandidates(eligible);
function samplesFor(t){return cache?.entries?.[`${day(t)}|${String(t.symbol).toUpperCase()}`]?.samples||[];}

console.log("ExecutionOS minute-bar alignment forensic on frozen 27 candidate samples");
console.log("================================================================================");
console.log("No new trade combinations are generated. Existing Schwab cache only; no API calls.");
console.log("Historical targets are used only to compare standard 1-minute timing conventions.\n");
for(const cfMode of Object.keys(CF_MODES)){
  for(const mfeMode of Object.keys(MFE_MODES)){
    const ranked=candidates.map(([label,rows])=>({label,rows,...score(rows,cfMode,mfeMode,samplesFor)})).sort((a,b)=>a.score-b.score);
    const r=ranked[0];
    console.log(`${cfMode} + ${mfeMode}`);
    console.log(`  best=${r.label} score=${r.score.toFixed(3)}`);
    console.log(`  209s ${money(r.cf209.agg)} improved=${r.cf209.improved}/19 | 842s ${money(r.cf842.agg)} losers=${r.cf842.losers}/19`);
    console.log(`  MFE 5=${money(r.mfe[300])} 10=${money(r.mfe[600])} 15=${money(r.mfe[900])} 30=${money(r.mfe[1800])} 60=${money(r.mfe[3600])}`);
    console.log(`  2x 5/10/60=${r.tw[300]}/${r.tw[600]}/${r.tw[3600]}\n`);
  }
}
console.log("INTERPRETATION");
console.log("================================================================================");
console.log("If one standard timestamp convention materially improves the independent fingerprint across several metrics, use that convention in the next validation pass. If no convention does, bar alignment is not the missing provenance and the original 19 identities should remain unresolved rather than curve-fit.");
