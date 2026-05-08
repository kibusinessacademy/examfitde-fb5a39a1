#!/usr/bin/env node
/**
 * RLS-Audit (warn-only, ratchet-ready)
 * ──────────────────────────────────────
 * Phase 1: Snapshot der aktuellen RLS-Politik (Tabellen + Policies + WITH CHECK)
 *          + Diff gegen Baseline. Findings nur als Warnung — kein hartes Fail,
 *          analog zum frühen Edge-Auth-Contract-Guard.
 *
 * Phase 2 (geplant, Schalter unten): RATCHET=1 → fail-fast bei jedem neuen
 *          permissiven Treffer. Erst aktivieren, wenn 7 Tage keine False-Positives.
 *
 * Snapshot-Quelle: scripts/security/rls-audit-baseline.json
 * Live-Daten:      pg_policies + pg_tables (gelesen via psql, falls verfügbar)
 *                  Fallback: docs/security/rls-snapshot.json (vom letzten Lauf)
 *
 * CI-Output:
 *   - exit 0 immer (warn-only)
 *   - GitHub-Annotations via ::warning::
 *   - Markdown-Report nach docs/security/rls-audit-report.md
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, "scripts/security/rls-audit-baseline.json");
const SNAPSHOT_PATH = path.join(ROOT, "docs/security/rls-snapshot.json");
const REPORT_PATH = path.join(ROOT, "docs/security/rls-audit-report.md");

const RATCHET = process.env.RLS_AUDIT_RATCHET === "1";

const QUERY = `
SELECT json_agg(row_to_json(t)) FROM (
  SELECT
    schemaname,
    tablename,
    policyname,
    cmd,
    permissive,
    roles,
    qual,
    with_check
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, policyname
) t;
`;

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function fetchLivePolicies() {
  if (!process.env.PGHOST) {
    console.warn("[rls-audit] PGHOST not set — using last snapshot as live.");
    return loadJson(SNAPSHOT_PATH) ?? [];
  }
  try {
    const raw = execSync(`psql -At -c "${QUERY.replace(/\n/g, " ")}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("[rls-audit] psql failed, using last snapshot:", err.message);
    return loadJson(SNAPSHOT_PATH) ?? [];
  }
}

const RISKY_PATTERNS = [
  { id: "true_qual", regex: /^\s*true\s*$/i, severity: "warn", reason: "Policy USING (true) — alle authenticated/anon können lesen/schreiben" },
  { id: "true_check", regex: /^\s*true\s*$/i, severity: "warn", reason: "WITH CHECK (true) — keine Insert/Update-Restriktion" },
  { id: "auth_role_only", regex: /role\s*=\s*'authenticated'/i, severity: "info", reason: "Policy nur über Rolle gefiltert — kein Owner-Scope" },
];

function classify(pol) {
  const findings = [];
  if (pol.qual && RISKY_PATTERNS[0].regex.test(pol.qual)) {
    findings.push({ id: RISKY_PATTERNS[0].id, severity: RISKY_PATTERNS[0].severity, reason: RISKY_PATTERNS[0].reason });
  }
  if (pol.with_check && RISKY_PATTERNS[1].regex.test(pol.with_check)) {
    findings.push({ id: RISKY_PATTERNS[1].id, severity: RISKY_PATTERNS[1].severity, reason: RISKY_PATTERNS[1].reason });
  }
  return findings;
}

function diffPolicies(baseline, live) {
  const key = (p) => `${p.schemaname}.${p.tablename}::${p.policyname}::${p.cmd}`;
  const bMap = new Map((baseline || []).map((p) => [key(p), p]));
  const lMap = new Map((live || []).map((p) => [key(p), p]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, p] of lMap) {
    if (!bMap.has(k)) added.push(p);
    else {
      const b = bMap.get(k);
      if ((b.qual || "") !== (p.qual || "") || (b.with_check || "") !== (p.with_check || "")) {
        changed.push({ before: b, after: p });
      }
    }
  }
  for (const [k, p] of bMap) {
    if (!lMap.has(k)) removed.push(p);
  }
  return { added, removed, changed };
}

function annotate(level, msg) {
  // GitHub Actions annotation
  console.log(`::${level}::${msg}`);
}

function main() {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

  const live = fetchLivePolicies();
  const baseline = loadJson(BASELINE_PATH) || [];

  // Always refresh the operational snapshot (next run can use it as fallback)
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(live, null, 2));

  // Risky-pattern scan on live
  const risky = [];
  for (const p of live) {
    const f = classify(p);
    if (f.length > 0) risky.push({ pol: p, findings: f });
  }

  // Drift vs baseline
  const drift = diffPolicies(baseline, live);

  let warnings = 0;
  for (const r of risky) {
    annotate("warning", `[rls-audit] ${r.pol.tablename}::${r.pol.policyname} (${r.pol.cmd}) → ${r.findings.map((f) => f.reason).join("; ")}`);
    warnings++;
  }
  for (const a of drift.added) {
    annotate("warning", `[rls-audit] NEW policy ${a.tablename}::${a.policyname} (${a.cmd}) — review qual/with_check`);
    warnings++;
  }
  for (const c of drift.changed) {
    annotate("warning", `[rls-audit] CHANGED policy ${c.after.tablename}::${c.after.policyname} — qual/with_check drift`);
    warnings++;
  }

  const md = [
    "# RLS-Audit Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: **${RATCHET ? "RATCHET (fail-fast)" : "warn-only"}**`,
    `Policies live: ${live.length}, baseline: ${baseline.length}`,
    "",
    "## Risky patterns",
    risky.length === 0 ? "_none_" : risky.map((r) => `- \`${r.pol.tablename}::${r.pol.policyname}\` (${r.pol.cmd}) — ${r.findings.map((f) => f.reason).join("; ")}`).join("\n"),
    "",
    "## Drift vs baseline",
    `- Added: ${drift.added.length}`,
    `- Removed: ${drift.removed.length}`,
    `- Changed: ${drift.changed.length}`,
    "",
    drift.added.length > 0 ? "### Added\n" + drift.added.map((p) => `- \`${p.tablename}::${p.policyname}\` (${p.cmd})`).join("\n") : "",
    drift.changed.length > 0 ? "### Changed\n" + drift.changed.map((c) => `- \`${c.after.tablename}::${c.after.policyname}\` (${c.after.cmd})`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
  fs.writeFileSync(REPORT_PATH, md);

  console.log(`[rls-audit] live=${live.length} baseline=${baseline.length} risky=${risky.length} added=${drift.added.length} changed=${drift.changed.length} warnings=${warnings}`);

  if (RATCHET && (risky.length > 0 || drift.added.length > 0 || drift.changed.length > 0)) {
    console.error("[rls-audit] RATCHET mode active — failing build due to drift/risky policies.");
    process.exit(1);
  }
  process.exit(0);
}

main();
