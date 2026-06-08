#!/usr/bin/env node
/**
 * post-deploy-vibeos-separation.mjs
 *
 * Post-deploy verification for berufos.com hard-separation from VibeOS.
 *
 * Checks:
 *  1. Forbidden public routes (/vibeos, /avatar, /runtime, /apps/new) return
 *     a non-200 status (preferably 404) — they must NOT serve the SPA shell.
 *     NOTE: many SPA hosts return 200 with the index shell. In that case we
 *     additionally check that the served HTML does NOT mention VibeOS tokens.
 *  2. Root HTML (/) contains zero forbidden brand/identifier tokens.
 *
 * Usage:
 *   node scripts/guards/post-deploy-vibeos-separation.mjs [--host=https://berufos.com]
 *
 * Exit codes: 0 = PASS, 1 = FAIL
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const HOST = (args.host || process.env.HOST || "https://berufos.com").replace(/\/$/, "");
const FORBIDDEN_ROUTES = ["/vibeos", "/avatar", "/runtime", "/apps/new"];
const FORBIDDEN_TOKENS = ["VibeOS", "AvatarOS", "RuntimeCommandCenter", "BackgroundAgentRuntime"];
const ROOT_PATHS = ["/"];

const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function head(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    return { status: res.status, location: res.headers.get("location") };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

async function getText(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, error: e.message, text: "" };
  }
}

function findTokens(html) {
  return FORBIDDEN_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(html));
}

console.log(`\n🔎 Post-Deploy VibeOS Separation Check — ${HOST}\n`);

// 1. Forbidden routes
for (const route of FORBIDDEN_ROUTES) {
  const url = `${HOST}${route}`;
  const h = await head(url);
  const statusLabel = h.error ? `ERR ${h.error}` : `HTTP ${h.status}`;

  if (h.status === 404 || h.status === 410) {
    record(`HEAD ${route}`, true, statusLabel);
    continue;
  }

  // SPA shell fallback (200) is only acceptable if HTML has no forbidden tokens
  const g = await getText(url);
  const hits = findTokens(g.text);
  if (hits.length === 0) {
    record(`HEAD ${route}`, true, `${statusLabel} (SPA shell, no forbidden tokens)`);
  } else {
    record(`HEAD ${route}`, false, `${statusLabel} — forbidden tokens: ${hits.join(", ")}`);
  }
}

// 2. Root content-grep
for (const path of ROOT_PATHS) {
  const url = `${HOST}${path}`;
  const g = await getText(url);
  if (g.status !== 200) {
    record(`GET ${path}`, false, `HTTP ${g.status} ${g.error || ""}`);
    continue;
  }
  const hits = findTokens(g.text);
  if (hits.length === 0) {
    record(`GET ${path} (content-grep)`, true, "clean");
  } else {
    record(`GET ${path} (content-grep)`, false, `forbidden tokens: ${hits.join(", ")}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${failed.length === 0 ? "✅ PASS" : "❌ FAIL"} — ${results.length - failed.length}/${results.length} checks passed\n`,
);

process.exit(failed.length === 0 ? 0 : 1);
