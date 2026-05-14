#!/usr/bin/env node
/**
 * Env-Check für Build/Start.
 *
 * - Vite/Frontend (lokal/Deploy Pflicht, generische CI nur Warnung): VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PROJECT_ID
 * - Cloudflare Pages Deploy (nur Pflicht wenn DEPLOY_TARGET=cloudflare):
 *     CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 *
 * Lädt .env (lokal) als Fallback. In GitHub Actions kommen die Werte aus repo secrets → process.env.
 * Exit 1 bei fehlenden Pflicht-Variablen mit klarer Anleitung.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// .env lokal laden (CI hat process.env bereits gesetzt — wird nicht überschrieben)
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, rawV] = m;
    if (process.env[k] !== undefined) continue;
    process.env[k] = rawV.replace(/^["']|["']$/g, '');
  }
}

const FRONTEND_REQUIRED = [
  {
    name: 'VITE_SUPABASE_URL',
    hint: 'Lovable .env (Code-Editor → .env im Root). Format: https://<project-ref>.supabase.co',
  },
  {
    name: 'VITE_SUPABASE_PUBLISHABLE_KEY',
    hint: 'Lovable .env. Publishable/anon Key (eyJ...). Sicher im Frontend-Bundle.',
  },
  {
    name: 'VITE_SUPABASE_PROJECT_ID',
    hint: 'Lovable .env. Supabase Project Ref (z.B. ubdvvvsiryenhrfmqsvw).',
  },
];

const DEPLOY_REQUIRED = [
  {
    name: 'CLOUDFLARE_API_TOKEN',
    hint: 'Cloudflare Dashboard → My Profile → API Tokens → Create Token (Template "Cloudflare Pages — Edit").',
  },
  {
    name: 'CLOUDFLARE_ACCOUNT_ID',
    hint: 'Cloudflare Dashboard → rechte Sidebar deiner Domain → Account ID.',
  },
];

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const deployTarget = (process.env.DEPLOY_TARGET || '').toLowerCase();
const deployMode = deployTarget === 'cloudflare';
const frontendRequired = !isCI || deployMode;
const cloudflareRequired = deployMode;

function check(group, vars, mode /* 'error' | 'warn' */) {
  const missing = vars.filter(({ name }) => !process.env[name] || !process.env[name].trim());
  const present = vars.filter(({ name }) => process.env[name] && process.env[name].trim());

  for (const { name } of present) {
    console.log(`  ${GREEN}✓${RESET} ${name}`);
  }

  if (missing.length === 0) return true;

  const color = mode === 'error' ? RED : YELLOW;
  const symbol = mode === 'error' ? '✗' : '⚠';
  console.log(`\n${color}${BOLD}${symbol} ${group} — fehlende Variablen:${RESET}`);
  for (const { name, hint } of missing) {
    console.log(`  ${color}${symbol} ${name}${RESET}`);
    console.log(`    ${DIM}→ ${hint}${RESET}`);
  }
  return false;
}

console.log(`\n${BOLD}env-check${RESET} ${DIM}(${isCI ? 'CI' : 'local'}${deployTarget ? `, DEPLOY_TARGET=${deployTarget}` : ''})${RESET}\n`);

console.log(`${BOLD}Frontend ${frontendRequired ? '(Pflicht)' : '(optional in generischer CI)'}:${RESET}`);
const frontendOk = check('Frontend (VITE_*)', FRONTEND_REQUIRED, frontendRequired ? 'error' : 'warn');

console.log(`\n${BOLD}Cloudflare Pages Deploy ${cloudflareRequired ? '(Pflicht)' : '(optional, nur bei DEPLOY_TARGET=cloudflare Pflicht)'}:${RESET}`);
const cfOk = check('Cloudflare', DEPLOY_REQUIRED, cloudflareRequired ? 'error' : 'warn');

const hardFail = (frontendRequired && !frontendOk) || (cloudflareRequired && !cfOk);

if (hardFail) {
  console.log(
    `\n${RED}${BOLD}Build abgebrochen.${RESET} Setze die fehlenden Variablen:\n` +
      `  • Lokal:  in der ${BOLD}.env${RESET} im Projekt-Root\n` +
      `  • GitHub: Repo → Settings → Secrets and variables → Actions → ${BOLD}New repository secret${RESET}\n`,
  );
  process.exit(1);
}

console.log(`\n${GREEN}${BOLD}env-check ok${RESET}\n`);
