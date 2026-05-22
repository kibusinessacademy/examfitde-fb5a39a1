#!/usr/bin/env node
/**
 * Publish-Fanout-Completeness Guard (P2)
 * --------------------------------------------------------------
 * Ruft die DB-RPC `admin_check_publish_fanout_completeness()` auf
 * und failt, sobald nicht-grandfathered Pakete im Status `published`
 * mindestens eine fehlende Fanout-Komponente haben:
 *   - catalog_entry        (certification_catalog)
 *   - pillar_article       (blog_articles.article_type='pillar_guide')
 *   - active_public_product (products status='active' visibility='public')
 *
 * Skips gracefully when no SUPABASE service-role secret is present
 * (forward-ratchet: lokal/PR ohne Secret).
 *
 * ENV:
 *   SUPABASE_URL                  (default: VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY     (required to enforce; sonst skip)
 *   PUBLISH_FANOUT_GUARD_ALLOW=N  (Hardgrenze; default 0)
 */

const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://ubdvvvsiryenhrfmqsvw.supabase.co";

const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const ALLOW = Number(process.env.PUBLISH_FANOUT_GUARD_ALLOW || 0);

if (!KEY) {
  console.warn(
    "[publish-fanout-guard] SUPABASE_SERVICE_ROLE_KEY missing — skipping (advisory)."
  );
  process.exit(0);
}

const endpoint = `${URL}/rest/v1/rpc/admin_check_publish_fanout_completeness`;

async function main() {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[publish-fanout-guard] RPC failed: HTTP ${res.status} ${text}`
    );
    process.exit(2);
  }

  const data = await res.json();
  const summary = data?.summary || {};
  const missing = data?.missing_packages || [];

  console.log("[publish-fanout-guard] summary:", JSON.stringify(summary));

  const offenders = Array.isArray(missing) ? missing : [];
  if (offenders.length > ALLOW) {
    console.error(
      `[publish-fanout-guard] FAIL: ${offenders.length} non-grandfathered published packages with missing fanout (allow=${ALLOW}).`
    );
    for (const p of offenders.slice(0, 25)) {
      console.error(
        `  - ${p.package_key || p.package_id}: missing=[${(p.missing || []).join(",")}]`
      );
    }
    process.exit(1);
  }

  console.log(
    `[publish-fanout-guard] OK — ${offenders.length} offender(s) within allow=${ALLOW}.`
  );
}

main().catch((err) => {
  console.error("[publish-fanout-guard] unexpected error:", err);
  process.exit(2);
});
