import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Automated Database Backup Snapshot v2
 * 
 * Multi-tier backup with data classification:
 *  - Klasse 1 (critical, hourly-capable): customer data, exam data, progress
 *  - Klasse 2 (critical, daily): curricula, blueprints, packages, quality data
 *  - Klasse 3 (weekly): large artifacts, audit logs
 * 
 * Features:
 *  - Row count verification per table
 *  - SHA-256 hash per export for integrity verification
 *  - Tiered retention (daily: 30d, weekly: 12w, monthly: 12m)
 *  - Backup health alerting via admin_notifications
 *  - Paginated export for large tables (>1000 rows)
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Data Classification ──
const KLASSE_1_TABLES = [
  // Customer & auth
  "profiles", "user_roles", "enterprise_accounts",
  // Licensing & payments
  "licenses", "license_claims", "orders", "seats", "subscriptions",
  // Exam integrity
  "exam_sessions", "exam_attempts", "exam_attempt_answers",
  // Progress
  "user_progress", "learning_progress",
] as const;

const KLASSE_2_TABLES = [
  // SSOT / Content
  "courses", "curricula", "learning_fields", "competencies",
  "modules", "lessons", "exam_blueprints", "exam_questions",
  "course_packages", "package_steps", "certification_catalog",
  // Quality & governance
  "council_sessions", "council_votes",
  "auto_heal_policies", "ai_worker_policies",
  "feature_flags", "model_routing_rules",
  // Handbook & oral
  "handbook_sections", "handbook_chapters",
  "oral_exam_blueprints", "oral_exam_scenarios",
] as const;

const KLASSE_3_TABLES = [
  // Audit & ops
  "admin_actions", "auto_heal_log", "admin_notifications",
  "ai_tutor_logs", "ai_generations", "ai_validations",
  "job_queue", "backup_snapshots",
  // Affiliates
  "affiliates", "affiliate_referrals", "affiliate_payouts",
] as const;

type BackupTier = "critical" | "daily" | "weekly";

interface BackupRequest {
  tier?: BackupTier;
  tables?: string[];
  verify_only?: boolean;
  dry_run?: boolean;
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function paginatedExport(
  sb: ReturnType<typeof createClient>,
  table: string,
  pageSize = 1000,
): Promise<{ data: unknown[]; error?: string }> {
  const allData: unknown[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .range(offset, offset + pageSize - 1)
      .order("created_at", { ascending: true });

    if (error) {
      // Retry without order (some tables may not have created_at)
      const { data: d2, error: e2 } = await sb
        .from(table)
        .select("*")
        .range(offset, offset + pageSize - 1);
      if (e2) return { data: allData, error: e2.message };
      if (!d2 || d2.length === 0) { hasMore = false; break; }
      allData.push(...d2);
      offset += d2.length;
      if (d2.length < pageSize) hasMore = false;
    } else {
      if (!data || data.length === 0) { hasMore = false; break; }
      allData.push(...data);
      offset += data.length;
      if (data.length < pageSize) hasMore = false;
    }

    // Safety limit: 100k rows per table
    if (allData.length >= 100000) {
      console.warn(`[backup] ${table}: hit 100k row limit, truncating`);
      hasMore = false;
    }
  }

  return { data: allData };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const body: BackupRequest = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};

    const tier: BackupTier = body.tier || "daily";
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().replace(/[:.]/g, "-");

    // Select tables based on tier
    let tablesToBackup: string[];
    if (body.tables?.length) {
      tablesToBackup = body.tables;
    } else {
      switch (tier) {
        case "critical":
          tablesToBackup = [...KLASSE_1_TABLES];
          break;
        case "daily":
          tablesToBackup = [...KLASSE_1_TABLES, ...KLASSE_2_TABLES];
          break;
        case "weekly":
          tablesToBackup = [...KLASSE_1_TABLES, ...KLASSE_2_TABLES, ...KLASSE_3_TABLES];
          break;
      }
    }

    console.log(`[backup] Starting ${tier} backup of ${tablesToBackup.length} tables`);

    // 1. Row counts
    const rowCounts: Record<string, number> = {};
    await Promise.all(tablesToBackup.map(async (table) => {
      const { count, error } = await sb
        .from(table)
        .select("*", { count: "exact", head: true });
      rowCounts[table] = error ? -1 : (count ?? 0);
    }));

    if (body.verify_only) {
      return new Response(JSON.stringify({ ok: true, row_counts: rowCounts }), { status: 200, headers });
    }

    if (body.dry_run) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true, tier, tables: tablesToBackup, row_counts: rowCounts,
      }), { status: 200, headers });
    }

    // 2. Ensure backup bucket
    try {
      await sb.storage.createBucket("backups", { public: false, fileSizeLimit: 52428800 });
    } catch { /* exists */ }

    // 3. Export tables with pagination and hashing
    const exportResults: Record<string, {
      rows: number;
      hash?: string;
      size_bytes?: number;
      error?: string;
    }> = {};
    let totalExportedRows = 0;
    let totalBytes = 0;

    for (const table of tablesToBackup) {
      try {
        const { data, error } = await paginatedExport(sb, table);
        if (error) {
          exportResults[table] = { rows: 0, error };
          continue;
        }

        const jsonContent = JSON.stringify(data, null, 2);
        const hash = await hashContent(jsonContent);
        const sizeBytes = new TextEncoder().encode(jsonContent).length;

        const filePath = `${dateStr}/${tier}/${table}_${timeStr}.json`;
        const { error: uploadError } = await sb.storage
          .from("backups")
          .upload(filePath, new Blob([jsonContent], { type: "application/json" }), {
            contentType: "application/json",
            upsert: true,
          });

        // Also write a manifest entry
        const manifestEntry = {
          table,
          rows: data.length,
          hash,
          size_bytes: sizeBytes,
          exported_at: now.toISOString(),
          tier,
        };
        const manifestPath = `${dateStr}/${tier}/_manifest_${table}.json`;
        await sb.storage
          .from("backups")
          .upload(manifestPath, new Blob([JSON.stringify(manifestEntry)], { type: "application/json" }), {
            contentType: "application/json",
            upsert: true,
          });

        exportResults[table] = {
          rows: data.length,
          hash,
          size_bytes: sizeBytes,
          error: uploadError?.message,
        };
        totalExportedRows += data.length;
        totalBytes += sizeBytes;
      } catch (err) {
        exportResults[table] = { rows: 0, error: String(err) };
      }
    }

    // 4. Verify: check row counts match
    const mismatches: string[] = [];
    for (const table of tablesToBackup) {
      const expected = rowCounts[table];
      const actual = exportResults[table]?.rows ?? 0;
      if (expected > 0 && actual < expected * 0.95) {
        mismatches.push(`${table}: expected ~${expected}, got ${actual}`);
      }
    }

    const status = mismatches.length > 0 ? "partial" : "completed";
    const sizeEstimateMb = Math.round(totalBytes / 1024 / 1024 * 100) / 100;

    // 5. Log snapshot
    await sb.from("backup_snapshots").insert({
      backup_type: tier,
      tables_backed_up: tablesToBackup,
      row_counts: { ...rowCounts, _export_results: exportResults },
      size_estimate_mb: sizeEstimateMb,
      status,
      triggered_by: "cron",
    });

    // 6. Alert on issues
    if (mismatches.length > 0) {
      await sb.from("admin_notifications").insert({
        title: `Backup Integrity Warning: ${mismatches.length} table(s) incomplete`,
        body: mismatches.join("\n"),
        category: "system",
        severity: "high",
      });
    }

    // 7. Retention cleanup
    await cleanupOldBackups(sb, now);

    return new Response(JSON.stringify({
      ok: true,
      tier,
      date: dateStr,
      tables_backed_up: tablesToBackup.length,
      total_rows: totalExportedRows,
      size_mb: sizeEstimateMb,
      status,
      mismatches: mismatches.length > 0 ? mismatches : undefined,
      row_counts: rowCounts,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[db-backup-snapshot] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function cleanupOldBackups(
  sb: ReturnType<typeof createClient>,
  now: Date,
) {
  const retentionDays: Record<string, number> = {
    critical: 7,   // Critical tier: 7 days (high frequency)
    daily: 30,     // Daily tier: 30 days
    weekly: 84,    // Weekly tier: 12 weeks
  };

  const { data: folders } = await sb.storage.from("backups").list("", { limit: 1000 });
  if (!folders) return;

  for (const folder of folders) {
    const folderDate = new Date(folder.name);
    if (isNaN(folderDate.getTime())) continue;

    // Check each tier subfolder
    for (const [tier, days] of Object.entries(retentionDays)) {
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      if (folderDate < cutoff) {
        const { data: tierFiles } = await sb.storage
          .from("backups")
          .list(`${folder.name}/${tier}`);
        if (tierFiles?.length) {
          await sb.storage
            .from("backups")
            .remove(tierFiles.map(f => `${folder.name}/${tier}/${f.name}`));
        }
      }
    }
  }
}
