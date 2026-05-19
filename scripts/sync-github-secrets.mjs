#!/usr/bin/env node
/**
 * Sync Supabase keys → GitHub Repository Secrets.
 *
 * Was es macht:
 *  1. Fragt CRON_SECRET ab (versteckt).
 *  2. Ruft die Edge-Function `reveal-service-role-key` auf und holt den sb_secret_…-Key.
 *  3. Schreibt eine Reihe von GitHub-Secrets in dein Repo (per `gh` CLI ODER per REST-API mit PAT).
 *
 * Voraussetzungen:
 *  - Node 18+
 *  - Entweder: GitHub CLI installiert und eingeloggt (`gh auth login`)  ← einfachster Weg
 *    ODER: Personal Access Token (Scope: `repo`) als GITHUB_TOKEN env var
 *  - Repo-Slug (owner/repo), z.B. via env GITHUB_REPO=examfit/examfitde oder Prompt
 *
 * Aufruf:
 *   node scripts/sync-github-secrets.mjs
 *
 * Nach erfolgreichem Lauf: Edge-Function `reveal-service-role-key` löschen + CRON_SECRET rotieren.
 */

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { execSync, spawnSync } from 'node:child_process';
import sodium from 'node:crypto';

const SUPABASE_URL = 'https://ubdvvvsiryenhrfmqsvw.supabase.co';
const REVEAL_FN = `${SUPABASE_URL}/functions/v1/reveal-service-role-key`;
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc';

// ---- IO helpers --------------------------------------------------------
function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const mutedStdout = new Writable({
      write(chunk, enc, cb) {
        if (!hidden) process.stdout.write(chunk, enc);
        else process.stdout.write('*');
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: mutedStdout, terminal: true });
    process.stdout.write(question);
    rl.question('', (ans) => {
      if (hidden) process.stdout.write('\n');
      rl.close();
      resolve(ans.trim());
    });
  });
}

function log(msg, color = '') {
  const colors = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

// ---- GitHub helpers ----------------------------------------------------
function ghCliAvailable() {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function setSecretViaGhCli(repo, name, value) {
  const r = spawnSync('gh', ['secret', 'set', name, '--repo', repo, '--body', value], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`gh secret set ${name} failed: ${r.stderr || r.stdout}`);
}

async function setSecretViaApi(repo, name, value, token, pubKey) {
  // Encrypt value with repo public key using libsodium-wrappers
  const { default: _sodium } = await import('libsodium-wrappers');
  await _sodium.ready;
  const binkey = _sodium.from_base64(pubKey.key, _sodium.base64_variants.ORIGINAL);
  const binsec = _sodium.from_string(value);
  const encBytes = _sodium.crypto_box_seal(binsec, binkey);
  const encrypted = _sodium.to_base64(encBytes, _sodium.base64_variants.ORIGINAL);

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/${name}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ encrypted_value: encrypted, key_id: pubKey.key_id }),
  });
  if (!res.ok) throw new Error(`API PUT ${name} → ${res.status} ${await res.text()}`);
}

async function getRepoPubKey(repo, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`Konnte Repo-Public-Key nicht holen (${res.status}): ${await res.text()}`);
  return res.json();
}

// ---- Main --------------------------------------------------------------
(async () => {
  log('\n🔐  Sync Supabase Keys → GitHub Secrets\n', 'bold');

  // 1) CRON_SECRET abfragen
  const cronSecret = await prompt('CRON_SECRET (versteckt eingeben): ', { hidden: true });
  if (!cronSecret) { log('Abbruch: kein CRON_SECRET.', 'red'); process.exit(1); }

  // 2) Service-Role-Key holen
  log('\n→ Rufe reveal-service-role-key …', 'dim');
  const res = await fetch(REVEAL_FN, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'x-cron-secret': cronSecret,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    log(`Edge-Function-Aufruf fehlgeschlagen (${res.status}): ${await res.text()}`, 'red');
    process.exit(1);
  }
  const body = await res.json();
  const serviceKey = body.service_role_key || body.key || body.value;
  if (!serviceKey || !String(serviceKey).startsWith('sb_secret_')) {
    log(`Kein gültiger sb_secret_… im Response: ${JSON.stringify(body)}`, 'red');
    process.exit(1);
  }
  log('✓ Service-Role-Key erhalten.', 'green');

  // 3) GitHub-Repo + Auth
  const repo = process.env.GITHUB_REPO || (await prompt('\nGitHub Repo (owner/repo): '));
  if (!/^[^/]+\/[^/]+$/.test(repo)) { log('Ungültiges Repo-Format.', 'red'); process.exit(1); }

  // Secrets-Map: alle, die in deinen Workflows tatsächlich verwendet werden
  const secrets = {
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    SRK_E2E: serviceKey,
    SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
    VITE_SUPABASE_PROJECT_ID: 'ubdvvvsiryenhrfmqsvw',
    SUPABASE_ANON_KEY: ANON_KEY,
  };

  log(`\n→ Schreibe ${Object.keys(secrets).length} Secrets nach ${repo} …`, 'dim');

  const useGh = ghCliAvailable();
  if (useGh) {
    log('  (via gh CLI)', 'dim');
    for (const [name, value] of Object.entries(secrets)) {
      try { setSecretViaGhCli(repo, name, value); log(`  ✓ ${name}`, 'green'); }
      catch (e) { log(`  ✗ ${name}: ${e.message}`, 'red'); }
    }
  } else {
    log('  (gh CLI nicht gefunden → REST-API)', 'dim');
    const token = process.env.GITHUB_TOKEN || (await prompt('GitHub PAT (Scope repo): ', { hidden: true }));
    if (!token) { log('Kein Token — Abbruch.', 'red'); process.exit(1); }
    const pubKey = await getRepoPubKey(repo, token);
    for (const [name, value] of Object.entries(secrets)) {
      try { await setSecretViaApi(repo, name, value, token, pubKey); log(`  ✓ ${name}`, 'green'); }
      catch (e) { log(`  ✗ ${name}: ${e.message}`, 'red'); }
    }
  }

  log('\n✅ Fertig.', 'bold');
  log('\nNächste Schritte:', 'yellow');
  log('  1. Edge-Function `reveal-service-role-key` löschen (Sicherheits-Cleanup)');
  log('  2. CRON_SECRET in Lovable Cloud rotieren');
  log('  3. Optional: GitHub Action neu starten, um die Secrets zu nutzen\n');
})().catch((e) => { log(`\nFehler: ${e.message}`, 'red'); process.exit(1); });
