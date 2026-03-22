import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Automated Database Backup Snapshot v3 — Production-Hardened
 *
 * Security:
 *  - x-backup-job-secret header required (BACKUP_JOB_SECRET env)
 *  - Tier allowlist (critical | daily | weekly)
 *  - Table allowlist (only classified tables)
 *
 * Export:
 *  - Chunked NDJSON: 1000 rows per part
 *  - SHA-256 hash per part
 *  - Per-table manifest with parts[]
 *  - Global manifest per run
 *
 * Data Classification:
 *  - Klasse 1 (critical, 4h):  customer, exam, progress
 *  - Klasse 2 (daily):         curricula, content, governance
 *  - Klasse 3 (weekly):        ops, audit, affiliates
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JOB_SECRET = Deno.env.get("BACKUP_JOB_SECRET") || "";

// ── Data Classification ──
const KLASSE_1_TABLES = [
  "profiles", "user_roles", "enterprise_accounts",
  "licenses", "license_claims", "orders", "seats", "subscriptions",
  "exam_sessions", "exam_attempts", "exam_attempt_answers",
  "user_progress", "learning_progress",
  // B2B / org
  "org_entities", "org_learner_links",
  // Affiliate
  "affiliates", "affiliate_referrals",
] as const;

const KLASSE_2_TABLES = [
  "courses", "curricula", "learning_fields", "competencies",
  "modules", "lessons", "exam_blueprints", "exam_questions",
  "course_packages", "package_steps", "certification_catalog",
  "council_sessions", "council_votes",
  "handbook_sections", "handbook_chapters",
  "oral_exam_blueprints", "oral_exam_scenarios",
  // Governance / config
  "auto_heal_policies", "ai_worker_policies",
  "feature_flags", "model_routing_rules",
  "ai_generation_policies", "ai_budget_policies",
  // Content versions
  "content_versions", "minicheck_questions",
] as const;

const KLASSE_3_TABLES = [
  "admin_actions", "auto_heal_log", "admin_notifications",
  "ai_tutor_logs", "ai_generations", "ai_validations",
  "ai_generation_requests", "job_queue", "backup_snapshots",
  "affiliate_payouts", "security_events",
  "ai_quality_gates", "ai_cost_budgets", "ai_usage_log",
] as const;

const ALL_ALLOWED = new Set([
  ...KLASSE_1_TABLES, ...KLASSE_2_TABLES, ...KLASSE_3_TABLES,
]);
const ALLOWED_TIERS = new Set(["critical", "daily", "weekly"]);
const PAGE_SIZE = 1000;

type BackupTier = "critical" | "daily" | "weekly";

interface BackupRequest {
  tier?: string;
  tables?: string[];
  verify_only?: boolean;
  dry_run?: boolean;
}

interface PartManifest {
  path: string;
  rows: number;
  sha256: string;
  bytes: number;
}

interface TableManifest {
  table: string;
  tier: string;
  exported_at: string;
  total_rows: number;
  format: "ndjson";
  parts: PartManifest[];
  sha256_all: string;
}

async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function authorize(req: Request): boolean {
  if (!JOB_SECRET) return false;
  const provided = req.headers.get("x-backup-job-secret");
  return provided === JOB_SECRET;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  // ── Auth ──
  if (!authorize(req)) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403, headers });
  }

  try {
    const body: BackupRequest = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};

    // ── Validate tier ──
    const tier = (body.tier || "daily") as BackupTier;
    if (!ALLOWED_TIERS.has(tier)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid tier" }), { status: 400, headers });
    }

    // ── Validate tables ──
    if (body.tables?.some(t => !ALL_ALLOWED.has(t as never))) {
      return new Response(JSON.stringify({ ok: false, error: "table not in allowlist" }), { status: 400, headers });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().replace(/[:.]/g, "-");

    // ── Select tables ──
    let tablesToBackup: string[];
    if (body.tables?.length) {
      tablesToBackup = body.tables;
    } else {
      switch (tier) {
        case "critical": tablesToBackup = [...KLASSE_1_TABLES]; break;
        case "daily": tablesToBackup = [...KLASSE_1_TABLES, ...KLASSE_2_TABLES]; break;
        case "weekly": tablesToBackup = [...KLASSE_1_TABLES, ...KLASSE_2_TABLES, ...KLASSE_3_TABLES]; break;
      }
    }

    // ── Row counts ──
    const rowCounts: Record<string, number> = {};
    await Promise.all(tablesToBackup.map(async (table) => {
      const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
      rowCounts[table] = error ? -1 : (count ?? 0);
    }));

    if (body.verify_only) {
      return new Response(JSON.stringify({ ok: true, row_counts: rowCounts }), { status: 200, headers });
    }
    if (body.dry_run) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, tier, tables: tablesToBackup, row_counts: rowCounts }), { status: 200, headers });
    }

    console.log(`[backup] Starting ${tier} backup: ${tablesToBackup.length} tables`);

    // ── Ensure bucket ──
    try { await sb.storage.createBucket("backups", { public: false, fileSizeLimit: 52428800 }); } catch { /* exists */ }

    // ── Chunked export ──
    const tableManifests: TableManifest[] = [];
    let totalRows = 0;
    let totalBytes = 0;
    const errors: string[] = [];

    for (const table of tablesToBackup) {
      const parts: PartManifest[] = [];
      let offset = 0;
      let partNum = 0;
      let tableRows = 0;
      const allHashes: string[] = [];

      try {
        let hasMore = true;
        while (hasMore) {
          // Fetch page
          const { data, error } = await sb
            .from(table)
            .select("*")
            .range(offset, offset + PAGE_SIZE - 1);

          if (error) {
            errors.push(`${table}: ${error.message}`);
            break;
          }
          if (!data || data.length === 0) { hasMore = false; break; }

          // Convert to NDJSON
          const ndjson = data.map(row => JSON.stringify(row)).join("\n") + "\n";
          const hash = await sha256(ndjson);
          const bytes = new TextEncoder().encode(ndjson).length;
          allHashes.push(hash);

          partNum++;
          const partPath = `${dateStr}/${tier}/${table}/part-${String(partNum).padStart(4, "0")}.ndjson`;

          const { error: uploadErr } = await sb.storage
            .from("backups")
            .upload(partPath, new Blob([ndjson], { type: "application/x-ndjson" }), {
              contentType: "application/x-ndjson",
              upsert: true,
            });

          if (uploadErr) {
            errors.push(`${table} part ${partNum}: ${uploadErr.message}`);
          }

          parts.push({ path: partPath, rows: data.length, sha256: hash, bytes });
          tableRows += data.length;
          totalBytes += bytes;
          offset += data.length;

          if (data.length < PAGE_SIZE) hasMore = false;
          // Safety: 200k rows max per table
          if (tableRows >= 200000) { hasMore = false; }
        }

        // Combined hash of all part hashes
        const combinedHash = await sha256(allHashes.join(":"));

        const manifest: TableManifest = {
          table,
          tier,
          exported_at: now.toISOString(),
          total_rows: tableRows,
          format: "ndjson",
          parts,
          sha256_all: combinedHash,
        };

        // Upload table manifest
        const manifestPath = `${dateStr}/${tier}/${table}/_manifest.json`;
        await sb.storage.from("backups").upload(
          manifestPath,
          new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
          { contentType: "application/json", upsert: true },
        );

        tableManifests.push(manifest);
        totalRows += tableRows;

      } catch (err) {
        errors.push(`${table}: ${String(err)}`);
      }
    }

    // ── Global manifest ──
    const globalManifest = {
      date: dateStr,
      tier,
      exported_at: now.toISOString(),
      tables: tableManifests.length,
      total_rows: totalRows,
      total_bytes: totalBytes,
      errors: errors.length,
      table_summaries: tableManifests.map(m => ({
        table: m.table,
        rows: m.total_rows,
        parts: m.parts.length,
        sha256: m.sha256_all,
      })),
    };

    await sb.storage.from("backups").upload(
      `${dateStr}/${tier}/_global_manifest.json`,
      new Blob([JSON.stringify(globalManifest, null, 2)], { type: "application/json" }),
      { contentType: "application/json", upsert: true },
    );

    // ── Integrity check: compare exported vs counted ──
    const mismatches: string[] = [];
    for (const m of tableManifests) {
      const expected = rowCounts[m.table] ?? 0;
      if (expected > 0 && m.total_rows < expected * 0.95) {
        mismatches.push(`${m.table}: expected ~${expected}, exported ${m.total_rows}`);
      }
    }

    const status = errors.length > 0 ? "partial" : mismatches.length > 0 ? "warning" : "completed";

    // ── Log snapshot ──
    await sb.from("backup_snapshots").insert({
      backup_type: tier,
      tables_backed_up: tablesToBackup,
      row_counts: { counts: rowCounts, mismatches, errors },
      size_estimate_mb: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
      status,
      triggered_by: "cron",
    });

    // ── Alert on issues ──
    if (errors.length > 0 || mismatches.length > 0) {
      await sb.from("admin_notifications").insert({
        title: `Backup ${tier}: ${status} (${errors.length} errors, ${mismatches.length} mismatches)`,
        body: [...errors.slice(0, 5), ...mismatches.slice(0, 5)].join("\n"),
        category: "system",
        severity: errors.length > 0 ? "critical" : "warning",
      });
    }

    // ── Retention cleanup ──
    await cleanupRetention(sb, now);

    return new Response(JSON.stringify({
      ok: errors.length === 0,
      tier, date: dateStr, status,
      tables: tableManifests.length,
      total_rows: totalRows,
      total_mb: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
      mismatches: mismatches.length > 0 ? mismatches : undefined,
      errors: errors.length > 0 ? errors : undefined,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[db-backup-snapshot] Fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function cleanupRetention(sb: ReturnType<typeof createClient>, now: Date) {
  const retentionDays: Record<string, number> = { critical: 7, daily: 30, weekly: 84 };
  const { data: folders } = await sb.storage.from("backups").list("", { limit: 1000 });
  if (!folders) return;

  for (const folder of folders) {
    const folderDate = new Date(folder.name);
    if (isNaN(folderDate.getTime())) continue;

    for (const [tier, days] of Object.entries(retentionDays)) {
      const cutoff = new Date(now.getTime() - days * 86400000);
      if (folderDate < cutoff) {
        try {
          // List and remove tier subfolder contents recursively
          const { data: tierContents } = await sb.storage.from("backups").list(`${folder.name}/${tier}`, { limit: 1000 });
          if (tierContents?.length) {
            // Check for table subfolders (chunked format)
            for (const item of tierContents) {
              const { data: subFiles } = await sb.storage.from("backups").list(`${folder.name}/${tier}/${item.name}`, { limit: 1000 });
              if (subFiles?.length) {
                await sb.storage.from("backups").remove(
                  subFiles.map(f => `${folder.name}/${tier}/${item.name}/${f.name}`)
                );
              }
            }
            await sb.storage.from("backups").remove(
              tierContents.map(f => `${folder.name}/${tier}/${f.name}`)
            );
          }
        } catch { /* cleanup is best-effort */ }
      }
    }
  }
}
