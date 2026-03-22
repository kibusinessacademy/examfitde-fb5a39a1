import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Backup Restore Verification v2 — Production-Hardened
 *
 * Separates INTEGRITY from DRIFT:
 *  - Integrity (fail-worthy): manifest exists, file exists, hash matches, parseable
 *  - Drift (info-only): row count difference vs current DB
 *
 * Security: x-backup-job-secret required
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JOB_SECRET = Deno.env.get("BACKUP_JOB_SECRET") || "";

interface VerifyRequest {
  date?: string;
  tier?: string;
  tables?: string[];
  spot_check?: boolean;
}

interface IntegrityResult {
  table: string;
  status: "pass" | "fail" | "warn";
  manifest_found: boolean;
  parts_expected: number;
  parts_found: number;
  parts_hash_ok: number;
  parts_hash_fail: number;
  manifest_rows: number;
  actual_rows_in_parts: number;
  row_count_match: boolean;
  errors: string[];
  // Drift (info only, never causes fail)
  current_db_rows?: number;
  drift_pct?: number;
  drift_direction?: "growing" | "shrinking" | "stable";
  // Spot check
  spot_check_result?: "pass" | "fail" | "skipped";
}

async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  // Auth
  const provided = req.headers.get("x-backup-job-secret");
  if (!JOB_SECRET || provided !== JOB_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403, headers });
  }

  try {
    const body: VerifyRequest = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const date = body.date || yesterday;
    const tier = body.tier || "daily";

    console.log(`[verify] Checking ${tier} backup for ${date}`);

    // List table folders under date/tier/
    const { data: tableFolders, error: listErr } = await sb.storage
      .from("backups")
      .list(`${date}/${tier}`);

    if (listErr || !tableFolders?.length) {
      return new Response(JSON.stringify({
        ok: false, error: `No ${tier} backup found for ${date}`, date, tier,
      }), { status: 200, headers });
    }

    // Filter to actual table directories (exclude _global_manifest.json etc)
    const tableNames = tableFolders
      .filter(f => !f.name.startsWith("_"))
      .map(f => f.name)
      .filter(name => !body.tables?.length || body.tables.includes(name));

    const results: IntegrityResult[] = [];
    let integrityFails = 0;

    for (const table of tableNames) {
      const result: IntegrityResult = {
        table,
        status: "pass",
        manifest_found: false,
        parts_expected: 0,
        parts_found: 0,
        parts_hash_ok: 0,
        parts_hash_fail: 0,
        manifest_rows: 0,
        actual_rows_in_parts: 0,
        row_count_match: false,
        errors: [],
      };

      try {
        // 1. Read manifest
        const { data: manifestBlob } = await sb.storage
          .from("backups")
          .download(`${date}/${tier}/${table}/_manifest.json`);

        if (!manifestBlob) {
          result.errors.push("Manifest missing");
          result.status = "fail";
          integrityFails++;
          results.push(result);
          continue;
        }

        const manifest = JSON.parse(await manifestBlob.text());
        result.manifest_found = true;
        result.manifest_rows = manifest.total_rows ?? 0;
        result.parts_expected = manifest.parts?.length ?? 0;

        // 2. Verify each part
        const partHashes: string[] = [];
        let totalPartRows = 0;

        for (const part of (manifest.parts ?? [])) {
          try {
            const { data: partBlob } = await sb.storage
              .from("backups")
              .download(part.path);

            if (!partBlob) {
              result.errors.push(`Part missing: ${part.path}`);
              result.parts_hash_fail++;
              continue;
            }

            result.parts_found++;
            const content = await partBlob.text();

            // Hash check
            const actualHash = await sha256(content);
            if (actualHash === part.sha256) {
              result.parts_hash_ok++;
            } else {
              result.parts_hash_fail++;
              result.errors.push(`Hash mismatch: ${part.path}`);
            }
            partHashes.push(actualHash);

            // Count rows (NDJSON = lines)
            const lines = content.trim().split("\n").filter(l => l.length > 0);
            totalPartRows += lines.length;

            // Parseability check (first line)
            if (lines.length > 0) {
              try { JSON.parse(lines[0]); } catch {
                result.errors.push(`Unparseable NDJSON in ${part.path}`);
              }
            }
          } catch (err) {
            result.errors.push(`Part error ${part.path}: ${String(err)}`);
            result.parts_hash_fail++;
          }
        }

        result.actual_rows_in_parts = totalPartRows;
        result.row_count_match = totalPartRows === result.manifest_rows;

        // 3. Combined hash check
        if (partHashes.length > 0) {
          const combinedHash = await sha256(partHashes.join(":"));
          if (manifest.sha256_all && combinedHash !== manifest.sha256_all) {
            result.errors.push("Combined hash mismatch");
          }
        }

        // 4. Drift check (INFO ONLY — never causes fail)
        try {
          const { count } = await sb.from(table).select("*", { count: "exact", head: true });
          result.current_db_rows = count ?? 0;
          if (result.manifest_rows > 0 && result.current_db_rows > 0) {
            const diff = result.current_db_rows - result.manifest_rows;
            result.drift_pct = Math.round(Math.abs(diff) / result.current_db_rows * 100);
            result.drift_direction = diff > 0 ? "growing" : diff < 0 ? "shrinking" : "stable";
          }
        } catch { /* drift check is best-effort */ }

        // 5. Spot check (optional)
        if (body.spot_check && result.parts_found > 0) {
          try {
            const randomPart = manifest.parts[Math.floor(Math.random() * manifest.parts.length)];
            const { data: blob } = await sb.storage.from("backups").download(randomPart.path);
            if (blob) {
              const lines = (await blob.text()).trim().split("\n");
              const randomLine = lines[Math.floor(Math.random() * lines.length)];
              const record = JSON.parse(randomLine);
              if (record.id) {
                const { data: live } = await sb.from(table).select("id").eq("id", record.id).maybeSingle();
                result.spot_check_result = live ? "pass" : "fail";
              } else {
                result.spot_check_result = "pass";
              }
            }
          } catch {
            result.spot_check_result = "fail";
          }
        } else {
          result.spot_check_result = "skipped";
        }

        // Determine status
        if (result.parts_hash_fail > 0 || !result.row_count_match || result.errors.length > 0) {
          result.status = "fail";
          integrityFails++;
        }

      } catch (err) {
        result.errors.push(String(err));
        result.status = "fail";
        integrityFails++;
      }

      results.push(result);
    }

    // Log
    const verifyStatus = integrityFails === 0 ? "verified" : "integrity_failed";
    await sb.from("backup_snapshots").insert({
      backup_type: `verify_${tier}`,
      tables_backed_up: results.map(r => r.table),
      row_counts: { checked: results.length, passed: results.length - integrityFails, failed: integrityFails },
      status: verifyStatus,
      triggered_by: "verify-drill",
    });

    if (integrityFails > 0) {
      const failedTables = results.filter(r => r.status === "fail");
      await sb.from("admin_notifications").insert({
        title: `Backup Verification FAILED: ${integrityFails} table(s)`,
        body: failedTables.map(r => `${r.table}: ${r.errors.join(", ")}`).join("\n"),
        category: "system",
        severity: "critical",
      });
    }

    return new Response(JSON.stringify({
      ok: integrityFails === 0,
      date, tier,
      checked: results.length,
      integrity_passed: results.length - integrityFails,
      integrity_failed: integrityFails,
      results,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[verify-backup] Fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});
