#!/usr/bin/env node
/**
 * post-deploy-vibeos-separation.mjs
 *
 * Post-deploy verification for berufos.com hard-separation from VibeOS.
 *
 * Checks:
 *  1. Forbidden public routes (/vibeos, /avatar, /runtime, /apps/new) return
 *     a non-200 status (preferably 404) — they must NOT serve the SPA shell.
 *     If a SPA host returns 200, the served HTML must not contain forbidden
 *     VibeOS tokens.
 *  2. Root HTML (/) contains zero forbidden brand/identifier tokens.
 *
 * Robustness:
 *  - Per-request timeout (AbortController)
 *  - Exponential backoff retries on transient failures (network errors,
 *    5xx, 0 status) to ride out deploy propagation delays.
 *
 * Usage:
 *   node scripts/guards/post-deploy-vibeos-separation.mjs \
 *     [--host=https://berufos.com] [--retries=5] [--timeout=10000] \
 *     [--backoff=2000] [--max-backoff=30000]
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
const RETRIES = Number(args.retries ?? process.env.RETRIES ?? 5);
const TIMEOUT_MS = Number(args.timeout ?? process.env.TIMEOUT_MS ?? 10_000);
const BACKOFF_MS = Number(args.backoff ?? process.env.BACKOFF_MS ?? 2_000);
const MAX_BACKOFF_MS = Number(args["max-backoff"] ?? process.env.MAX_BACKOFF_MS ?? 30_000);

const FORBIDDEN_ROUTES = ["/vibeos", "/avatar", "/runtime", "/apps/new"];
const FORBIDDEN_TOKENS = ["VibeOS", "AvatarOS", "RuntimeCommandCenter", "BackgroundAgentRuntime"];
const ROOT_PATHS = ["/"];

const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransient(status, err) {
  if (err) return true; // network/abort
  if (status === 0) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  return false;
}

async function fetchWithRetry(url, init = {}, label = "") {
  let lastStatus = 0;
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(to);
      if (!isTransient(res.status)) return { res, attempt };
      lastStatus = res.status;
      console.log(`  ↻ ${label || url} attempt ${attempt}/${RETRIES} → HTTP ${res.status} (transient)`);
    } catch (e) {
      clearTimeout(to);
      lastErr = e;
      console.log(`  ↻ ${label || url} attempt ${attempt}/${RETRIES} → ${e.name === "AbortError" ? `timeout ${TIMEOUT_MS}ms` : e.message}`);
    }
    if (attempt < RETRIES) {
      const wait = Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** (attempt - 1));
      await sleep(wait);
    }
  }
  return { res: null, attempt: RETRIES, lastStatus, lastErr };
}

async function head(url) {
  const { res, lastStatus, lastErr } = await fetchWithRetry(
    url,
    { method: "HEAD", redirect: "manual" },
    `HEAD ${url}`,
  );
  if (!res) return { status: lastStatus || 0, error: lastErr?.message };
  return { status: res.status, location: res.headers.get("location") };
}

async function getText(url) {
  const { res, lastStatus, lastErr } = await fetchWithRetry(
    url,
    { method: "GET", redirect: "follow" },
    `GET ${url}`,
  );
  if (!res) return { status: lastStatus || 0, error: lastErr?.message, text: "" };
  return { status: res.status, text: await res.text() };
}

function findTokens(html) {
  return FORBIDDEN_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(html));
}

console.log(`\n🔎 Post-Deploy VibeOS Separation Check — ${HOST}`);
console.log(`   retries=${RETRIES} timeout=${TIMEOUT_MS}ms backoff=${BACKOFF_MS}..${MAX_BACKOFF_MS}ms\n`);

// 1. Forbidden routes
for (const route of FORBIDDEN_ROUTES) {
  const url = `${HOST}${route}`;
  const h = await head(url);
  const statusLabel = h.error ? `ERR ${h.error}` : `HTTP ${h.status}`;

  if (h.status === 404 || h.status === 410) {
    record(`HEAD ${route}`, true, statusLabel);
    continue;
  }

  const g = await getText(url);
  if (g.status === 0) {
    record(`HEAD ${route}`, false, `${statusLabel} — GET also failed: ${g.error}`);
    continue;
  }
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
