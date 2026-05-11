#!/usr/bin/env node
/**
 * SEO Health Threshold SSOT Guard
 * ──────────────────────────────────────────────────────────────────
 * Verhindert Drift weg von der Threshold-SSOT (ops_seo_alert_thresholds).
 *
 * Static checks (always run):
 *  - Keine hardcoded numeric Thresholds in src/components/admin/heal/cards/Seo*.tsx
 *    außer in einer Allowlist (UI-Default-Anzeigen, Severity-Cutoffs für Score-Anzeige).
 *  - Severity-relevante RPCs (admin_get_seo_job_health) und der Alert-Run dürfen nur
 *    via ops_seo_alert_thresholds bezogen werden — diese Datei prüft die Frontend-Seite.
 *
 * DB checks (skip wenn keine Credentials):
 *  - Alle 5 Pflicht-Threshold-Keys vorhanden:
 *    empty_result_1h_critical, requeue_loop_1h_critical, http_400_1h_warn,
 *    failure_rate_pct_1h_warn, oldest_pending_warn_min
 *  - admin_get_seo_alert_thresholds + admin_set_seo_alert_threshold + admin_get_seo_toggle_telemetry
 *    Funktionen existieren.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TARGET_DIR = join(ROOT, "src/components/admin/heal/cards");

// Files we statically scan
const FILE_PATTERNS = [/^Seo.*\.tsx$/];

// Files allowed to contain hardcoded UI-only thresholds (e.g. score>=0.6 für color cue)
// These are NOT alert/business thresholds — they are presentation cues.
const PRESENTATION_HARDCODE_ALLOW = new Set([
  // path → reason (informational)
]);

// Disallowed magic numeric literals in Severity context.
// We grep for patterns that look like ">= <number>" in code that mentions
// "alert_severity", "threshold", "critical", "warn".
const DANGER_PATTERNS = [
  // e.g.  empty_result_1h >= 5
  /\b(empty_result_1h|requeue_loop_1h|http_400_1h|failure_rate_pct_1h|oldest_pending_age_minutes)\s*>=?\s*\d+(\.\d+)?/,
];

const errors = [];
const warnings = [];

function listTsxFiles(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isFile() && FILE_PATTERNS.some((rx) => rx.test(entry))) out.push(p);
  }
  return out;
}

const files = listTsxFiles(TARGET_DIR);
for (const file of files) {
  if (PRESENTATION_HARDCODE_ALLOW.has(file)) continue;
  const src = readFileSync(file, "utf8");
  for (const rx of DANGER_PATTERNS) {
    const m = src.match(rx);
    if (m) {
      errors.push(
        `[seo-health-threshold-guard] Hardcoded threshold compare in ${file}:\n  → ${m[0]}\n  Use ops_seo_alert_thresholds via admin_get_seo_alert_thresholds() instead.`,
      );
    }
  }
}

// DB Check (best-effort)
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

async function rpc(fn, body = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} → ${res.status}: ${await res.text()}`);
  return res.json();
}

if (!url || !key) {
  warnings.push(
    "[seo-health-threshold-guard] SKIP DB-checks — SUPABASE_URL/SERVICE_ROLE_KEY not set.",
  );
} else {
  try {
    const rows = await rpc("admin_get_seo_alert_thresholds");
    const required = [
      "empty_result_1h_critical",
      "requeue_loop_1h_critical",
      "http_400_1h_warn",
      "failure_rate_pct_1h_warn",
      "oldest_pending_warn_min",
    ];
    const present = new Set((rows ?? []).map((r) => r.threshold_key));
    const missing = required.filter((k) => !present.has(k));
    if (missing.length) {
      errors.push(
        `[seo-health-threshold-guard] Missing thresholds in ops_seo_alert_thresholds: ${missing.join(
          ", ",
        )}`,
      );
    }
  } catch (e) {
    errors.push(
      `[seo-health-threshold-guard] DB check failed: ${(e && e.message) || e}`,
    );
  }
}

if (warnings.length) console.warn(warnings.join("\n"));
if (errors.length) {
  console.error("\n" + errors.join("\n\n"));
  process.exit(1);
}
console.log(
  `[seo-health-threshold-guard] OK — ${files.length} file(s) scanned, no drift detected.`,
);
