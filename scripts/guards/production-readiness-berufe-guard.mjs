#!/usr/bin/env node
/**
 * Production Readiness Guard — /berufe (Discovery / Beruf-Hub)
 * -----------------------------------------------------------
 * SSOT-Closing für Reality-Finding `P2-workflow_no_feedback-1pafze`
 * (Owner: discovery · Surface: Beruf-Hub · Journey A · Route /berufe)
 *
 * Validiert die LIVE-Auslieferung von /berufe ohne JS-Hydration:
 *   1. HTTP 200
 *   2. Such-/Filter-Markup im initialen HTML vorhanden
 *      (input[type="search"] oder placeholder mit "uchen"/"Beruf")
 *   3. ≥ 20 anklickbare Beruf-Links im initialen HTML
 *      (a href*="/berufe/<slug>")
 *
 * Schließt damit dauerhaft die Klasse von Triage-Regressionen, in der
 * der Pre-Customer-Reality-Suite zwischen "Search visible / ≥3 links" und
 * "leerer SPA-Shell" oszilliert (CORS-Score-Drift).
 *
 * Usage:
 *   node scripts/guards/production-readiness-berufe-guard.mjs \
 *        [--host=https://berufos.com] [--min-links=20] [--require-search=true]
 *
 * Exit:
 *   0 = READY (alle Checks grün)
 *   1 = NOT_READY (Block) — verbose Detail in stdout
 *   2 = Bedienfehler / Netz-Fehler
 */
import process from "node:process";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const HOST = (args.host || process.env.READINESS_HOST || "https://berufos.com").replace(/\/$/, "");
const MIN_LINKS = Number(args["min-links"] || 20);
const REQUIRE_SEARCH = String(args["require-search"] ?? "true") !== "false";
const URL = `${HOST}/berufe`;
const FINGERPRINT = "P2-workflow_no_feedback-1pafze";

function log(level, msg, extra = {}) {
  const line = `[${level}] ${msg}` + (Object.keys(extra).length ? " " + JSON.stringify(extra) : "");
  if (level === "ERROR" || level === "BLOCK") console.error(line);
  else console.log(line);
}

async function main() {
  log("INFO", `Production-Readiness Guard for ${URL}`, {
    min_links: MIN_LINKS,
    require_search: REQUIRE_SEARCH,
    fingerprint: FINGERPRINT,
  });

  let res;
  try {
    res = await fetch(URL, {
      redirect: "follow",
      headers: { "User-Agent": "BerufOS-ReadinessGuard/1.0 (+https://berufos.com)" },
    });
  } catch (e) {
    log("ERROR", `Network error: ${e.message}`);
    return 2;
  }

  const status = res.status;
  const html = await res.text();
  const failures = [];

  if (status !== 200) {
    failures.push({
      check: "http_status",
      actual: status,
      expected: 200,
      detail: `GET ${URL} returned HTTP ${status}.`,
      fix: "Route reparieren / Vercel-Routing prüfen (vercel.json + per-route prerender).",
    });
  }

  // Per-Route HTML statt SPA-Shell
  const isSpaShell =
    /<div id=["']root["']\s*><\/div>/i.test(html) &&
    !/berufe\/[a-z0-9-]+/i.test(html);
  if (isSpaShell) {
    failures.push({
      check: "spa_shell",
      detail: "Initiales HTML ist eine leere SPA-Shell ohne Beruf-Inhalte — Crawler/Visitor sehen nichts ohne JS.",
      fix: "Vercel-Prerender für /berufe sicherstellen (scripts/seo/prerender.mjs · load-dynamic-routes.mjs).",
    });
  }

  // Such-/Filter-Markup
  if (REQUIRE_SEARCH) {
    const hasSearch =
      /<input[^>]+type=["']search["']/i.test(html) ||
      /<input[^>]+placeholder=["'][^"']*uchen/i.test(html) ||
      /<input[^>]+placeholder=["'][^"']*Beruf/i.test(html);
    if (!hasSearch) {
      failures.push({
        check: "search_input",
        detail: "Kein Such-/Filter-Input im initialen HTML gefunden.",
        fix: "Such-/Filterleiste im SSR-Pfad von /berufe rendern (BerufePage Hero).",
      });
    }
  }

  // Beruf-Links zählen (de-dupliziert)
  const linkRe = /href=["']([^"']*\/berufe\/[a-z0-9][a-z0-9-]+)["']/gi;
  const slugs = new Set();
  for (const m of html.matchAll(linkRe)) slugs.add(m[1]);
  const linkCount = slugs.size;

  if (linkCount < MIN_LINKS) {
    failures.push({
      check: "min_beruf_links",
      actual: linkCount,
      expected: MIN_LINKS,
      detail: `Nur ${linkCount} Beruf-Links im initialen HTML — Discovery-Friction (Reality-Fingerprint ${FINGERPRINT}).`,
      fix: "FALLBACK_CATALOG im SSR-Pfad sicherstellen (publishedBerufeFallback.json) und Prerender verifizieren.",
    });
  }

  if (failures.length === 0) {
    log("READY", "All discovery readiness checks passed", {
      url: URL,
      links: linkCount,
      bytes: html.length,
    });
    return 0;
  }

  log("BLOCK", `Production-Readiness FAILED (${failures.length} check(s))`, { url: URL });
  for (const f of failures) {
    console.error(`  ❌ ${f.check}: ${f.detail}`);
    if (f.fix) console.error(`     → fix: ${f.fix}`);
  }
  console.error(
    `\nClosing rule: fingerprint ${FINGERPRINT} bleibt offen bis dieser Guard im nächsten Daily-Run grün ist.`,
  );
  return 1;
}

main().then((code) => process.exit(code));
