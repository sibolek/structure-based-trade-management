import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  enrichWithExecutionOs,
  localDateKey,
  reconstructDailyTrades,
  summarizeReport,
} from "./eod-report-core.mjs";

const ROOT = process.cwd();
const HISTORY_SCRIPT = path.join(ROOT, "schwab-bridge", "history.mjs");
const EXPORT_PATTERN = /^executionos-eod-history-.*\.json$/i;

function parseArgs() {
  const values = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || true];
  }));
  const date = typeof values.date === "string" ? values.date.trim() : localDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must use YYYY-MM-DD.");
  const symbol = typeof values.symbol === "string" ? values.symbol.trim().toUpperCase() : null;
  const executionos = typeof values.executionos === "string" ? expandHome(values.executionos.trim()) : null;
  const out = typeof values.out === "string" ? path.resolve(expandHome(values.out.trim())) : null;
  return { date, symbol, executionos, out };
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function dateAtLocalMidnight(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function lookbackDaysFor(dateKey) {
  const target = dateAtLocalMidnight(dateKey);
  const today = dateAtLocalMidnight(localDateKey());
  if (!target || !today) throw new Error(`Invalid report date ${dateKey}.`);
  const diff = Math.floor((today.getTime() - target.getTime()) / 86_400_000);
  if (diff < 0) throw new Error("EOD reports cannot be generated for a future date.");
  const days = diff + 2;
  if (days > 365) throw new Error("The Schwab history utility is limited to a 365-day lookback.");
  return Math.max(1, days);
}

function runHistoryExport({ date, symbol }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-eod-"));
  const exportPath = path.join(tempDir, "schwab-history.json");
  const args = [HISTORY_SCRIPT, `--days=${lookbackDaysFor(date)}`, "--quiet", `--export=${exportPath}`];
  if (symbol) args.push(`--symbol=${symbol}`);
  const child = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  if (child.status !== 0) {
    const detail = [child.stdout, child.stderr].filter(Boolean).join("\n").trim();
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Schwab history export failed.${detail ? `\n${detail}` : ""}`);
  }
  const payload = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  fs.rmSync(tempDir, { recursive: true, force: true });
  return payload;
}

function latestExecutionOsExport() {
  const downloads = path.join(os.homedir(), "Downloads");
  if (!fs.existsSync(downloads)) return null;
  const candidates = fs.readdirSync(downloads)
    .filter((name) => EXPORT_PATTERN.test(name))
    .map((name) => {
      const filePath = path.join(downloads, name);
      try { return { filePath, mtime: fs.statSync(filePath).mtimeMs }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.filePath || null;
}

function loadExecutionOsExport(explicitPath) {
  const filePath = explicitPath || latestExecutionOsExport();
  if (!filePath) return { payload: null, filePath: null, autoDetected: false };
  if (!fs.existsSync(filePath)) throw new Error(`ExecutionOS history export not found: ${filePath}`);
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(payload.history)) throw new Error(`ExecutionOS export does not contain a history array: ${filePath}`);
  return { payload, filePath, autoDetected: !explicitPath };
}

async function currentRiskSnapshot() {
  try {
    const response = await fetch("http://127.0.0.1:8787/api/state", { signal: AbortSignal.timeout(750) });
    if (!response.ok) return [];
    const state = await response.json();
    if (!Array.isArray(state?.accounts)) return [];
    return state.accounts.map((account, index) => ({
      accountKey: `A${index + 1}`,
      equity: Number(account.equity),
      maxRisk: Number(account.maxRisk),
    })).filter((item) => Number.isFinite(item.equity) || Number.isFinite(item.maxRisk));
  } catch {
    return [];
  }
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

function plainMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function decimal(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function timeLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function printTerminal({ date, symbol, completedTrades, openTrades, incompleteActivity, warnings, summary, executionExport, riskSnapshots, htmlPath }) {
  console.log(`\nEXECUTIONOS END-OF-DAY REPORT — ${date}${symbol ? ` — ${symbol}` : ""}`);
  console.log("================================================================================");
  console.log("Source: Schwab read-only order history + ExecutionOS trade-state reconstruction");
  console.log(`ExecutionOS plan export: ${executionExport.filePath ? executionExport.filePath : "not supplied"}`);
  if (executionExport.autoDetected) console.log("ExecutionOS export was auto-detected from ~/Downloads.");

  console.log("\nDAILY SUMMARY");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Completed trade cycles:      ${summary.completed}`);
  console.log(`Open reconstructed cycles:   ${summary.open}`);
  console.log(`W / L / Flat:                ${summary.winners} / ${summary.losers} / ${summary.flats}`);
  console.log(`Win rate:                    ${pct(summary.winRate)}`);
  console.log(`Gross realized P/L*:         ${money(summary.grossPnl)}`);
  console.log(`Average winner:              ${money(summary.averageWinner)}`);
  console.log(`Average loser:               ${money(summary.averageLoser)}`);
  console.log(`Profit factor (gross):       ${summary.profitFactor === Infinity ? "∞" : decimal(summary.profitFactor)}`);
  console.log(`Avg win/loss factor:         ${summary.averageWinLossFactor === Infinity ? "∞" : decimal(summary.averageWinLossFactor)}`);
  console.log(`Largest winner:              ${money(summary.largestWinner)}`);
  console.log(`Largest loser:               ${money(summary.largestLoser)}`);

  if (riskSnapshots.length) {
    console.log("\nCOB RISK SNAPSHOT (current monitor state; not frozen per-trade risk budget)");
    console.log("--------------------------------------------------------------------------------");
    for (const snapshot of riskSnapshots) {
      console.log(`${snapshot.accountKey}: equity ${plainMoney(snapshot.equity)} · 0.5% max ${plainMoney(snapshot.maxRisk)}`);
    }
  }

  console.log("\nTRADE-BY-TRADE");
  console.log("--------------------------------------------------------------------------------");
  if (!completedTrades.length) console.log("No complete same-day trade cycles reconstructed.");
  for (const trade of completedTrades) {
    const osTrade = trade.executionOs;
    const ownership = osTrade ? "ExecutionOS" : summary.executionExportLoaded ? "Broker-only" : "Plan n/a";
    const risk = osTrade?.plannedRisk;
    const r = osTrade?.rMultiple;
    console.log(
      `${timeLabel(trade.startedAt)}-${timeLabel(trade.endedAt)}  ${trade.symbol.padEnd(8)} ${trade.direction.padEnd(5)} ` +
      `qty ${String(trade.peakQuantity).padStart(5)}  ${plainMoney(trade.entryVwap)} → ${plainMoney(trade.exitVwap)}  ` +
      `P/L ${money(trade.grossPnl).padStart(10)}  ${ownership}` +
      `${Number.isFinite(risk) ? `  risk ${plainMoney(risk)}` : ""}` +
      `${Number.isFinite(r) ? `  ${r >= 0 ? "+" : ""}${r.toFixed(2)}R` : ""}`,
    );
  }
  for (const trade of openTrades) {
    console.log(`${timeLabel(trade.startedAt)}-OPEN   ${trade.symbol.padEnd(8)} ${trade.direction.padEnd(5)} qty ${String(trade.peakQuantity).padStart(5)}  entry ${plainMoney(trade.entryVwap)}  realized so far ${money(trade.grossPnl)}`);
  }

  if (summary.executionExportLoaded) {
    console.log("\nEXECUTIONOS RISK / PROCESS");
    console.log("--------------------------------------------------------------------------------");
    console.log(`ExecutionOS-owned cycles:    ${summary.executionOwnedTrades}`);
    console.log(`Broker-only cycles:          ${summary.brokerOnlyTrades}`);
    console.log(`Total planned risk:          ${plainMoney(summary.totalPlannedRisk)}`);
    console.log(`Average planned risk:        ${plainMoney(summary.averagePlannedRisk)}`);
    console.log(`Maximum planned risk:        ${plainMoney(summary.maxPlannedRisk)}`);
    console.log(`Total R:                     ${Number.isFinite(summary.totalR) ? `${summary.totalR >= 0 ? "+" : ""}${summary.totalR.toFixed(2)}R` : "—"}`);
    console.log(`Average R/trade:             ${Number.isFinite(summary.averageR) ? `${summary.averageR >= 0 ? "+" : ""}${summary.averageR.toFixed(2)}R` : "—"}`);
    console.log(`THREATENED transitions:      ${summary.stateStats.threatened}`);
    console.log(`THREATENED → VALID:          ${summary.stateStats.validAfterThreat}`);
    console.log(`INVALID transitions:         ${summary.stateStats.invalid}`);
  } else {
    console.log("\nPLAN/RISK ENRICHMENT");
    console.log("--------------------------------------------------------------------------------");
    console.log("No ExecutionOS browser-history export was found. Broker P/L is still reported, but planned risk, R, setup, and process transitions are unavailable.");
    console.log("With the app running at localhost:5173, open http://localhost:5173/eod-export.html and download the history file, then rerun this command.");
  }

  if (warnings.length || incompleteActivity.length) {
    console.log("\nCONTEXT WARNINGS");
    console.log("--------------------------------------------------------------------------------");
    for (const warning of warnings) console.log(`⚠ ${warning}`);
    if (incompleteActivity.length) console.log(`⚠ ${incompleteActivity.length} execution leg(s) were excluded from reconstructed P/L because the position context began before the report window.`);
  }

  console.log(`\nHTML report: ${htmlPath}`);
  console.log("* Gross realized P/L is reconstructed from complete-context Schwab fill cycles. If context warnings appear, it is not a definitive whole-account daily P/L total.\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function card(label, value, cls = "") {
  return `<div class="metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value ${cls}">${escapeHtml(value)}</div></div>`;
}

function htmlReport({ date, symbol, completedTrades, openTrades, incompleteActivity, warnings, summary, executionExport, riskSnapshots }) {
  const title = `ExecutionOS EOD — ${date}${symbol ? ` — ${symbol}` : ""}`;
  const pnlClass = summary.grossPnl > 0 ? "positive" : summary.grossPnl < 0 ? "negative" : "";
  const rows = completedTrades.map((trade) => {
    const osTrade = trade.executionOs;
    const ownership = osTrade ? "ExecutionOS" : summary.executionExportLoaded ? "Broker-only" : "Plan unavailable";
    return `<tr>
      <td>${escapeHtml(`${timeLabel(trade.startedAt)}–${timeLabel(trade.endedAt)}`)}</td>
      <td><strong>${escapeHtml(trade.symbol)}</strong></td>
      <td>${escapeHtml(trade.direction)}</td>
      <td>${escapeHtml(osTrade?.setup || "—")}</td>
      <td class="num">${escapeHtml(trade.peakQuantity)}</td>
      <td class="num">${escapeHtml(plainMoney(trade.entryVwap))}</td>
      <td class="num">${escapeHtml(plainMoney(trade.exitVwap))}</td>
      <td class="num ${trade.grossPnl > 0 ? "positive" : trade.grossPnl < 0 ? "negative" : ""}">${escapeHtml(money(trade.grossPnl))}</td>
      <td class="num">${escapeHtml(osTrade?.plannedRisk != null ? plainMoney(osTrade.plannedRisk) : "—")}</td>
      <td class="num">${escapeHtml(Number.isFinite(osTrade?.rMultiple) ? `${osTrade.rMultiple >= 0 ? "+" : ""}${osTrade.rMultiple.toFixed(2)}R` : "—")}</td>
      <td>${escapeHtml(ownership)}</td>
    </tr>`;
  }).join("\n");

  const detailCards = completedTrades.filter((trade) => trade.executionOs).map((trade) => {
    const osTrade = trade.executionOs;
    const timeline = osTrade.decisions.map((item) => `<li><span>${escapeHtml(item.time || timeLabel(item.timestamp))}</span><strong>${escapeHtml(item.stage || "")}</strong><em>${escapeHtml(item.state || "")}</em><div>${escapeHtml(item.action || "")}${item.note ? ` — ${escapeHtml(item.note)}` : ""}</div></li>`).join("");
    return `<article class="trade-detail">
      <div class="trade-detail-head"><div><div class="eyebrow">EXECUTIONOS-OWNED</div><h3>${escapeHtml(trade.symbol)} ${escapeHtml(trade.direction)} · ${escapeHtml(osTrade.setup || "Setup not named")}</h3></div><div class="pnl ${trade.grossPnl >= 0 ? "positive" : "negative"}">${escapeHtml(money(trade.grossPnl))}</div></div>
      <div class="detail-grid">
        <div><label>Thesis</label><p>${escapeHtml(osTrade.thesis || "—")}</p></div>
        <div><label>Trigger</label><p>${escapeHtml(osTrade.trigger || "—")}</p></div>
        <div><label>Invalidation</label><p>${escapeHtml(osTrade.invalidation || "—")}</p></div>
        <div><label>Structural stop</label><p>${escapeHtml(osTrade.structuralStop ?? "—")}</p></div>
        <div><label>Target</label><p>${escapeHtml(osTrade.target || "—")}</p></div>
        <div><label>Management</label><p>${escapeHtml(osTrade.management || "—")}</p></div>
        <div><label>Planned risk</label><p>${escapeHtml(plainMoney(osTrade.plannedRisk))}</p></div>
        <div><label>Entry-VWAP stop risk @ peak qty</label><p>${escapeHtml(plainMoney(osTrade.actualEntryRisk))}</p></div>
        <div><label>R multiple</label><p>${escapeHtml(Number.isFinite(osTrade.rMultiple) ? `${osTrade.rMultiple >= 0 ? "+" : ""}${osTrade.rMultiple.toFixed(2)}R` : "—")}</p></div>
        <div><label>Exit classification</label><p>${escapeHtml(osTrade.exitClassification || "—")}</p></div>
        <div><label>Exit reason</label><p>${escapeHtml(osTrade.exitReason || "—")}</p></div>
      </div>
      <h4>Lifecycle</h4><ol class="timeline">${timeline || "<li>No decision events recorded.</li>"}</ol>
    </article>`;
  }).join("\n");

  const warningHtml = [...warnings, ...(incompleteActivity.length ? [`${incompleteActivity.length} execution leg(s) excluded from reconstructed P/L because same-day history began with a closing fill.`] : [])]
    .map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("");

  const riskHtml = riskSnapshots.length ? `<section><div class="section-title"><div><div class="eyebrow">CURRENT MONITOR STATE</div><h2>COB Risk Snapshot</h2></div></div><div class="metrics">${riskSnapshots.map((snapshot) => card(`${snapshot.accountKey} equity`, plainMoney(snapshot.equity)) + card(`${snapshot.accountKey} 0.5% max`, plainMoney(snapshot.maxRisk))).join("")}</div><p class="note">This is the current close-of-business monitor snapshot. It is not treated as the frozen per-trade risk budget.</p></section>` : "";

  const processHtml = summary.executionExportLoaded ? `<section><div class="section-title"><div><div class="eyebrow">ORIGINAL PLAN DATA</div><h2>Risk & Execution Process</h2></div></div><div class="metrics">${[
    card("ExecutionOS-owned", summary.executionOwnedTrades),
    card("Broker-only", summary.brokerOnlyTrades),
    card("Total planned risk", plainMoney(summary.totalPlannedRisk)),
    card("Average planned risk", plainMoney(summary.averagePlannedRisk)),
    card("Maximum planned risk", plainMoney(summary.maxPlannedRisk)),
    card("Total R", Number.isFinite(summary.totalR) ? `${summary.totalR >= 0 ? "+" : ""}${summary.totalR.toFixed(2)}R` : "—"),
    card("Average R", Number.isFinite(summary.averageR) ? `${summary.averageR >= 0 ? "+" : ""}${summary.averageR.toFixed(2)}R` : "—"),
    card("THREATENED", summary.stateStats.threatened),
    card("THREATENED → VALID", summary.stateStats.validAfterThreat),
    card("INVALID", summary.stateStats.invalid),
  ].join("")}</div></section>` : `<section><div class="warning">No ExecutionOS browser-history export was loaded. Planned risk, R, setup and process transitions are unavailable in this run. Use <code>http://localhost:5173/eod-export.html</code> while the app is running, then rerun the command.</div></section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark;--bg:#07100d;--panel:#0c1713;--panel2:#101d18;--line:#20352c;--muted:#7d948b;--text:#e7f3ee;--green:#4bea72;--red:#ff6b73;--amber:#f1bf58;--cyan:#62d7ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#10251b 0,#07100d 38%);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1440px;margin:auto;padding:34px 24px 70px}header{border:1px solid var(--line);background:linear-gradient(180deg,rgba(16,34,27,.96),rgba(9,18,15,.96));padding:28px;border-radius:14px;box-shadow:0 20px 60px #0008}.eyebrow{font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.15em;color:var(--green);text-transform:uppercase}h1{font-size:34px;margin:5px 0 3px}h2{font-size:20px;margin:3px 0}h3{font-size:18px;margin:3px 0}h4{margin:20px 0 8px;color:#b9cec5}.subtitle,.note{color:var(--muted)}section{margin-top:24px;border:1px solid var(--line);background:rgba(10,22,18,.9);padding:22px;border-radius:12px}.section-title{display:flex;align-items:end;justify-content:space-between;margin-bottom:14px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px}.metric{border:1px solid var(--line);background:var(--panel2);padding:14px;border-radius:9px}.metric-label{font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.metric-value{font-size:21px;font-weight:750;margin-top:4px}.positive{color:var(--green)!important}.negative{color:var(--red)!important}.warning{border:1px solid #7a5a21;background:#2b210d;color:#ffe4a6;padding:12px 14px;border-radius:8px;margin-top:9px}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:9px}table{width:100%;border-collapse:collapse;background:#09120f;font-size:12px}th,td{padding:9px 8px;border-bottom:1px solid #172820;text-align:left}th{font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:#0d1915;position:sticky;top:0;white-space:normal}td{white-space:nowrap}th:nth-child(4),td:nth-child(4),th:nth-child(11),td:nth-child(11){white-space:normal;overflow-wrap:anywhere}td:nth-child(4){min-width:130px;max-width:220px}td.num{text-align:right;font-variant-numeric:tabular-nums}.trade-detail{margin-top:12px;border:1px solid var(--line);background:#0a1511;padding:18px;border-radius:10px}.trade-detail-head{display:flex;justify-content:space-between;gap:15px}.pnl{font-size:22px;font-weight:800}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:14px}.detail-grid>div{border:1px solid #1a2b24;background:#0d1a16;padding:11px;border-radius:7px}.detail-grid label{display:block;font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.detail-grid p{margin:4px 0 0}.timeline{list-style:none;padding:0;margin:0}.timeline li{display:grid;grid-template-columns:80px 75px 95px 1fr;gap:10px;padding:9px 0;border-bottom:1px solid #172820}.timeline li span,.timeline li strong,.timeline li em{font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace}.timeline li span{color:var(--muted)}.timeline li em{color:var(--amber);font-style:normal}code{color:var(--cyan)}footer{color:var(--muted);margin-top:18px;font-size:12px}@media(max-width:700px){.wrap{padding:16px 10px 50px}h1{font-size:26px}.timeline li{grid-template-columns:1fr}.trade-detail-head{display:block}}
</style></head><body><div class="wrap">
<header><div class="eyebrow">ExecutionOS · End-of-Day</div><h1>${escapeHtml(date)}${symbol ? ` · ${escapeHtml(symbol)}` : ""}</h1><div class="subtitle">Schwab read-only fills · reconstructed trade cycles · optional ExecutionOS plan/risk enrichment</div></header>
${warningHtml ? `<section><div class="section-title"><div><div class="eyebrow">DATA QUALITY</div><h2>Context Warnings</h2></div></div>${warningHtml}</section>` : ""}
<section><div class="section-title"><div><div class="eyebrow">ACTUAL RESULTS</div><h2>Daily Summary</h2></div></div><div class="metrics">${[
  card("Completed cycles", summary.completed), card("Open cycles", summary.open), card("W / L / Flat", `${summary.winners} / ${summary.losers} / ${summary.flats}`), card("Win rate", pct(summary.winRate)), card("Gross realized P/L*", money(summary.grossPnl), pnlClass), card("Profit factor (gross)", summary.profitFactor === Infinity ? "∞" : decimal(summary.profitFactor)), card("Avg W/L factor", summary.averageWinLossFactor === Infinity ? "∞" : decimal(summary.averageWinLossFactor)), card("Average winner", money(summary.averageWinner), "positive"), card("Average loser", money(summary.averageLoser), "negative"), card("Largest winner", money(summary.largestWinner), "positive"), card("Largest loser", money(summary.largestLoser), "negative")
].join("")}</div><p class="note">Profit factor (gross) = gross profit ÷ gross loss. Avg W/L factor = average winner ÷ absolute average loser.</p></section>
${riskHtml}
<section><div class="section-title"><div><div class="eyebrow">BROKER-AUTHORITATIVE FILLS</div><h2>Trade-by-Trade</h2></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Setup</th><th>Peak Qty</th><th>Entry VWAP</th><th>Exit VWAP</th><th>P/L</th><th>Planned Risk</th><th>R</th><th>Ownership</th></tr></thead><tbody>${rows || `<tr><td colspan="11">No complete same-day trade cycles reconstructed.</td></tr>`}</tbody></table></div>${openTrades.length ? `<p class="note">Open reconstructed cycles: ${escapeHtml(openTrades.map((trade) => `${trade.symbol} ${trade.direction} @ ${plainMoney(trade.entryVwap)}`).join(" · "))}</p>` : ""}</section>
${processHtml}
${detailCards ? `<section><div class="section-title"><div><div class="eyebrow">READ → PLAN → TRIGGER → RISK → HOLD → UPDATE → EXIT</div><h2>ExecutionOS Trade Details</h2></div></div>${detailCards}</section>` : ""}
<footer>* Gross realized P/L is reconstructed from complete-context Schwab execution cycles. When a symbol's first same-day fill closes a position opened before the report window, that activity is excluded and the report is explicitly marked incomplete rather than inventing a cost basis. Generated ${escapeHtml(new Date().toLocaleString())}.${executionExport.filePath ? ` ExecutionOS plan source: ${escapeHtml(executionExport.filePath)}.` : ""}</footer>
</div></body></html>`;
}

async function main() {
  const args = parseArgs();
  const historyPayload = runHistoryExport(args);
  const reconstructed = reconstructDailyTrades(historyPayload.executionLegs || [], { date: args.date, symbol: args.symbol });
  const executionExport = loadExecutionOsExport(args.executionos);
  const enriched = enrichWithExecutionOs(reconstructed.completedTrades, executionExport.payload, { date: args.date });
  const completedTrades = enriched.trades;
  const summary = summarizeReport({
    completedTrades,
    openTrades: reconstructed.openTrades,
    incompleteActivity: reconstructed.incompleteActivity,
    executionExportLoaded: enriched.exportLoaded,
  });
  const riskSnapshots = await currentRiskSnapshot();
  const defaultName = `${args.date}${args.symbol ? `-${args.symbol}` : ""}.html`;
  const htmlPath = args.out || path.join(ROOT, "reports", "eod", defaultName);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, htmlReport({
    date: args.date,
    symbol: args.symbol,
    completedTrades,
    openTrades: reconstructed.openTrades,
    incompleteActivity: reconstructed.incompleteActivity,
    warnings: reconstructed.warnings,
    summary,
    executionExport,
    riskSnapshots,
  }), "utf8");

  printTerminal({
    date: args.date,
    symbol: args.symbol,
    completedTrades,
    openTrades: reconstructed.openTrades,
    incompleteActivity: reconstructed.incompleteActivity,
    warnings: reconstructed.warnings,
    summary,
    executionExport,
    riskSnapshots,
    htmlPath,
  });

  if (enriched.unmatchedHistory.length) {
    console.log(`Note: ${enriched.unmatchedHistory.length} ExecutionOS history trade(s) for ${args.date} could not be matched to a same-day Schwab cycle within five minutes of the recorded entry detection time.`);
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});