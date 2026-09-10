import { normalizeSodArtifactContent, SOD_REPORT_SECTIONS } from "./sod-artifact-content.mjs";

export const SOD_ARTIFACT_RENDERER_VERSION = 1;

const REPORT_CSS = `
:root{--bg:#070b11;--panel:#0c121b;--panel2:#101722;--line:#223142;--line-soft:#1a2634;--text:#d8e1ea;--muted:#8ea0b2;--muted2:#6f8398;--cyan:#78d7ff;--green:#4bea72;--red:#ff6f7d;--amber:#ffc45f;--blue:#7bbcff}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(180deg,#060a0f 0,#08101a 100%);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.52;padding-left:250px}
.wrap{width:100%;max-width:1540px;margin:0 auto;padding:28px 34px 80px}.hero{border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,#101a27,#0b111a);padding:26px 28px 24px;margin-bottom:16px;box-shadow:0 16px 40px rgba(0,0,0,.24)}
.hero h1{font-size:34px;line-height:1.1;margin:6px 0 8px;letter-spacing:-.03em;color:#f6f9fc}.hero .sub{color:var(--muted);font-size:13px;max-width:1100px}.badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.badge{border:1px solid;padding:6px 9px;border-radius:999px;font-size:11.5px;font-weight:750}.badge.red{color:#ffd2d7;background:#33161d;border-color:#69303a}.badge.green{color:#c9f7d4;background:#10321f;border-color:#245e3c}.badge.amber{color:#ffe3aa;background:#3a2b11;border-color:#6d5523}.badge.blue{color:#d7ebff;background:#122840;border-color:#2b547b}.badge.neutral{color:#d8e1ea;background:#17212d;border-color:#35485d}
section{scroll-margin-top:18px;border:1px solid var(--line);border-radius:15px;background:rgba(12,18,27,.97);padding:19px 21px;margin:14px 0;box-shadow:0 10px 28px rgba(0,0,0,.16)}h2{font-size:19px;margin:0 0 12px;color:#f2f6fa;letter-spacing:-.015em}h3{font-size:14px;margin:15px 0 7px;color:#dce6ef}p{margin:7px 0}.muted{color:var(--muted)}.green{color:var(--green)}.red{color:var(--red)}.amber{color:var(--amber)}.blue,.cyan{color:var(--cyan)}.kicker{color:var(--cyan);font-weight:700;text-transform:uppercase;letter-spacing:.09em;font-size:11px}.rule{font-weight:760;color:#f4f7fb}.callout{margin:10px 0;padding:12px 14px;border-radius:11px;background:#0a1119;border:1px solid var(--line-soft)}.greenbar{border-left:4px solid var(--green)}.redbar{border-left:4px solid var(--red)}.amberbar{border-left:4px solid var(--amber)}.bluebar{border-left:4px solid var(--blue)}.neutralbar{border-left:4px solid var(--muted)}
.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0}.metric{border:1px solid var(--line-soft);background:#0a1119;border-radius:11px;padding:11px 12px}.metric .l{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.metric .v{font-size:17px;font-weight:800;color:#eef4fa;margin-top:2px}.metric .v.green{color:var(--green)}.metric .v.red{color:var(--red)}.metric .v.amber{color:var(--amber)}.metric .v.blue{color:var(--cyan)}
table{width:100%;border-collapse:separate;border-spacing:0;background:#0a1119;border:1px solid var(--line-soft);border-radius:12px;overflow:hidden}th,td{padding:9px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line-soft);font-size:12.5px}th{color:#b6c5d3;background:#101722;font-weight:700}tr:last-child td{border-bottom:none}.stars{color:var(--green);font-weight:700;letter-spacing:.4px;white-space:nowrap}ul,ol{margin:7px 0 7px 20px;padding:0}li{margin:4px 0}
.toc{position:fixed;left:0;top:0;bottom:0;width:250px;height:100vh;border:0;border-right:1px solid #1f2c39;background:rgba(7,11,16,.94);backdrop-filter:blur(12px);padding:22px 16px;overflow:auto;z-index:50}.toc h2{font-size:16px;margin:0 0 10px;padding:0 4px 8px;border-bottom:1px solid var(--line)}.toc-grid{display:flex;flex-direction:column;gap:3px}.toc a{color:#aebdca;text-decoration:none;padding:8px 10px;border-radius:9px;font-size:12px;line-height:1.5}.toc a:hover{color:var(--green);background:#152231}
.aplus-summary{margin-bottom:14px;overflow-x:auto}.aplus-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:12px;align-items:start}.aplus-card{border:1px solid var(--line);border-radius:14px;background:#0c131b;overflow:hidden}.aplus-head{padding:14px 15px 12px;border-bottom:1px solid #1f2c39;display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.aplus-rank{color:var(--muted);font-size:10px;letter-spacing:.09em;text-transform:uppercase;font-weight:800}.aplus-symbol{font-size:22px;line-height:1.15;font-weight:900;letter-spacing:-.03em;color:#f5f8fc}.aplus-subtitle{color:var(--muted);font-size:12px;margin-top:2px}.aplus-head-right{text-align:right}.direction{display:inline-flex;align-items:center;padding:4px 7px;border:1px solid var(--line);border-radius:7px;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.direction.short{color:#ffc9ce;background:rgba(255,95,109,.12);border-color:rgba(255,95,109,.22)}.direction.long{color:#c9f8d4;background:rgba(75,234,114,.12);border-color:rgba(75,234,114,.22)}.aplus-rating{color:var(--green);font-size:16px;font-weight:900;line-height:1.5;white-space:nowrap;margin-top:7px}.aplus-card.short .aplus-rating{color:var(--red)}.aplus-body{padding:14px 15px}.aplus-row{display:grid;grid-template-columns:92px minmax(0,1fr);gap:7px 10px;padding:6px 0;border-bottom:1px dashed #223142}.aplus-row:last-child{border-bottom:0;padding-bottom:6px}.aplus-label{color:var(--muted);text-transform:uppercase;font-size:9px;letter-spacing:.07em;font-weight:800}.aplus-value{color:#dbe5ec;font-size:12px;line-height:1.5}.aplus-value strong{color:#fff;font-weight:800}.footer{color:#8396aa;font-size:12px;padding:16px 4px 28px}
@media(max-width:1100px){body{padding-left:0}.toc{position:static;width:auto;height:auto;border:1px solid var(--line);border-radius:15px;margin:14px 20px 18px;padding:16px 14px}.toc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 14px}.wrap{width:100%;max-width:none;margin:0;padding:20px}.aplus-grid{grid-template-columns:1fr}.metric-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.wrap{padding:12px}.toc-grid{grid-template-columns:1fr}.aplus-row{grid-template-columns:1fr;row-gap:5px}.metric-grid{grid-template-columns:1fr}}@media print{.toc{display:none}body{padding-left:0}.wrap{width:100%;max-width:none;margin:0;padding:0}.hero,section,.aplus-card{box-shadow:none}}
`;

const DASHBOARD_CSS = `
:root{--nav:#0b2344;--bg:#f3f6fa;--card:#fff;--line:#dce4ee;--text:#152236;--muted:#64748b;--green:#087a46;--greenbg:#eaf8f0;--red:#b4233a;--redbg:#fff0f2;--amber:#9a6700;--amberbg:#fff7dd;--blue:#165d9b;--bluebg:#edf6ff}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.sidebar{position:fixed;left:0;top:0;bottom:0;width:250px;background:linear-gradient(180deg,var(--nav),#071a31);color:#dcecff;padding:22px 16px;overflow:auto}.brand{font-size:18px;font-weight:900}.subbrand{font-size:11px;color:#9fc0df;margin:3px 0 18px;text-transform:uppercase;letter-spacing:.12em}.sidebar a{display:block;color:#c9d9e8;text-decoration:none;padding:8px 10px;border-radius:8px;margin:2px 0;font-size:12px}.sidebar a:hover{background:#143b66;color:#fff}.sidequote{margin-top:18px;padding:12px;border:1px solid #315273;border-radius:10px;color:#b8cee2;font-size:11px}.main{margin-left:250px;padding:24px 28px 60px;max-width:1700px}.hero{background:linear-gradient(135deg,#fff,#f7fbff);border:1px solid var(--line);border-radius:18px;padding:24px;box-shadow:0 8px 28px rgba(27,55,90,.06)}.kicker{font-size:11px;color:var(--blue);font-weight:800;letter-spacing:.12em;text-transform:uppercase}.hero h1{font-size:30px;margin:4px 0 6px;letter-spacing:-.03em}.hero p{margin:0;color:var(--muted)}.pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.pill{padding:6px 9px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid}.pill.green{color:var(--green);background:var(--greenbg);border-color:#b9e5ce}.pill.red{color:var(--red);background:var(--redbg);border-color:#f0c3cc}.pill.amber{color:var(--amber);background:var(--amberbg);border-color:#efd99a}.pill.blue{color:var(--blue);background:var(--bluebg);border-color:#c7e2fa}.pill.neutral{color:#475569;background:#f1f5f9;border-color:#d8e0e8}.section{margin-top:16px;scroll-margin-top:18px}.section h2{font-size:17px;margin:0 0 10px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px;box-shadow:0 6px 20px rgba(20,50,80,.04)}.card h3{font-size:13px;margin:0 0 6px}.muted{color:var(--muted)}.metric{font-size:24px;font-weight:900;letter-spacing:-.03em}.small{font-size:12px}.greenText{color:var(--green)}.redText{color:var(--red)}.amberText{color:var(--amber)}.blueText{color:var(--blue)}table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}th,td{padding:9px 10px;border-bottom:1px solid #e7edf4;text-align:left;vertical-align:top;font-size:12px}th{background:#f5f8fc;color:#5e6f82;font-weight:800}tr:last-child td{border-bottom:none}.cands{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cand{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}.candhead{display:flex;justify-content:space-between;padding:12px 14px;background:#f8fbfe;border-bottom:1px solid var(--line)}.sym{font-size:20px;font-weight:900}.setup{font-size:11px;color:var(--muted)}.dir{font-size:10px;font-weight:900;padding:4px 7px;border-radius:7px;height:max-content}.dir.long{color:var(--green);background:var(--greenbg)}.dir.short{color:var(--red);background:var(--redbg)}.candbody{padding:12px 14px}.r{display:grid;grid-template-columns:90px 1fr;gap:8px;padding:6px 0;border-bottom:1px dashed #dfe7ef}.r:last-child{border-bottom:none}.lab{font-size:9px;text-transform:uppercase;letter-spacing:.09em;color:#8190a3;font-weight:900}.val{font-size:12px}.stars{font-weight:900;color:var(--green);letter-spacing:.05em}.framework{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}.step{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center;font-weight:800;font-size:11px}.footer{margin-top:22px;color:#738196;font-size:11px}@media(max-width:1250px){.grid{grid-template-columns:repeat(2,1fr)}.cands{grid-template-columns:1fr}.framework{grid-template-columns:repeat(4,1fr)}}@media(max-width:900px){.sidebar{position:static;width:auto}.main{margin-left:0;padding:16px}.grid,.grid2{grid-template-columns:1fr}.framework{grid-template-columns:repeat(2,1fr)}}
`;

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function html(value) { return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function md(value) { return text(value).replace(/([\\`*_{}\[\]<>#+.!|])/g, "\\$1"); }
function nl(value) { return html(value).replace(/\n/g, "<br>"); }

function direction(candidate) { return upper(candidate?.direction) === "SHORT" ? "SHORT" : "LONG"; }
function rating(candidate) { return text(candidate?.rating) || "—"; }
function symbol(candidate) { return text(candidate?.symbol) || "—"; }
function setup(candidate) { return text(candidate?.setup) || "—"; }
function priority(candidate, fallback) { const value = Number(candidate?.morningPriority); return Number.isInteger(value) && value > 0 ? value : fallback; }
function bestLocation(candidate) { return text(candidate?.bestLocation || candidate?.plan?.bestLocation || candidate?.plannedEntryReference) || "—"; }
function planText(candidate) { return text(candidate?.plannedEntryReference || candidate?.plan?.bestLocation) || "—"; }
function triggerText(candidate) { return text(candidate?.trigger?.satisfaction?.prompt || candidate?.trigger?.description || candidate?.trigger?.prompt) || "Manual confirmation required"; }
function invalidationText(candidate) { return text(candidate?.structuralInvalidation?.rule || candidate?.structuralInvalidation?.description || candidate?.structuralInvalidation?.reason) || "—"; }
function targetText(candidate) {
  const targets = Array.isArray(candidate?.targets) ? candidate.targets : [];
  return targets.map((target) => {
    if (target && typeof target === "object") {
      const value = target.price ?? target.level ?? target.value ?? target.priceOrZone;
      const label = text(target.label);
      return value !== undefined && value !== null && text(value) ? `${label ? `${label} ` : ""}${text(value)}` : label;
    }
    return text(target);
  }).filter(Boolean).join(" → ") || "—";
}
function noTradeText(candidate) {
  const values = Array.isArray(candidate?.noTradeConditions) && candidate.noTradeConditions.length
    ? candidate.noTradeConditions
    : Array.isArray(candidate?.disqualifiers) ? candidate.disqualifiers : [];
  return values.map(text).filter(Boolean).join("; ") || text(candidate?.plan?.noTradeZone) || "—";
}
function contextText(candidate) { return text(candidate?.catalyst || candidate?.context?.higherTimeframe) || "—"; }
function riskText(candidate) {
  const contextual = text(candidate?.context?.riskNote);
  const canonical = "0.5% max planned loss. Size from the structural/effective stop. Do not tighten the stop to fit risk; reduce size or pass. Treat correlated exposure as one risk cluster.";
  return contextual ? `${canonical} ${contextual}` : canonical;
}
function readText(candidate) { return text(candidate?.thesis) || "—"; }

function sortedCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({ candidate, rank: priority(candidate, index + 1) }))
    .sort((a, b) => a.rank - b.rank || symbol(a.candidate).localeCompare(symbol(b.candidate)));
}

function renderBlockHtml(block) {
  if (block.type === "paragraph") return `<p>${nl(block.text)}</p>`;
  if (block.type === "callout") return `<div class="callout ${html(block.tone)}bar">${nl(block.text)}</div>`;
  if (block.type === "list") {
    const tag = block.style === "numbered" ? "ol" : "ul";
    return `<${tag}>${block.items.map((item) => `<li>${nl(item)}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "metrics") {
    return `<div class="metric-grid">${block.items.map((item) => `<div class="metric"><div class="l">${html(item.label)}</div><div class="v ${html(item.tone)}">${html(item.value)}</div></div>`).join("")}</div>`;
  }
  if (block.type === "table") {
    const head = block.columns.map((column) => `<th>${html(column.label)}</th>`).join("");
    const rows = block.rows.map((row) => `<tr>${block.columns.map((column) => `<td>${nl(row[column.key])}</td>`).join("")}</tr>`).join("");
    return `<div style="overflow-x:auto"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return "";
}

function renderBlockMarkdown(block) {
  if (block.type === "paragraph") return md(block.text);
  if (block.type === "callout") return `> ${md(block.text)}`;
  if (block.type === "list") return block.items.map((item, index) => `${block.style === "numbered" ? `${index + 1}.` : "-"} ${md(item)}`).join("\n");
  if (block.type === "metrics") return block.items.map((item) => `- **${md(item.label)}:** ${md(item.value)}`).join("\n");
  if (block.type === "table") {
    const header = `| ${block.columns.map((column) => md(column.label)).join(" | ")} |`;
    const rule = `| ${block.columns.map(() => "---").join(" | ")} |`;
    const rows = block.rows.map((row) => `| ${block.columns.map((column) => md(row[column.key])).join(" | ")} |`).join("\n");
    return `${header}\n${rule}${rows ? `\n${rows}` : ""}`;
  }
  return "";
}

function candidateSummaryHtml(candidates) {
  const rows = sortedCandidates(candidates).map(({ candidate, rank }) => `<tr><td>${rank}</td><td><b>${html(symbol(candidate))}</b></td><td>${html(setup(candidate))}</td><td class="${direction(candidate) === "SHORT" ? "red" : "green"}">${direction(candidate)}</td><td>${html(bestLocation(candidate))}</td><td>${html(invalidationText(candidate))}</td><td>${html(targetText(candidate))}</td><td>${html(contextText(candidate))}</td><td class="stars">${html(rating(candidate))}</td></tr>`).join("");
  return `<div class="aplus-summary"><table><thead><tr><th>Rank</th><th>Instrument</th><th>Setup</th><th>Bias / Direction</th><th>Trigger / Best Location</th><th>Explicit Invalidation</th><th>Targets</th><th>Context / Catalyst</th><th>Rating</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function candidateCardRowsHtml(candidate) {
  const rows = [
    ["READ", readText(candidate)],
    ["PLAN", planText(candidate)],
    ["TRIGGER", triggerText(candidate)],
    ["INVALIDATION", invalidationText(candidate)],
    ["TARGETS", targetText(candidate)],
    ["RISK", riskText(candidate)],
    ["NO-TRADE", noTradeText(candidate)],
    ["BEST LOCATION", bestLocation(candidate)],
  ];
  return rows.map(([label, value]) => `<div class="aplus-row"><div class="aplus-label">${label}</div><div class="aplus-value">${nl(value)}</div></div>`).join("");
}

function candidateCardsHtml(candidates) {
  return `<div class="aplus-grid">${sortedCandidates(candidates).map(({ candidate, rank }) => {
    const dir = direction(candidate);
    return `<article class="aplus-card ${dir === "SHORT" ? "short" : ""}"><div class="aplus-head"><div><div class="aplus-rank">A+ #${rank}</div><div class="aplus-symbol">${html(symbol(candidate))}</div><div class="aplus-subtitle">${html(setup(candidate))}</div></div><div class="aplus-head-right"><span class="direction ${dir.toLowerCase()}">${dir}</span><div class="aplus-rating">${html(rating(candidate))}</div></div></div><div class="aplus-body">${candidateCardRowsHtml(candidate)}</div></article>`;
  }).join("")}</div>`;
}

function morningPriorityHtml(candidates) {
  const rows = sortedCandidates(candidates).map(({ candidate, rank }) => `<tr><td>${rank}</td><td><b>${html(symbol(candidate))} ${direction(candidate)}</b></td><td>${html(triggerText(candidate))}</td><td>${html(readText(candidate))}</td></tr>`).join("");
  return `<div style="overflow-x:auto"><table><thead><tr><th>Priority</th><th>Instrument</th><th>What must happen first</th><th>Why it ranks here</th></tr></thead><tbody>${rows}</tbody></table></div><div class="callout greenbar"><b>Correlation rule:</b> maximum two instruments live, and correlated exposures remain one directional risk cluster.</div>`;
}

function candidateSummaryMarkdown(candidates) {
  const header = "| Rank | Instrument | Setup | Direction | Best location | Invalidation | Targets | Context / Catalyst | Rating |\n| ---: | --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = sortedCandidates(candidates).map(({ candidate, rank }) => `| ${rank} | ${md(symbol(candidate))} | ${md(setup(candidate))} | ${direction(candidate)} | ${md(bestLocation(candidate))} | ${md(invalidationText(candidate))} | ${md(targetText(candidate))} | ${md(contextText(candidate))} | ${md(rating(candidate))} |`).join("\n");
  const cards = sortedCandidates(candidates).map(({ candidate, rank }) => {
    const values = [
      ["READ", readText(candidate)], ["PLAN", planText(candidate)], ["TRIGGER", triggerText(candidate)],
      ["INVALIDATION", invalidationText(candidate)], ["TARGETS", targetText(candidate)], ["RISK", riskText(candidate)],
      ["NO-TRADE", noTradeText(candidate)], ["BEST LOCATION", bestLocation(candidate)],
    ];
    return `### A+ #${rank} — ${md(symbol(candidate))} — ${direction(candidate)}\n\n**${md(setup(candidate))}** · ${md(rating(candidate))}\n\n${values.map(([label, value]) => `- **${label}:** ${md(value)}`).join("\n")}`;
  }).join("\n\n");
  return `${header}${rows ? `\n${rows}` : ""}\n\n${cards}`;
}

function morningPriorityMarkdown(candidates) {
  return sortedCandidates(candidates).map(({ candidate, rank }) => `${rank}. **${md(symbol(candidate))} ${direction(candidate)}** — ${md(triggerText(candidate))} — ${md(readText(candidate))}`).join("\n");
}

function sectionHtml(section, candidates) {
  let body;
  if (section.id === "a-plus-trades") body = `<p class="muted">Candidate proposals only. Every entry remains subject to the defined trigger, structural invalidation, risk sizing, PRETRADE review, and manual ARM authorization.</p>${candidateSummaryHtml(candidates)}${candidateCardsHtml(candidates)}`;
  else if (section.id === "morning-priority") body = morningPriorityHtml(candidates);
  else body = section.blocks.map(renderBlockHtml).join("");
  return `<section id="${html(section.id)}"><h2>${section.number}. ${html(section.title)}</h2>${body}</section>`;
}

function sectionMarkdown(section, candidates) {
  let body;
  if (section.id === "a-plus-trades") body = candidateSummaryMarkdown(candidates);
  else if (section.id === "morning-priority") body = morningPriorityMarkdown(candidates);
  else body = section.blocks.map(renderBlockMarkdown).filter(Boolean).join("\n\n");
  return `## ${section.number}. ${md(section.title)}\n\n${body}`;
}

function sourceFooterHtml(sources) {
  if (!sources.length) return "";
  return `<div class="footer"><b>Sources / freshness:</b> ${sources.map((source) => {
    const label = html(source.label);
    const linked = source.url ? `<a class="source" href="${html(source.url)}" rel="noreferrer">${label}</a>` : label;
    return `${linked}${source.note ? ` — ${html(source.note)}` : ""}`;
  }).join(" · ")}</div>`;
}

function sourceFooterMarkdown(sources) {
  if (!sources.length) return "";
  return `**Sources / freshness:** ${sources.map((source) => `${md(source.label)}${source.note ? ` — ${md(source.note)}` : ""}`).join(" · ")}`;
}

function reportHtml(content, candidates) {
  const toc = content.sections.map((section) => `<a href="#${html(section.id)}">${section.number}. ${html(section.title)}</a>`).join("");
  const badges = content.hero.badges.map((badge) => `<span class="badge ${html(badge.tone)}">${html(badge.text)}</span>`).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(content.hero.title)}</title><style>${REPORT_CSS}</style></head><body><nav class="toc" aria-label="Table of contents"><h2>Start of Day</h2><div class="toc-grid">${toc}</div></nav><main class="wrap"><header class="hero"><div class="kicker">${html(content.hero.kicker)}</div><h1>${html(content.hero.title)}</h1><div class="sub">${nl(content.hero.snapshot)}</div>${badges ? `<div class="badges">${badges}</div>` : ""}</header>${content.sections.map((section) => sectionHtml(section, candidates)).join("")}${sourceFooterHtml(content.sources)}</main></body></html>`;
}

function reportMarkdown(content, candidates) {
  const badges = content.hero.badges.map((badge) => `**${md(badge.text)}**`).join(" · ");
  return `# ${md(content.hero.title)}\n\n${md(content.hero.snapshot)}${badges ? `\n\n${badges}` : ""}\n\n${content.sections.map((section) => sectionMarkdown(section, candidates)).join("\n\n")}\n\n${sourceFooterMarkdown(content.sources)}`.trim() + "\n";
}

function dashboardCandidateCard(candidate, rank) {
  const dir = direction(candidate);
  const rows = [
    ["Thesis", readText(candidate)], ["Best location", bestLocation(candidate)], ["Trigger", triggerText(candidate)],
    ["Invalidation", invalidationText(candidate)], ["Targets", targetText(candidate)], ["No Trade", noTradeText(candidate)],
    ["Management", riskText(candidate)],
  ];
  return `<article class="cand"><div class="candhead"><div><div class="setup">Priority #${rank}</div><div class="sym">${html(symbol(candidate))}</div><div class="setup">${html(setup(candidate))}</div></div><div><span class="dir ${dir.toLowerCase()}">${dir}</span><div class="stars" style="margin-top:6px">${html(rating(candidate))}</div></div></div><div class="candbody">${rows.map(([label, value]) => `<div class="r"><div class="lab">${html(label)}</div><div class="val">${nl(value)}</div></div>`).join("")}</div></article>`;
}

function dashboardSectionCard(section) {
  return `<div class="card">${section.blocks.map(renderBlockHtml).join("") || `<span class="muted">No additional dashboard detail.</span>`}</div>`;
}

function dashboardHtml(content, candidates) {
  const byId = new Map(content.sections.map((section) => [section.id, section]));
  const longs = sortedCandidates(candidates).filter(({ candidate }) => direction(candidate) === "LONG");
  const shorts = sortedCandidates(candidates).filter(({ candidate }) => direction(candidate) === "SHORT");
  const badges = content.hero.badges.map((badge) => `<span class="pill ${html(badge.tone)}">${html(badge.text)}</span>`).join("");
  const nav = [
    ["d1", "Executive Summary"], ["d4", "Scheduled / Macro Risk"], ["d6", "Futures Snapshot"],
    ["d8", "Watchlist Overview"], ["longs", "Long Candidates"], ["shorts", "Short Candidates"],
    ["zones", "No-Trade Zones"], ["d15", "A+ Trades"], ["d16", "Morning Priority"],
    ["d17", "Earnings / Risk Events"], ["d18", "Risk Management"], ["d19", "Opening Game Plan / Process Goals"],
    ["framework", "Execution Development Framework"],
  ].map(([id, label]) => `<a href="#${id}">${label}</a>`).join("");

  const watchlistSections = ["market-regime-breadth", "semiconductors-primary-sector", "mega-cap-tech", "momentum-special-situations", "crude-oil-mcl", "key-levels", "validation-no-trade-zones"].map((id) => byId.get(id)).filter(Boolean);
  const priorityRows = morningPriorityHtml(candidates);

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOD Dashboard — ${html(content.hero.title)}</title><style>${DASHBOARD_CSS}</style></head><body><aside class="sidebar"><div class="brand">ExecutionOS SOD</div><div class="subbrand">${html(content.hero.title)}</div>${nav}<div class="sidequote"><b>Execution focus</b><br><br>Green is not an exit. Red is not invalidation. Structure is invalidation.</div></aside><main class="main"><header class="hero"><div class="kicker">Start of Day Dashboard</div><h1>${html(content.hero.title)}</h1><p>${nl(content.hero.snapshot)} Candidate cards remain conditional and MANUAL authorization only.</p>${badges ? `<div class="pills">${badges}</div>` : ""}</header>
<section id="d1" class="section"><h2>Executive Summary</h2>${dashboardSectionCard(byId.get("executive-summary"))}</section>
<section id="d4" class="section"><h2>Scheduled / Macro Risk</h2><div class="grid2">${["macro-overnight-context", "scheduled-risk", "rates-volatility-commodities"].map((id) => dashboardSectionCard(byId.get(id))).join("")}</div></section>
<section id="d6" class="section"><h2>Futures Snapshot</h2><div class="grid2">${dashboardSectionCard(byId.get("mes"))}${dashboardSectionCard(byId.get("mnq"))}</div></section>
<section id="d8" class="section"><h2>Watchlist Overview</h2><div class="grid2">${watchlistSections.map(dashboardSectionCard).join("")}</div></section>
<section id="longs" class="section"><h2>Long Candidates</h2><div class="cands">${longs.length ? longs.map(({ candidate, rank }) => dashboardCandidateCard(candidate, rank)).join("") : `<div class="card muted">No A+ long candidates.</div>`}</div></section>
<section id="shorts" class="section"><h2>Short Candidates</h2><div class="cands">${shorts.length ? shorts.map(({ candidate, rank }) => dashboardCandidateCard(candidate, rank)).join("") : `<div class="card muted">No A+ short candidates.</div>`}</div></section>
<section id="zones" class="section"><h2>No-Trade Zones</h2>${dashboardSectionCard(byId.get("validation-no-trade-zones"))}</section>
<section id="d15" class="section"><h2>15. A+ Trades</h2>${candidateSummaryHtml(candidates)}<div class="cands">${sortedCandidates(candidates).map(({ candidate, rank }) => dashboardCandidateCard(candidate, rank)).join("")}</div></section>
<section id="d16" class="section"><h2>16. Morning Priority</h2><div class="card">${priorityRows}</div></section>
<section id="d17" class="section"><h2>17. Earnings / Risk Events</h2>${dashboardSectionCard(byId.get("earnings-risk-events"))}</section>
<section id="d18" class="section"><h2>18. Risk Management</h2>${dashboardSectionCard(byId.get("risk-management"))}</section>
<section id="d19" class="section"><h2>19. Opening Game Plan / Process Goals</h2>${dashboardSectionCard(byId.get("opening-game-plan"))}</section>
<section id="framework" class="section"><h2>Execution Development Framework</h2><div class="framework">${["READ","PLAN","TRIGGER","RISK","HOLD","UPDATE","EXIT"].map((step) => `<div class="step">${step}</div>`).join("")}</div></section>${sourceFooterHtml(content.sources)}</main></body></html>`;
}

export function renderSodArtifacts({ content: inputContent, candidateProposals = [] } = {}) {
  const content = normalizeSodArtifactContent(inputContent);
  const candidates = Array.isArray(candidateProposals) ? structuredClone(candidateProposals) : [];
  return Object.freeze({
    rendererVersion: SOD_ARTIFACT_RENDERER_VERSION,
    report: Object.freeze({
      markdown: reportMarkdown(content, candidates),
      html: reportHtml(content, candidates),
    }),
    dashboard: Object.freeze({
      html: dashboardHtml(content, candidates),
    }),
  });
}

export { REPORT_CSS, DASHBOARD_CSS, SOD_REPORT_SECTIONS };
