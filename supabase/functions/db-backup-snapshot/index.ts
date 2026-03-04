import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Automated Database Backup Snapshot
 * 
 * Creates logical snapshots of critical tables by:
 * 1. Counting rows in all critical tables
 * 2. Exporting critical data to Supabase Storage as JSON
 * 3. Logging the snapshot in backup_snapshots table
 * 
 * Triggered by cron-trigger (daily at 03:00 UTC)
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Critical tables that must be backed up
const CRITICAL_TABLES = [
  "courses",
  "modules", 
  "lessons",
  "curricula",
  "learning_fields",
  "competencies",
  "exam_blueprints",
  "exam_questions",
  "course_packages",
  "certification_catalog",
  "user_progress",
  "exam_sessions",
  "exam_answers",
  "orders",
  "seats",
  "enterprise_accounts",
  "profiles",
  "user_roles",
  "handbook_sections",
  "oral_exam_blueprints",
] as const;

// Tables to fully export (small, critical config tables)
const EXPORT_TABLES = [
  "certification_catalog",
  "curricula",
  "learning_fields",
  "competencies",
  "exam_blueprints",
  "course_packages",
  "user_roles",
  "enterprise_accounts",
  "feature_flags",
  "auto_heal_policies",
  "ai_worker_policies",
  "model_routing_rules",
] as const;

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().replace(/[:.]/g, "-");

    // 1. Count rows in all critical tables
    const rowCounts: Record<string, number> = {};
    const countPromises = CRITICAL_TABLES.map(async (table) => {
      const { count, error } = await sb
        .from(table)
        .select("*", { count: "exact", head: true });
      rowCounts[table] = error ? -1 : (count ?? 0);
    });
    await Promise.all(countPromises);

    // 2. Export critical config tables to storage
    const exportResults: Record<string, { rows: number; error?: string }> = {};
    
    // Ensure backup bucket exists
    await sb.storage.createBucket("backups", { 
      public: false,
      fileSizeLimit: 52428800, // 50MB
    }).catch(() => { /* bucket may already exist */ });

    for (const table of EXPORT_TABLES) {
      try {
        const { data, error } = await sb.from(table).select("*").limit(10000);
        if (error) {
          exportResults[table] = { rows: 0, error: error.message };
          continue;
        }
        
        const jsonContent = JSON.stringify(data, null, 2);
        const filePath = `${dateStr}/${table}_${timeStr}.json`;
        
        const { error: uploadError } = await sb.storage
          .from("backups")
          .upload(filePath, new Blob([jsonContent], { type: "application/json" }), {
            contentType: "application/json",
            upsert: true,
          });

        exportResults[table] = {
          rows: data.length,
          error: uploadError?.message,
        };
      } catch (err) {
        exportResults[table] = { rows: 0, error: String(err) };
      }
    }

    // 3. Calculate approximate size
    const totalRows = Object.values(rowCounts).reduce((a, b) => a + Math.max(b, 0), 0);
    const sizeEstimateMb = Math.round(totalRows * 0.5 / 1024 * 100) / 100; // rough estimate

    // 4. Log the snapshot
    const { error: insertError } = await sb.from("backup_snapshots").insert({
      backup_type: "scheduled",
      tables_backed_up: [...EXPORT_TABLES],
      row_counts: rowCounts,
      size_estimate_mb: sizeEstimateMb,
      status: "completed",
      triggered_by: "cron",
    });

    // 5. Clean old backups (keep last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const { data: oldFiles } = await sb.storage.from("backups").list("", { limit: 1000 });
    if (oldFiles) {
      const oldFolders = oldFiles
        .filter(f => f.name < thirtyDaysAgo.toISOString().split("T")[0])
        .map(f => f.name);
      
      for (const folder of oldFolders) {
        const { data: files } = await sb.storage.from("backups").list(folder);
        if (files?.length) {
          await sb.storage.from("backups").remove(files.map(f => `${folder}/${f.name}`));
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      date: dateStr,
      row_counts: rowCounts,
      exports: exportResults,
      total_rows: totalRows,
      size_estimate_mb: sizeEstimateMb,
      insert_error: insertError?.message || null,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[db-backup-snapshot] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

