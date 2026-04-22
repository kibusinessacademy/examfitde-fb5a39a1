#!/usr/bin/env node
/**
 * SECURITY DEFINER Audit
 *
 * Generates a list of every SECURITY DEFINER object (functions + views)
 * in the public schema, classified by risk:
 *   - HIGH:   anon or PUBLIC has EXECUTE / SELECT
 *   - MEDIUM: only authenticated has access (still definer-bypassed RLS)
 *   - LOW:    locked down (only service_role / specific roles)
 *
 * Writes a markdown report to /mnt/documents/secdef-audit.md and exits
 * non-zero when HIGH-risk items are found.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY.
 */
import fs from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SRK) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

async function rpc(sql) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql_admin_ro`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "content-type": "application/json" },
    body: JSON.stringify({ p_sql: sql }),
  });
  if (!r.ok) throw new Error(`SQL failed (${r.status}): ${await r.text()}`);
  return r.json();
}

// Functions: prosecdef = definer
const FN_SQL = `
SELECT n.nspname AS schema,
       p.proname AS name,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('public', p.oid, 'EXECUTE')        AS public_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.prosecdef = true
ORDER BY anon_exec DESC, public_exec DESC, p.proname`;

// Views with security_definer property (PG15+ also security_invoker)
const VIEW_SQL = `
SELECT c.relname AS name,
       (
         SELECT string_agg(opt, ',') FROM unnest(c.reloptions) opt
         WHERE opt ILIKE 'security_%'
       ) AS sec_options,
       has_table_privilege('anon', c.oid, 'SELECT')          AS anon_read,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_read
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='v'
  AND EXISTS (SELECT 1 FROM unnest(c.reloptions) opt WHERE opt ILIKE 'security_definer%')
ORDER BY anon_read DESC, c.relname`;

function classify(anon, pub, auth) {
  if (anon || pub) return "HIGH";
  if (auth) return "MEDIUM";
  return "LOW";
}

(async () => {
  console.log("🔍 SECURITY DEFINER Audit\n");
  const fns = await rpc(FN_SQL);
  const views = await rpc(VIEW_SQL);

  const fnRows = fns.map((r) => ({ ...r, risk: classify(r.anon_exec, r.public_exec, r.auth_exec) }));
  const viewRows = views.map((r) => ({ ...r, risk: classify(r.anon_read, false, r.auth_read) }));

  const sum = (rows) => rows.reduce((acc, r) => { acc[r.risk] = (acc[r.risk] || 0) + 1; return acc; }, {});
  const fnSum = sum(fnRows), viewSum = sum(viewRows);

  console.log(`Functions: ${fnRows.length} (HIGH=${fnSum.HIGH || 0}, MEDIUM=${fnSum.MEDIUM || 0}, LOW=${fnSum.LOW || 0})`);
  console.log(`Views:     ${viewRows.length} (HIGH=${viewSum.HIGH || 0}, MEDIUM=${viewSum.MEDIUM || 0}, LOW=${viewSum.LOW || 0})`);

  // Markdown report
  const lines = [];
  lines.push(`# SECURITY DEFINER Audit — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push(`- Functions: HIGH=${fnSum.HIGH || 0} · MEDIUM=${fnSum.MEDIUM || 0} · LOW=${fnSum.LOW || 0}`);
  lines.push(`- Views:     HIGH=${viewSum.HIGH || 0} · MEDIUM=${viewSum.MEDIUM || 0} · LOW=${viewSum.LOW || 0}`);
  lines.push("");

  for (const risk of ["HIGH", "MEDIUM"]) {
    const fnsRisk = fnRows.filter((r) => r.risk === risk);
    if (fnsRisk.length) {
      lines.push(`## ${risk} risk SECURITY DEFINER functions (${fnsRisk.length})`);
      for (const r of fnsRisk) {
        lines.push(`- \`${r.name}(${r.args})\` — anon=${r.anon_exec} pub=${r.public_exec} auth=${r.auth_exec}`);
      }
      lines.push("");
    }
  }
  for (const risk of ["HIGH", "MEDIUM"]) {
    const vsRisk = viewRows.filter((r) => r.risk === risk);
    if (vsRisk.length) {
      lines.push(`## ${risk} risk SECURITY DEFINER views (${vsRisk.length})`);
      for (const r of vsRisk) {
        lines.push(`- \`${r.name}\` — anon=${r.anon_read} auth=${r.auth_read} opts=${r.sec_options}`);
      }
      lines.push("");
    }
  }

  fs.mkdirSync("/mnt/documents", { recursive: true });
  fs.writeFileSync("/mnt/documents/secdef-audit.md", lines.join("\n"));
  console.log("\n📄 Report → /mnt/documents/secdef-audit.md");

  const highCount = (fnSum.HIGH || 0) + (viewSum.HIGH || 0);
  if (highCount > 0) {
    console.error(`\n🚫 ${highCount} HIGH-risk SECURITY DEFINER object(s) — FAIL`);
    process.exit(1);
  }
  console.log("\n✅ No HIGH-risk SECURITY DEFINER objects");
})().catch((e) => { console.error("⚠️  audit error:", e); process.exit(1); });
