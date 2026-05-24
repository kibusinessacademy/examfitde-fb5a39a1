#!/usr/bin/env node
/**
 * route-html-verify.mjs
 *
 * Verifiziert pro Route, dass das Live-HTML enthält:
 *   - <title>...</title> (nicht-leer)
 *   - <link rel="canonical" href="...">
 *   - mindestens ein <script type="application/ld+json">
 *
 * Usage:
 *   node scripts/seo/route-html-verify.mjs --host=https://examfit.de \
 *        --routes=/,/berufe,/blog
 *
 * Default routes when none provided: a curated set of high-priority routes.
 *
 * Exit code 0 → GO, 1 → BLOCKED.
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || true];
  }),
);

const HOST = String(args.host || process.env.HOST || "https://examfit.de").replace(/\/$/, "");
const DEFAULT_ROUTES = [
  "/",
  "/berufe",
  "/berufe/industriekaufmann-frau",
  "/pruefungstraining-azubis",
  "/blog",
  "/aevo-pruefungsvorbereitung",
  "/fiae-pruefungsvorbereitung",
];
const ROUTES = args.routes
  ? String(args.routes).split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_ROUTES;

function check(html, status) {
  const reasons = [];
  if (status >= 400) reasons.push(`http_${status}`);
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  if (!title) reasons.push("missing_title");
  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1] ??
    null;
  if (!canonical) reasons.push("missing_canonical");
  const jsonLd = (html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? []).length;
  if (jsonLd === 0) reasons.push("missing_jsonld");
  if (html.length < 1500) reasons.push("html_too_small");
  if (/<div id=["']root["']>\s*<\/div>/i.test(html) && jsonLd === 0) reasons.push("spa_shell_only");
  return { ok: reasons.length === 0, title, canonical, jsonLd, reasons };
}

const results = [];
for (const route of ROUTES) {
  const url = HOST + (route.startsWith("/") ? route : "/" + route);
  let status = 0, html = "", err = null;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "ExamFit-Cutover-Smoke/1.0", Accept: "text/html" },
      redirect: "follow",
    });
    status = r.status;
    html = await r.text();
  } catch (e) {
    err = String(e?.message ?? e);
  }
  const c = err ? { ok: false, reasons: [`fetch_error:${err}`], title: "", canonical: null, jsonLd: 0 } : check(html, status);
  results.push({ route, url, status, ...c });
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const verdict = failed === 0 ? "GO" : "BLOCKED";

console.log(`\nHost: ${HOST}`);
console.log(`Routes: ${results.length} · passed=${passed} · failed=${failed}`);
console.log("─".repeat(72));
for (const r of results) {
  const tag = r.ok ? "✅" : "❌";
  console.log(`${tag} ${r.route} [${r.status}] jsonLd=${r.jsonLd} ${r.ok ? "" : "→ " + r.reasons.join(",")}`);
  if (!r.ok) {
    console.log(`   title="${(r.title || "").slice(0, 80)}"`);
    console.log(`   canonical=${r.canonical ?? "—"}`);
  }
}
console.log("─".repeat(72));
console.log(`Verdict: ${verdict}`);

process.exit(verdict === "GO" ? 0 : 1);
