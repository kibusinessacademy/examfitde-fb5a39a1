#!/usr/bin/env node
/**
 * wait-for-dns-then-check.mjs
 *
 * Pollt DNS (via Cloudflare + Google DoH) für berufos.com + examfit.de,
 * bis BEIDE Apex-Records auf die Vercel-IP `216.198.79.1` zeigen.
 * Danach läuft automatisch `vercel-domain-mapping-check.mjs` + `verify-authority-live.mjs`.
 *
 * Usage:
 *   node scripts/seo/wait-for-dns-then-check.mjs [--target=216.198.79.1] [--interval=30] [--max-minutes=60]
 *
 * Exit:
 *   0 = DNS gesetzt + Mapping-Check grün
 *   1 = DNS gesetzt aber Mapping-Check rot
 *   2 = Timeout
 */
import { spawnSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || true];
  }),
);
const TARGET = String(args.target || "216.198.79.1");
const INTERVAL_S = Number(args.interval || 30);
const MAX_MIN = Number(args["max-minutes"] || 60);
const HOSTS = ["berufos.com", "examfit.de"];
const RESOLVERS = [
  { name: "cloudflare", url: "https://cloudflare-dns.com/dns-query" },
  { name: "google",     url: "https://dns.google/resolve" },
];

async function resolveA(host, resolver) {
  const u = `${resolver.url}?name=${host}&type=A`;
  const r = await fetch(u, { headers: { accept: "application/dns-json" } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
}

async function checkOnce() {
  const status = {};
  for (const host of HOSTS) {
    const ips = new Set();
    for (const res of RESOLVERS) {
      try {
        const a = await resolveA(host, res);
        a.forEach((ip) => ips.add(ip));
      } catch { /* ignore */ }
    }
    status[host] = {
      ips: [...ips],
      ok: ips.has(TARGET),
    };
  }
  return status;
}

const deadline = Date.now() + MAX_MIN * 60_000;
let attempt = 0;
console.log(`▶ Polling DNS for ${HOSTS.join(", ")} → ${TARGET}`);
console.log(`  interval=${INTERVAL_S}s  max=${MAX_MIN}min\n`);

while (Date.now() < deadline) {
  attempt++;
  const status = await checkOnce();
  const stamp = new Date().toISOString().slice(11, 19);
  const line = HOSTS.map((h) => {
    const s = status[h];
    return `${h}=${s.ok ? "✅" : "⏳"}[${s.ips.join(",") || "—"}]`;
  }).join("  ");
  console.log(`[${stamp}] attempt ${attempt}  ${line}`);

  if (HOSTS.every((h) => status[h].ok)) {
    console.log(`\n✓ DNS propagated. Running mapping check…\n`);
    const map = spawnSync("node", ["scripts/seo/vercel-domain-mapping-check.mjs"], { stdio: "inherit" });
    console.log(`\n✓ Running live authority verify…\n`);
    const live = spawnSync("node", ["scripts/seo/verify-authority-live.mjs", "--retries=3", "--delay=10"], { stdio: "inherit" });
    const exit = (map.status || 0) | (live.status || 0);
    process.exit(exit === 0 ? 0 : 1);
  }
  await new Promise((res) => setTimeout(res, INTERVAL_S * 1000));
}

console.error(`\n❌ Timeout after ${MAX_MIN}min — DNS did not propagate to ${TARGET}.`);
console.error(`   Check name.com / Cloudflare zone for both ${HOSTS.join(" & ")}.`);
process.exit(2);
