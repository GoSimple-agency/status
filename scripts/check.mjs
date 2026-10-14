// Checks each public endpoint, records the result, and regenerates the status page.
// No credentials: it only GETs public URLs and commits the history with GITHUB_TOKEN.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const endpoints = JSON.parse(readFileSync(join(root, "endpoints.json"), "utf8"));
const historyPath = join(root, "history.json");
const MAX = 240; // keep the last ~240 samples per endpoint

let history = {};
try {
  history = JSON.parse(readFileSync(historyPath, "utf8"));
} catch {
  // first run
}

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "GoSimple-Status/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, code: res.status, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, code: 0, ms: Date.now() - started, error: String(err?.name || err) };
  }
}

const now = new Date().toISOString();
const current = [];

for (const ep of endpoints) {
  const r = await probe(ep.url);
  const sample = { t: now, ok: r.ok, code: r.code, ms: r.ms };
  history[ep.slug] = [...(history[ep.slug] ?? []), sample].slice(-MAX);
  current.push({ ...ep, ...r });
}

writeFileSync(historyPath, JSON.stringify(history, null, 0) + "\n");

const uptime = (slug) => {
  const h = history[slug] ?? [];
  if (h.length === 0) return "—";
  return ((h.filter((s) => s.ok).length / h.length) * 100).toFixed(2) + "%";
};
const allUp = current.every((c) => c.ok);

// README with a status table
const rows = current
  .map((c) => `| ${c.ok ? "🟢" : "🔴"} ${c.name} | ${c.ok ? "Operational" : "Down"} | ${c.code || "—"} | ${c.ms} ms | ${uptime(c.slug)} |`)
  .join("\n");
writeFileSync(
  join(root, "README.md"),
  `# Tezga status\n\n${allUp ? "🟢 **All systems operational**" : "🔴 **Some systems are down**"}\n\n` +
    `Automated checks of the public Tezga endpoints. Updated every 30 minutes.\n\n` +
    `| Endpoint | Status | Code | Response | Uptime |\n| --- | --- | --- | --- | --- |\n${rows}\n\n` +
    `Last checked: ${now}\n\nLive page: https://gosimple-agency.github.io/status/\n`,
);

// Static page for GitHub Pages
const cards = current
  .map(
    (c) =>
      `<div class="card ${c.ok ? "up" : "down"}"><span class="dot"></span>` +
      `<div><b>${c.name}</b><small>${c.ok ? "Operational" : "Down"} · HTTP ${c.code || "—"} · ${c.ms} ms · ${uptime(c.slug)} uptime</small></div></div>`,
  )
  .join("\n");
writeFileSync(
  join(root, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Tezga status</title>
<style>:root{--bg:#00222b;--card:#002d39;--ink:#eaf4f5;--muted:#8fa8ae;--up:#4bff2a;--down:#ff5a5a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:680px;margin:0 auto;padding:48px 20px}h1{font-size:26px;margin:0 0 6px}
.state{font-weight:700;margin:0 0 24px;color:${allUp ? "var(--up)" : "var(--down)"}}
.card{display:flex;gap:14px;align-items:center;background:var(--card);border-radius:12px;padding:16px 18px;margin:10px 0}
.card small{display:block;color:var(--muted)}.dot{width:12px;height:12px;border-radius:50%;flex:0 0 auto}
.up .dot{background:var(--up)}.down .dot{background:var(--down)}
.foot{color:var(--muted);font-size:13px;margin-top:24px}a{color:#8de5e1}</style></head>
<body><div class="wrap"><h1>Tezga status</h1>
<p class="state">${allUp ? "All systems operational" : "Some systems are down"}</p>
${cards}
<p class="foot">Public endpoints, checked every 30 minutes. Last check ${now}.<br>
<a href="https://tezgafiskal.com">tezgafiskal.com</a> · <a href="https://github.com/GoSimple-agency/status">source</a></p>
</div></body></html>\n`,
);

console.log(allUp ? "all up" : "some down", current.map((c) => `${c.slug}:${c.code}`).join(" "));
if (!allUp) process.exitCode = 0; // never fail the workflow on a downstream outage
