#!/usr/bin/env node
/**
 * trigger-vercel-redeploy.mjs
 *
 * Stößt einen Vercel-Production-Redeploy an, damit der SPA-Fallback-Fix
 * in `vercel.json` (Trigger-Gate Stability v1) live geht.
 *
 * Zwei unterstützte Pfade — der erste mit verfügbaren Credentials gewinnt:
 *
 *   A) GitHub-Repository-Dispatch (empfohlen)
 *      Voraussetzung: `gh` CLI authentifiziert ODER GITHUB_TOKEN gesetzt.
 *      Effekt: feuert `repository_dispatch` event_type=`vercel-deploy-trigger`,
 *      welches einen leeren Commit auf main pusht und so Vercels Auto-Deploy
 *      auslöst. (Funktioniert auch ohne Vercel-Token.)
 *
 *   B) Vercel-API-Direkt
 *      Voraussetzung: VERCEL_TOKEN + VERCEL_PROJECT_ID (+ optional VERCEL_TEAM_ID).
 *      Effekt: POST /v13/deployments mit target=production, gitSource=main.
 *
 * Beide Pfade enden mit derselben Folge:
 *   1. Deploy wird gestartet
 *   2. Post-Deploy Go-Status Workflow läuft (siehe vercel-prerender-gate.yml)
 *   3. Smoke prüft 7 Routen → GO/BLOCKED
 *
 * Usage:
 *   node scripts/seo/trigger-vercel-redeploy.mjs [--reason="spa-fallback-fix"]
 *
 * Exit:
 *   0 = trigger gesendet
 *   2 = keine Credentials gefunden
 *   3 = API-Fehler
 */
import { execSync, spawnSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || true];
  }),
);
const REASON = String(args.reason || "trigger-gate-spa-fallback-fix");
const SKIP_VERIFY = args["skip-verify"] === true || args["skip-verify"] === "true";
const VERIFY_WAIT_S = Number(args["verify-wait"] || 90);

function validateCredentials() {
  const hookOk = !!process.env.VERCEL_DEPLOY_HOOK_URL;
  const dispatchOk = hasGhCli() || (!!process.env.GITHUB_TOKEN && !!process.env.GITHUB_REPOSITORY);
  const apiOk = !!process.env.VERCEL_TOKEN && !!process.env.VERCEL_PROJECT_ID;

  if (hookOk || dispatchOk || apiOk) {
    const paths = [hookOk && "C:DeployHook", dispatchOk && "A:GitHubDispatch", apiOk && "B:VercelAPI"]
      .filter(Boolean).join(", ");
    console.log(`✓ Auth verfügbar: ${paths}`);
    if (hookOk && !process.env.VERCEL_DEPLOY_HOOK_URL.startsWith("https://api.vercel.com/v1/integrations/deploy/")) {
      console.warn(`⚠ VERCEL_DEPLOY_HOOK_URL ungewöhnliches Format — erwartet https://api.vercel.com/v1/integrations/deploy/<projectId>/<hookId>`);
    }
    return;
  }

  console.error(`
✗ Keine Vercel-Credentials konfiguriert.
  Mindestens EINEN Weg bereitstellen:

  Pfad C (empfohlen, zero-auth):
    Secret VERCEL_DEPLOY_HOOK_URL setzen.
    Quelle: Vercel → Project Settings → Git → Deploy Hooks → Create Hook (branch=main).

  Pfad A (GitHub-Dispatch):
    gh CLI authentifiziert (gh auth login)
    ODER GITHUB_TOKEN (repo-Scope) + GITHUB_REPOSITORY (owner/name).

  Pfad B (Vercel-API):
    VERCEL_TOKEN + VERCEL_PROJECT_ID (optional VERCEL_TEAM_ID).
    Token: vercel.com/account/tokens
`);
  process.exit(2);
}

function hasGhCli() {
  try {
    execSync("gh --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function viaGitHubDispatch() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo && !hasGhCli()) return false;

  if (hasGhCli()) {
    console.log("▶ Pfad A: gh CLI repository_dispatch");
    const cmd = `gh api -X POST repos/${repo || ":owner/:repo"}/dispatches \
      -f event_type=vercel-deploy-trigger \
      -f client_payload[reason]='${REASON}'`;
    execSync(cmd, { stdio: "inherit" });
    return true;
  }

  if (process.env.GITHUB_TOKEN && repo) {
    console.log("▶ Pfad A: GITHUB_TOKEN repository_dispatch");
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        event_type: "vercel-deploy-trigger",
        client_payload: { reason: REASON },
      }),
    });
    if (!r.ok) {
      console.error(`✗ GitHub API ${r.status}: ${await r.text()}`);
      return false;
    }
    return true;
  }
  return false;
}

async function viaVercelApi() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return false;

  console.log("▶ Pfad B: Vercel-API direkt");
  const teamQ = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  const r = await fetch(`https://api.vercel.com/v13/deployments${teamQ}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "examfit",
      project: projectId,
      target: "production",
      gitSource: { type: "github", ref: "main" },
      meta: { reason: REASON },
    }),
  });
  if (!r.ok) {
    console.error(`✗ Vercel API ${r.status}: ${await r.text()}`);
    return false;
  }
  const data = await r.json();
  console.log(`✓ Deploy queued: https://${data.url || "(see Vercel dashboard)"}`);
  return true;
}

async function viaDeployHook() {
  const url = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!url) return false;
  console.log("▶ Pfad C: Vercel Deploy Hook");
  const r = await fetch(url, { method: "POST" });
  const txt = await r.text();
  if (!r.ok) {
    console.error(`✗ Deploy Hook ${r.status}: ${txt}`);
    return false;
  }
  console.log(`✓ Deploy queued: ${txt}`);
  return true;
}

// Preferred order: Deploy Hook (zero-auth) → GitHub dispatch → Vercel API
const okC = await viaDeployHook();
if (okC) process.exit(0);
const okA = await viaGitHubDispatch();
if (okA) {
  console.log("✓ GitHub repository_dispatch gesendet — Vercel deployt automatisch.");
  process.exit(0);
}
const okB = await viaVercelApi();
if (okB) process.exit(0);

console.error(`
✗ Keine Credentials gefunden.
  Pfad C (empfohlen): VERCEL_DEPLOY_HOOK_URL als Secret setzen.
  Pfad A (Fallback):  gh CLI authentifizieren ODER GITHUB_TOKEN + GITHUB_REPOSITORY setzen.
  Pfad B (Fallback):  VERCEL_TOKEN + VERCEL_PROJECT_ID setzen.
`);
process.exit(2);
