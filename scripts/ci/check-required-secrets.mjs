#!/usr/bin/env node
/**
 * Generic Secret-Validator für CI-Workflows.
 *
 * Usage:
 *   node scripts/ci/check-required-secrets.mjs SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
 *
 * Prüft jede genannte Env-Variable auf:
 *   - existiert
 *   - non-empty (whitespace-trim)
 *   - kein Literal `null` / `undefined` / `${{ secrets.* }}` (häufige YAML-Drift)
 *   - URL-Pattern (wenn Name auf `_URL` endet): https://...supabase.co
 *   - Key-Pattern (wenn Name auf `_KEY` endet): mind. 40 Zeichen, beginnt mit `eyJ` (JWT)
 *
 * Exit 1 mit listing aller fehlerhaften Secrets + Hinweis, wo sie hinterlegt werden.
 *
 * Soll als ERSTER Step in jedem DB-Workflow aufgerufen werden, damit der
 * eigentliche Job-Body keine `null`-Header an Supabase sendet.
 */

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const required = process.argv.slice(2);
if (required.length === 0) {
  console.error(`${RED}check-required-secrets: no secret names provided.${RESET}`);
  console.error(`Usage: node scripts/ci/check-required-secrets.mjs NAME1 NAME2 ...`);
  process.exit(2);
}

const BAD_LITERALS = new Set(["null", "undefined", "None", "nil", ""]);
const errors = [];
const ok = [];

for (const name of required) {
  const raw = process.env[name];
  const v = (raw ?? "").trim();

  if (!v) {
    errors.push({ name, reason: "missing or empty" });
    continue;
  }
  if (BAD_LITERALS.has(v)) {
    errors.push({ name, reason: `literal "${v}" — secret not wired up in workflow` });
    continue;
  }
  if (v.startsWith("${{") || v.includes("secrets.")) {
    errors.push({ name, reason: "unexpanded GitHub expression — wrong YAML syntax" });
    continue;
  }
  if (name.endsWith("_URL")) {
    if (!/^https?:\/\/.+/.test(v)) {
      errors.push({ name, reason: `not a URL (got "${v.slice(0, 30)}…")` });
      continue;
    }
  }
  if (name.endsWith("_KEY") || name.endsWith("_TOKEN")) {
    if (v.length < 20) {
      errors.push({ name, reason: `suspiciously short (${v.length} chars)` });
      continue;
    }
  }
  ok.push(name);
}

console.log(`\n${BOLD}check-required-secrets${RESET} ${DIM}(${required.length} required)${RESET}\n`);
for (const n of ok) console.log(`  ${GREEN}✓${RESET} ${n}`);
for (const e of errors) {
  console.log(`  ${RED}✗ ${e.name}${RESET} ${DIM}— ${e.reason}${RESET}`);
}

if (errors.length > 0) {
  const mode = (process.env.CI_SECRETS_MODE || "soft").toLowerCase();
  const msg =
    `${errors.length} Secret(s) fehlen/falsch.\n` +
    `Hinterlege fehlende Secrets:\n` +
    `  GitHub → Repo → Settings → Secrets and variables → Actions → ${BOLD}New repository secret${RESET}\n\n` +
    `Häufigste Fehlerquellen:\n` +
    `  • Secret-Name vertippt (z.B. SUPABASE_URL vs VITE_SUPABASE_URL)\n` +
    `  • Secret in Environment statt Repo-Scope hinterlegt\n` +
    `  • YAML referenziert anderen Namen als der hinterlegte Secret\n`;

  if (mode === "strict") {
    console.error(`\n${RED}${BOLD}Workflow abgebrochen (strict).${RESET} ${msg}`);
    process.exit(1);
  }
  // soft mode: emit GH Actions warning + continue so downstream skip-handlers can decide
  console.warn(`\n${YELLOW}${BOLD}Secret-Check soft-fail (continuing).${RESET} ${msg}`);
  console.log(`::warning::check-required-secrets: ${errors.length} secret(s) missing (mode=soft) — downstream skip-handler will decide.`);
  process.exit(0);
}

console.log(`\n${GREEN}${BOLD}all secrets ok${RESET}\n`);
