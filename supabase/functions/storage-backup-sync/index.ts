import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Storage Backup Sync
 *
 * Copies files from source storage buckets to the backup bucket.
 * Creates per-bucket manifests with file hashes.
 *
 * Security: x-backup-job-secret required
 *
 * Source buckets to sync:
 *  - course-artifacts (H5P, PDFs)
 *  - exports (package exports)
 *  - handbook-pdfs
 *  - user-uploads
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JOB_SECRET = Deno.env.get("BACKUP_JOB_SECRET") || "";

const SOURCE_BUCKETS = [
  "course-artifacts",
  "exports",
  "handbook-pdfs",
  "user-uploads",
] as const;

interface SyncRequest {
  buckets?: string[];
  prefix?: string;
  dry_run?: boolean;
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  if (!JOB_SECRET || req.headers.get("x-backup-job-secret") !== JOB_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403, headers });
  }

  try {
    const body: SyncRequest = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];

    const bucketsToSync = body.buckets?.length
      ? body.buckets.filter(b => SOURCE_BUCKETS.includes(b as typeof SOURCE_BUCKETS[number]))
      : [...SOURCE_BUCKETS];

    console.log(`[storage-sync] Syncing ${bucketsToSync.length} buckets`);

    // Ensure backup bucket
    try { await sb.storage.createBucket("backups", { public: false, fileSizeLimit: 52428800 }); } catch { /* exists */ }

    const results: Record<string, {
      files_listed: number;
      files_synced: number;
      files_skipped: number;
      errors: string[];
      total_bytes: number;
    }> = {};

    for (const bucket of bucketsToSync) {
      const bucketResult = { files_listed: 0, files_synced: 0, files_skipped: 0, errors: [] as string[], total_bytes: 0 };

      try {
        // List all files in source bucket (up to 1000)
        const { data: files, error } = await sb.storage.from(bucket).list("", {
          limit: 1000,
          sortBy: { column: "updated_at", order: "desc" },
        });

        if (error) {
          bucketResult.errors.push(error.message);
          results[bucket] = bucketResult;
          continue;
        }
        if (!files) { results[bucket] = bucketResult; continue; }

        bucketResult.files_listed = files.length;

        if (body.dry_run) {
          results[bucket] = bucketResult;
          continue;
        }

        const fileManifests: Array<{ name: string; sha256: string; bytes: number; synced_at: string }> = [];

        for (const file of files) {
          if (!file.name || file.metadata?.mimetype === "application/x-directory") continue;

          try {
            // Download from source
            const { data: blob, error: dlErr } = await sb.storage.from(bucket).download(file.name);
            if (dlErr || !blob) {
              bucketResult.errors.push(`${file.name}: download failed`);
              continue;
            }

            const arrayBuf = await blob.arrayBuffer();
            const hash = await sha256(arrayBuf);
            const destPath = `storage-sync/${dateStr}/${bucket}/${file.name}`;

            // Check if already synced (by checking manifest from today)
            // For efficiency, just upload — upsert handles duplicates
            const { error: upErr } = await sb.storage.from("backups").upload(
              destPath,
              new Blob([arrayBuf], { type: file.metadata?.mimetype || "application/octet-stream" }),
              { contentType: file.metadata?.mimetype || "application/octet-stream", upsert: true },
            );

            if (upErr) {
              bucketResult.errors.push(`${file.name}: upload failed — ${upErr.message}`);
              bucketResult.files_skipped++;
            } else {
              bucketResult.files_synced++;
              bucketResult.total_bytes += arrayBuf.byteLength;
              fileManifests.push({
                name: file.name,
                sha256: hash,
                bytes: arrayBuf.byteLength,
                synced_at: now.toISOString(),
              });
            }
          } catch (err) {
            bucketResult.errors.push(`${file.name}: ${String(err)}`);
            bucketResult.files_skipped++;
          }
        }

        // Write bucket manifest
        if (fileManifests.length > 0) {
          const manifest = {
            bucket,
            date: dateStr,
            files: fileManifests.length,
            total_bytes: bucketResult.total_bytes,
            synced_at: now.toISOString(),
            entries: fileManifests,
          };
          await sb.storage.from("backups").upload(
            `storage-sync/${dateStr}/${bucket}/_manifest.json`,
            new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
            { contentType: "application/json", upsert: true },
          );
        }
      } catch (err) {
        bucketResult.errors.push(String(err));
      }

      results[bucket] = bucketResult;
    }

    // Log
    const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors.length, 0);
    const totalSynced = Object.values(results).reduce((sum, r) => sum + r.files_synced, 0);

    await sb.from("backup_snapshots").insert({
      backup_type: "storage_sync",
      tables_backed_up: bucketsToSync,
      row_counts: results,
      size_estimate_mb: Math.round(
        Object.values(results).reduce((sum, r) => sum + r.total_bytes, 0) / 1024 / 1024 * 100
      ) / 100,
      status: totalErrors > 0 ? "partial" : "completed",
      triggered_by: "cron",
    });

    if (totalErrors > 0) {
      await sb.from("admin_notifications").insert({
        title: `Storage Sync: ${totalErrors} error(s) across ${bucketsToSync.length} buckets`,
        body: Object.entries(results)
          .filter(([, r]) => r.errors.length > 0)
          .map(([b, r]) => `${b}: ${r.errors.slice(0, 3).join("; ")}`)
          .join("\n"),
        category: "system",
        severity: "warning",
      });
    }

    return new Response(JSON.stringify({
      ok: totalErrors === 0,
      date: dateStr,
      buckets_synced: bucketsToSync.length,
      files_synced: totalSynced,
      errors: totalErrors,
      results,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[storage-backup-sync] Fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});
