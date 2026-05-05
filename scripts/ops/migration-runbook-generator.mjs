#!/usr/bin/env node
/**
 * Migration Runbook Generator
 * ────────────────────────────
 * Liest Audit-Summary (admin_get_audit_reports_summary RPC oder lokales JSON)
 * und generiert pro Cluster eine Schritt-für-Schritt-Checkliste in Markdown.
 *
 * Cluster-Heuristik (Funktions-Namen):
 *   - Queue/Worker/Heal: ^(claim_|fn_|admin_heal|admin_nudge|reaper|worker)
 *   - Governance:        ^(council|integrity|auto_publish|validate_|finalize|promote)
 *   - SEO/Growth:        ^(seo_|growth_|llm_|sitemap_)
 *   - Admin-only:        ^admin_
 *   - Andere:            "Other"
 *
 * Quellen:
 *   --in=audit-summary.json   (von AuditReportsPage exportiert)
 *   ODER live: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY → ruft RPC.
 *
 * Output:
 *   --out=docs/runbooks/auto-heal-log-migration.md
 *   default: stdout
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const CLUSTERS = [
  { id: "queue",       label: "Queue / Worker / Heal", re: /^(claim_|fn_|admin_heal|admin_nudge|reaper|worker)/i },
  { id: "governance",  label: "Governance",            re: /^(council|integrity|auto_publish|validate_|finalize|promote)/i },
  { id: "seo",         label: "SEO / Growth",          re: /^(seo_|growth_|llm_|sitemap_)/i },
  { id: "admin",       label: "Admin-only",            re: /^admin_/i },
  { id: "other",       label: "Other",                 re: /.*/ },
];

function clusterOf(name) {
  for (const c of CLUSTERS) if (c.re.test(name)) return c.id;
  return "other";
}

async function loadSummary() {
  if (args.in) return JSON.parse(readFileSync(args.in, "utf8"));
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Provide --in=file.json or set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
  const res = await fetch(`${url}/rest/v1/rpc/admin_get_audit_reports_summary`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`RPC failed: HTTP ${res.status}`);
  return await res.json();
}

function genCluster(label, items) {
  if (!items.length) return "";
  const list = items
    .map((it) => {
      const flags = [
        it.bad_action_col && "action→action_type",
        it.bad_details_col && "details→metadata",
        it.bad_triggered_by && "triggered_by→trigger_source",
        it.bad_package_id_col && "package_id→target_id+target_type",
        it.bad_payload && "payload schema",
      ].filter(Boolean);
      return `- [ ] \`${it.func}\` — fix: ${flags.length ? flags.join(", ") : "review payload"}`;
    })
    .join("\n");
  return `\n### ${label} (${items.length})\n\n${list}\n`;
}

(async function main() {
  const summary = await loadSummary();
  const producers = summary?.coupling_legacy_producers ?? [];
  const offenders = producers.filter((p) =>
    p.bad_payload || p.bad_triggered_by || p.bad_action_col || p.bad_package_id_col || p.bad_details_col
  );

  const buckets = Object.fromEntries(CLUSTERS.map((c) => [c.id, []]));
  for (const p of offenders) buckets[clusterOf(p.func)].push(p);

  const today = new Date().toISOString().slice(0, 10);
  let md = `# auto_heal_log Migration Runbook\n\n`;
  md += `_Generated: ${today}_\n\n`;
  md += `**Total legacy offenders:** ${offenders.length} / ${producers.length} producers\n\n`;
  md += `## Canonical schema reminder\n\n`;
  md += `\`\`\`sql\nINSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)\nVALUES (...);\n\`\`\`\n`;
  md += `\n## Per-cluster checklist\n`;

  for (const c of CLUSTERS) md += genCluster(c.label, buckets[c.id]);

  md += `\n## Validation\n\n`;
  md += `1. Run \`npm run guard:auto-heal-log\` (static + live).\n`;
  md += `2. Confirm \`SELECT count(*) FROM v_auto_heal_log_legacy_producers WHERE bad_payload OR bad_triggered_by OR bad_action_col OR bad_package_id_col OR bad_details_col\` = 0.\n`;
  md += `3. Activate hard-block trigger \`trg_guard_auto_heal_log_schema\` on 2026-05-08.\n`;

  if (args.out) { writeFileSync(args.out, md); console.error(`✅ Wrote ${args.out}`); }
  else process.stdout.write(md);
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
