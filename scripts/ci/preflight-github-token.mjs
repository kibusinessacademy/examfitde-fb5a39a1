#!/usr/bin/env node
/**
 * Preflight: verifiziert dass der GitHub-Token Repository-Zugriff hat,
 * BEVOR ein Audit-Job (CI-Cluster-Audit, Run-Logs-Fetch, etc.) startet.
 *
 * Inputs (env):
 *   GITHUB_TOKEN  oder  GITHUB_PAT  oder  GITHUB_E2E_TOKEN  (mind. einer)
 *   GITHUB_REPO   "owner/repo"  (optional — sonst Auto-Discovery via /user/repos)
 *
 * Exit codes:
 *   0 → ok, Token kann Workflow-Runs lesen
 *   1 → kein Token gesetzt
 *   2 → Token ungültig / abgelaufen (401)
 *   3 → Token hat keinen Repo-Zugriff (leeres /user/repos + kein GITHUB_REPO erreichbar)
 *   4 → GITHUB_REPO gesetzt aber 404/403 (Token sieht das Repo nicht)
 *   5 → Repo ok, aber Actions-Read fehlt (403 auf /actions/runs)
 */

const TOKENS = ['GITHUB_TOKEN', 'GITHUB_PAT', 'GITHUB_E2E_TOKEN']
  .map((k) => [k, process.env[k]])
  .filter(([, v]) => v && v.trim().length > 0);

if (TOKENS.length === 0) {
  console.error('❌ Kein GitHub-Token gefunden (GITHUB_TOKEN / GITHUB_PAT / GITHUB_E2E_TOKEN).');
  console.error('   Fix: Repo → Settings → Secrets and variables → Actions → New repository secret.');
  process.exit(1);
}

const [tokenName, token] = TOKENS[0];
const REPO = process.env.GITHUB_REPO || process.env.GITHUB_REPOSITORY || '';

const headers = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'lovable-preflight',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

console.log(`🔍 Preflight mit ${tokenName}${REPO ? ` für ${REPO}` : ''}…`);

// 1. Token gültig?
const me = await gh('/user');
if (me.status === 401) {
  console.error('❌ Token ungültig oder abgelaufen (401).');
  console.error('   Fix: neuen Classic-PAT erstellen (scopes: repo, workflow) und Secret aktualisieren.');
  process.exit(2);
}
console.log(`   authentifiziert als: ${me.body?.login || '?'}`);

// 2. Repo-Zugriff
async function probeRepo(slug) {
  const r = await gh(`/repos/${slug}`);
  if (r.status === 200) return { ok: true };
  if (r.status === 404 || r.status === 403) return { ok: false, status: r.status };
  return { ok: false, status: r.status, body: r.body };
}

let resolvedRepo = REPO;
if (REPO) {
  const probe = await probeRepo(REPO);
  if (!probe.ok) {
    console.error(`❌ Token sieht ${REPO} nicht (HTTP ${probe.status}).`);
    console.error('   Fix (fine-grained PAT): Token-Seite → Repository access → "Only select repositories" → Repo wählen → Update.');
    console.error('   Alternative: Classic-PAT mit scope "repo" + "workflow".');
    process.exit(4);
  }
} else {
  const list = await gh('/user/repos?per_page=1');
  if (Array.isArray(list.body) && list.body.length === 0) {
    console.error('❌ Token hat KEINEN Repository-Zugriff (/user/repos leer).');
    console.error('   Fix: fine-grained PAT bearbeiten → Repository access setzen, ODER Classic-PAT mit scope "repo".');
    process.exit(3);
  }
  if (Array.isArray(list.body) && list.body[0]?.full_name) {
    resolvedRepo = list.body[0].full_name;
    console.log(`   Auto-discovered Repo: ${resolvedRepo}`);
  }
}

// 3. Actions-Read (das brauchen wir für den Audit)
if (resolvedRepo) {
  const runs = await gh(`/repos/${resolvedRepo}/actions/runs?per_page=1`);
  if (runs.status === 403) {
    console.error(`❌ Repo ok, aber kein Actions:Read auf ${resolvedRepo} (403).`);
    console.error('   Fix: fine-grained PAT → Repository permissions → Actions: Read aktivieren.');
    process.exit(5);
  }
  if (runs.status >= 400) {
    console.error(`❌ Unerwarteter Fehler beim Actions-API-Probe (HTTP ${runs.status}).`);
    process.exit(5);
  }
  console.log(`   ✓ Actions:Read ok (${runs.body?.total_count ?? '?'} Runs sichtbar)`);
}

console.log('✅ Preflight ok — Audit-Job kann starten.');
if (resolvedRepo && !process.env.GITHUB_REPO) {
  // Für Folge-Schritte im selben Job exportieren
  if (process.env.GITHUB_ENV) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_ENV, `GITHUB_REPO=${resolvedRepo}\n`);
  }
}
