#!/usr/bin/env node
/**
 * Namespace-Drift Guard (Cut 4)
 *
 * Bigbang-Cleanup 2026-05-26: `berufski` ist deprecated.
 * SSOT-Namespaces:
 *   - `berufos`   → Plattform / Brand
 *   - `berufs-ki` → Produktmodul / Workbench
 *   - `berufski`  → ENTFERNT, niemals neu einführen
 *
 * Guard scannt aktiven Code (excl. Migrationen + Memory-Historie) auf:
 *   - `/berufski`
 *   - `berufski.de`
 *   - `berufski-checkout`
 *   - `berufski` (case-insensitive, jede Form)
 *
 * Fail-mode: exit 1 bei Treffer.
 * CI-Eintrag: `bun run guard:namespace-drift`
 */
import { execSync } from "node:child_process";

const PATTERNS = [
  { id: "berufski_route", rx: "/berufski" },
  { id: "berufski_domain", rx: "berufski\\.de" },
  { id: "berufski_checkout", rx: "berufski-checkout" },
  { id: "berufski_token", rx: "berufski" },
];

const EXCLUDES = [
  "!.git/**",
  "!node_modules/**",
  "!supabase/migrations/**", // historische Migrationen dürfen Wort enthalten
  "!.lovable/memory/**",     // Memory-Historie darf Wort dokumentieren
  "!scripts/guards/namespace-drift-guard.mjs", // self-reference
  "!dist/**",
  "!bun.lockb",
];

let violations = [];

for (const { id, rx } of PATTERNS) {
  let out = "";
  try {
    out = execSync(
      `rg --color=never -ni --no-heading "${rx}" ${EXCLUDES.map((e) => `-g '${e}'`).join(" ")}`,
      { encoding: "utf8" },
    );
  } catch (e) {
    // rg exit 1 = no matches → OK
    if (e.status === 1) continue;
    throw e;
  }
  if (out.trim()) {
    violations.push({ id, hits: out.trim().split("\n") });
  }
}

if (violations.length === 0) {
  console.log("✅ namespace-drift-guard: 0 berufski-Treffer (Cut-4-konform)");
  process.exit(0);
}

console.error("❌ namespace-drift-guard: berufski-Drift entdeckt\n");
for (const v of violations) {
  console.error(`Pattern: ${v.id}  (${v.hits.length} Treffer)`);
  for (const line of v.hits.slice(0, 10)) console.error("  " + line);
  if (v.hits.length > 10) console.error(`  … +${v.hits.length - 10} weitere`);
  console.error("");
}
console.error("SSOT: berufos = Brand, berufs-ki = Produkt, berufski = verboten.");
process.exit(1);
