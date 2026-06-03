#!/usr/bin/env node
/**
 * Strict-Event package_id Guard
 * --------------------------------------------------------------
 * Verhindert, dass strict funnel events ohne package_id emittiert werden.
 *
 * Strict events (Server validiert + 22023 / 400):
 *   - quiz_started
 *   - quiz_completed
 *   - lead_capture_submitted
 *   - checkout_complete
 *
 * Erlaubte Identifier-Formen:
 *   - emitFunnelEvent("QUIZ_STARTED", { ... package_id: ... })
 *   - emitFunnelEvent("QUIZ_COMPLETED", { ... package_id: ... })
 *   - emitFunnelEvent("LEAD_CAPTURE_SUBMITTED", { ... package_id: ... })
 *   - trackFunnel("checkout_complete", { ... package_id: ... })
 *   - track_conversion_event_v2(... p_event_type: "checkout_complete" ... p_package_id: ...)
 *   - server-side conversion_events insert mit event_type 'checkout_complete'
 *     (nur erlaubt, wenn metadata.package_id im selben Block referenziert wird)
 *
 * Naive aber robuste Heuristik: Pro Match das +/- 25 Zeilen Fenster auf
 * `package_id` prüfen. Server-Webhook Helper emitCheckoutCompleteEvent
 * gilt als compliant (resolved package_id intern).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "supabase/functions"];
const SKIP = new Set([
  "node_modules", ".git", "dist", "build",
  "__tests__", "test", "tests", "scripts", "e2e", ".lovable",
]);
const EXTS = [".ts", ".tsx", ".mjs", ".js"];

const STRICT_TOKENS = [
  "QUIZ_STARTED", "QUIZ_COMPLETED", "LEAD_CAPTURE_SUBMITTED",
  '"quiz_started"', "'quiz_started'",
  '"quiz_completed"', "'quiz_completed'",
  '"lead_capture_submitted"', "'lead_capture_submitted'",
  '"checkout_complete"', "'checkout_complete'",
];

// Helper-Calls die intern package_id auflösen → exempt
const COMPLIANT_HELPERS = [
  "emitCheckoutCompleteEvent(",
];

function* walk(dir) {
  for (const ent of readdirSync(dir)) {
    if (SKIP.has(ent)) continue;
    const p = join(dir, ent);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p);
    else if (EXTS.some((e) => p.endsWith(e))) yield p;
  }
}

function findStrictBlocks(src) {
  const lines = src.split("\n");
  const hits = [];
  lines.forEach((ln, i) => {
    if (!STRICT_TOKENS.some((t) => ln.includes(t))) return;
    // Skip Kommentare/Type-Definitions/Allow-Listen
    const trim = ln.trim();
    if (trim.startsWith("//") || trim.startsWith("*") || trim.startsWith("//")) return;
    if (trim.startsWith("|") && trim.includes('"')) return; // type union member
    if (trim.startsWith('"') && trim.endsWith('",')) return; // string-array entry
    if (trim.startsWith("'") && trim.endsWith("',")) return;
    // Type-Member ohne Funktionsaufruf (kein "(" davor in 5 lines)
    const win = lines.slice(Math.max(0, i - 5), i + 30).join("\n");
    if (!/[\(\{]/.test(win)) return;
    hits.push({ line: i + 1, snippet: ln.trim(), window: win });
  });
  return hits;
}

function isCompliant(file, hit) {
  const w = hit.window;
  if (COMPLIANT_HELPERS.some((h) => w.includes(h))) return true;
  // Akzeptiere package_id, packageId oder p_package_id im Fenster
  if (/\bp(_|ackage)_?[Ii]d\b/.test(w)) return true;
  // Audit-/Smoke-Events sind exempt (Guard-View ignoriert sie ohnehin).
  if (/smoke_test\s*:\s*true/.test(w) || /simulation\s*:\s*true/.test(w)) return true;
  return false;
}

const violations = [];
let scanned = 0;

for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  try { statSync(abs); } catch { continue; }
  for (const f of walk(abs)) {
    // ignore generated supabase types
    if (f.endsWith("/integrations/supabase/types.ts")) continue;
    // Ignore guard-script selbst und integrity-card UI
    if (f.endsWith("strict-event-package-id-guard.mjs")) continue;
    if (f.endsWith("FunnelIntegrityCard.tsx")) continue;
    if (f.endsWith("SalesFunnelCard.tsx")) continue;
    // CSV-Export liest aggregierte Stage-Counts (keine Emit-Stelle)
    if (f.endsWith("PruefungsreifeFunnelCard.tsx")) continue;
    // Lokaler emit()-Wrapper injiziert packageId aus resolver.packageId (außerhalb 30-Zeilen-Window)
    if (f.endsWith("PruefungsreifeCheckPage.tsx")) continue;
    // String-Mapping (event-name → category), keine Emit-Stelle
    if (f.endsWith("/lib/foerdermittel/conversion.ts")) continue;
    // ignore tracking SSOT-Definitionen (dort sind die Strings legitim als type)
    if (f.endsWith("/lib/conversionTracking.ts")) continue;
    if (f.endsWith("/lib/funnelEvents.ts")) continue;
    if (f.endsWith("/hooks/useTrackGrowthEvent.ts")) continue;
    // Track-funnel-event edge fn validates server-side (allow-list itself)
    if (f.endsWith("/track-funnel-event/index.ts")) continue;

    scanned++;
    const src = readFileSync(f, "utf8");
    if (!STRICT_TOKENS.some((t) => src.includes(t))) continue;
    const hits = findStrictBlocks(src);
    for (const hit of hits) {
      if (!isCompliant(f, hit)) {
        violations.push({ file: relative(ROOT, f), ...hit });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`✅ strict-event-package-id-guard: ${scanned} files scanned — no violations`);
  process.exit(0);
}

console.error(`❌ strict-event-package-id-guard: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.snippet}`);
  console.error(`    → strict event without package_id in surrounding ~30 lines`);
  console.error("");
}
console.error("Fix: pass package_id (or use emitCheckoutCompleteEvent helper).");
process.exit(1);
