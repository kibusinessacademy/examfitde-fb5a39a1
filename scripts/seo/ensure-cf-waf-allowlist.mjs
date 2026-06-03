#!/usr/bin/env node
/**
 * ensure-cf-waf-allowlist.mjs
 *
 * Idempotent: stellt sicher, dass die Cloudflare-Zone `examfit.de` (oder die per
 * CF_ZONE_ID übergebene Zone) eine WAF-Custom-Rule besitzt, die Requests mit dem
 * Header `X-ExamFit-Smoke: $EXAMFIT_SMOKE_TOKEN` an Managed Challenge / Bot Fight
 * Mode / WAF Managed Rules vorbei lässt (action=skip).
 *
 * Warum Header statt UA: User-Agents sind trivial spoofbar — wenn wir nur den UA
 * allowlisten, kann jeder Scraper mit `curl -A` durchspazieren. Shared-Secret-
 * Header ist die saubere Variante (siehe Cloudflare-Doc "Allow specific bots").
 *
 * Required env:
 *   CF_API_TOKEN        - Token mit Permissions Zone:Read + Zone WAF:Edit
 *   CF_ZONE_ID          - z.B. "abcdef0123..." für examfit.de
 *   EXAMFIT_SMOKE_TOKEN - Shared Secret (frei wählbar, z.B. openssl rand -hex 24)
 *
 * Exit: 0 = ensured (created or already-correct), 1 = error.
 *
 * API-Refs:
 *   - List Zone Entrypoint Ruleset rules:
 *       GET /zones/:zone_id/rulesets/phases/http_request_firewall_custom/entrypoint
 *   - Update Zone Entrypoint Ruleset:
 *       PUT /zones/:zone_id/rulesets/phases/http_request_firewall_custom/entrypoint
 *   - Rule action="skip" + action_parameters.phases/ruleset/products siehe
 *     https://developers.cloudflare.com/waf/custom-rules/skip/
 */

const RULE_DESCRIPTION = 'examfit-smoke-verifier-allowlist (managed by CI)';
const PHASE = 'http_request_firewall_custom';

const { CF_API_TOKEN, CF_ZONE_ID, EXAMFIT_SMOKE_TOKEN } = process.env;

function die(msg, code = 1) {
  console.error(`[cf-waf-allowlist] ✖ ${msg}`);
  process.exit(code);
}

if (!CF_API_TOKEN) die('CF_API_TOKEN missing');
if (!CF_ZONE_ID) die('CF_ZONE_ID missing');
if (!EXAMFIT_SMOKE_TOKEN || EXAMFIT_SMOKE_TOKEN.length < 16) {
  die('EXAMFIT_SMOKE_TOKEN missing or <16 chars (use a real secret)');
}

const API = 'https://api.cloudflare.com/client/v4';
const headers = {
  Authorization: `Bearer ${CF_API_TOKEN}`,
  'Content-Type': 'application/json',
};

// Cloudflare-Filter-Expression: Header match auf Smoke-Secret.
// http.request.headers ist case-insensitive; CF lowercased keys.
const EXPRESSION = `(any(http.request.headers["x-examfit-smoke"][*] == "${EXAMFIT_SMOKE_TOKEN}"))`;

const DESIRED_RULE = {
  description: RULE_DESCRIPTION,
  expression: EXPRESSION,
  action: 'skip',
  action_parameters: {
    // Skip ALLE nachfolgenden WAF-Phasen + Produkte für diesen Request
    ruleset: 'current',
    phases: [
      'http_ratelimit',
      'http_request_firewall_managed',
      'http_request_sbfm',
    ],
    products: ['bic', 'hot', 'rateLimit', 'securityLevel', 'uaBlock', 'waf', 'zoneLockdown'],
  },
  enabled: true,
};

async function cf(path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.success === false) {
    const errs = (json.errors || []).map((e) => `${e.code}:${e.message}`).join(' | ');
    die(`API ${init.method || 'GET'} ${path} → ${r.status} ${errs || r.statusText}`);
  }
  return json.result;
}

async function main() {
  const ep = await cf(`/zones/${CF_ZONE_ID}/rulesets/phases/${PHASE}/entrypoint`);
  const rules = Array.isArray(ep?.rules) ? ep.rules : [];

  const existing = rules.find((r) => r.description === RULE_DESCRIPTION);
  const isCorrect =
    existing &&
    existing.expression === EXPRESSION &&
    existing.action === 'skip' &&
    existing.enabled === true;

  if (isCorrect) {
    console.log(`[cf-waf-allowlist] ✓ rule already present & correct (id=${existing.id})`);
    return;
  }

  // Rebuild rules array: drop any prior version of our rule, prepend the new one
  // (Order matters: skip-Rule muss VOR blockierenden Rules stehen).
  const nextRules = [
    DESIRED_RULE,
    ...rules.filter((r) => r.description !== RULE_DESCRIPTION).map((r) => ({
      // Cloudflare PUT erwartet vollständige Rules-Liste; behalte alle Felder.
      id: r.id,
      description: r.description,
      expression: r.expression,
      action: r.action,
      action_parameters: r.action_parameters,
      ratelimit: r.ratelimit,
      logging: r.logging,
      enabled: r.enabled,
    })),
  ].map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));

  await cf(`/zones/${CF_ZONE_ID}/rulesets/phases/${PHASE}/entrypoint`, {
    method: 'PUT',
    body: JSON.stringify({ rules: nextRules }),
  });

  console.log(
    `[cf-waf-allowlist] ✓ ${existing ? 'updated' : 'created'} allowlist rule on zone ${CF_ZONE_ID}`,
  );
}

main().catch((e) => die(String(e?.stack || e?.message || e)));
