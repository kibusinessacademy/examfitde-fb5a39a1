#!/usr/bin/env node

/**
 * CI Guard: Integrity Gate must be track-aware.
 *
 * Hard-fails if:
 *   1. package-run-integrity-check/index.ts lacks threshold map + track resolver + EXAM_FIRST entry
 *   2. Raw literal thresholds (500/40) appear outside the threshold map
 *   3. Depublish protection (isAlreadyPublished / published_at) is missing
 *
 * Warns if:
 *   4. integrity_report persistence not detected
 */

import fs from "node:fs";
import path from "node:path";

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function main() {
  const findings = [];

  const fnPath = path.join(
    process.cwd(),
    "supabase", "functions", "package-run-integrity-check", "index.ts",
  );

  if (!exists(fnPath)) {
    console.error(`[guard] Missing file: ${fnPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(fnPath, "utf8");
  const lines = text.split("\n");

  // ── Check 1: Track-aware threshold map must exist ──
  const hasMap =
    (text.includes("GATE_THRESHOLDS_BY_TRACK") || text.includes("POOL_THRESHOLDS")) &&
    text.includes("EXAM_FIRST");

  const hasResolver =
    text.includes("thresholdsFor") ||
    text.includes("poolTh") ||
    text.includes("POOL_THRESHOLDS[");

  if (!hasMap || !hasResolver) {
    findings.push({
      severity: "error",
      file: fnPath,
      message:
        "Integrity Gate must be track-aware: missing threshold map (GATE_THRESHOLDS_BY_TRACK or POOL_THRESHOLDS) " +
        "with EXAM_FIRST entry AND a track resolver (thresholdsFor / poolTh / POOL_THRESHOLDS[track]).",
    });
  }

  // ── Check 2: No raw global thresholds outside the map (hardened regex) ──
  const bad = [];

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    // Skip comment-only lines
    if (/^\s*(\/\/|\/?\*)/.test(ln)) continue;

    const isNum500 = /\b500\b/.test(ln);
    const isNum40  = /\b40\b/.test(ln);

    if (!isNum500 && !isNum40) continue;

    // Neighborhood: allow if within 35 lines of threshold map definition
    const neighborhood = lines.slice(Math.max(0, i - 35), i + 35).join("\n");
    const inMapBlock =
      neighborhood.includes("GATE_THRESHOLDS_BY_TRACK") ||
      neighborhood.includes("POOL_THRESHOLDS");

    // Allow if line is a map literal entry (minApproved: 500, etc.)
    const isMapLiteralLine =
      /\b(minApproved|minHardishPct|maxEasyPct|maxIsolatedPct)\b\s*:\s*\d+/.test(ln);

    if (inMapBlock && isMapLiteralLine) continue;

    // Allow if line references threshold object
    const refsThreshold =
      /\b(th|poolTh)\.(minApproved|minHardishPct|maxEasyPct|maxIsolatedPct)\b/.test(ln);

    if (refsThreshold) continue;

    // Detect: assigned constant (const MIN = 500), direct comparison (< 500),
    // or any bare usage of 500/40 that's not in the map
    const looksLikeAssignedConstant =
      /\b(const|let|var)\b[^;=]*=\s*\(?\s*(500|40)\s*\)?/.test(ln);
    const looksLikeDirectCompare =
      /[<>=!]=?\s*\(?\s*(500|40)\s*\)?/.test(ln) ||
      /\b(500|40)\b\s*[<>=!]=?/.test(ln);

    if (looksLikeAssignedConstant || looksLikeDirectCompare) {
      // Final exclusion: if inside map block, allow
      if (inMapBlock) continue;
      bad.push(`  L${i + 1}: ${ln.trim()}`);
    }
  }

  if (bad.length) {
    findings.push({
      severity: "error",
      file: fnPath,
      message:
        "Found raw literal thresholds (500/40) outside the track threshold map.\n" +
        "Use poolTh.minApproved / poolTh.minHardishPct instead.\n" +
        bad.slice(0, 15).join("\n"),
    });
  }

  // ── Check 3: integrity_report persistence ──
  const hasPersist =
    text.includes("integrity_report") &&
    text.includes('.from("course_packages")') &&
    text.includes(".update(");

  if (!hasPersist) {
    findings.push({
      severity: "warn",
      file: fnPath,
      message:
        "integrity_report persistence not detected. Ensure integrity_report is written to course_packages.",
    });
  }

  // ── Check 4: Depublish protection ──
  const hasDepublishGuard =
    text.includes("isAlreadyPublished") || text.includes("published_at");

  if (!hasDepublishGuard) {
    findings.push({
      severity: "error",
      file: fnPath,
      message:
        "Depublish protection missing. Integrity re-checks must NOT flip published packages to quality_gate_failed.",
    });
  }

  // ── Output ──
  const errors = findings.filter(f => f.severity === "error");
  const warns  = findings.filter(f => f.severity === "warn");

  for (const f of findings) {
    const tag = f.severity === "error" ? "❌ ERROR" : "⚠️  WARN";
    console.log(`\n[${tag}] ${f.file}\n${f.message}\n`);
  }

  if (errors.length) {
    console.error(`\n🚫 Integrity Track-Aware Guard FAILED (${errors.length} error(s), ${warns.length} warning(s))`);
    process.exit(2);
  }

  if (warns.length) {
    console.warn(`\n⚠️  ${warns.length} warning(s) (non-blocking)`);
  }

  console.log("\n✅ Integrity Track-Aware Guard passed");
  process.exit(0);
}

main();
