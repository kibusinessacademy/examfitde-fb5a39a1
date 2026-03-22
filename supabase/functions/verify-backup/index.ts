import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Backup Restore Verification
 * 
 * Performs integrity checks on existing backups:
 *  1. Verify manifest hashes match stored data
 *  2. Compare backup row counts with current DB
 *  3. Spot-check random records for data consistency
 *  4. Log results for audit trail
 * 
 * Does NOT modify production data — read-only verification.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface VerifyRequest {
  date?: string;      // YYYY-MM-DD, defaults to yesterday
  tier?: string;      // critical | daily | weekly
  tables?: string[];  // specific tables to verify
  spot_check?: boolean; // compare random records
}

interface VerifyResult {
  table: string;
  manifest_found: boolean;
  manifest_rows?: number;
  manifest_hash?: string;
  actual_hash?: string;
  hash_match?: boolean;
  current_db_rows?: number;
  drift_pct?: number;
  spot_check_passed?: boolean;
  error?: string;
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const body: VerifyRequest = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const date = body.date || yesterday;
    const tier = body.tier || "daily";

    console.log(`[verify-backup] Checking ${tier} backup for ${date}`);

    // 1. List backup files for the given date/tier
    const { data: files, error: listError } = await sb.storage
      .from("backups")
      .list(`${date}/${tier}`);

    if (listError || !files?.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: `No ${tier} backup found for ${date}`,
        date,
        tier,
      }), { status: 200, headers });
    }

    const manifestFiles = files.filter(f => f.name.startsWith("_manifest_"));
    const dataFiles = files.filter(f => !f.name.startsWith("_manifest_"));

    const results: VerifyResult[] = [];
    let totalChecked = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    // 2. Verify each manifest
    for (const mf of manifestFiles) {
      const tableName = mf.name.replace("_manifest_", "").replace(".json", "");
      
      if (body.tables?.length && !body.tables.includes(tableName)) continue;
      totalChecked++;

      const result: VerifyResult = { table: tableName, manifest_found: true };

      try {
        // Read manifest
        const { data: manifestData } = await sb.storage
          .from("backups")
          .download(`${date}/${tier}/${mf.name}`);
        
        if (!manifestData) {
          result.error = "Could not download manifest";
          result.manifest_found = false;
          results.push(result);
          totalFailed++;
          continue;
        }

        const manifest = JSON.parse(await manifestData.text());
        result.manifest_rows = manifest.rows;
        result.manifest_hash = manifest.hash;

        // Find corresponding data file
        const dataFile = dataFiles.find(f => f.name.startsWith(`${tableName}_`));
        if (!dataFile) {
          result.error = "Data file missing";
          results.push(result);
          totalFailed++;
          continue;
        }

        // Download and verify hash
        const { data: backupData } = await sb.storage
          .from("backups")
          .download(`${date}/${tier}/${dataFile.name}`);

        if (!backupData) {
          result.error = "Could not download backup data";
          results.push(result);
          totalFailed++;
          continue;
        }

        const content = await backupData.text();
        const actualHash = await hashContent(content);
        result.actual_hash = actualHash;
        result.hash_match = actualHash === manifest.hash;

        if (!result.hash_match) {
          result.error = "Hash mismatch — backup may be corrupted";
          totalFailed++;
        }

        // Compare with current DB row count
        const { count } = await sb
          .from(tableName)
          .select("*", { count: "exact", head: true });
        
        result.current_db_rows = count ?? 0;
        if (result.manifest_rows && result.current_db_rows > 0) {
          result.drift_pct = Math.round(
            Math.abs(result.current_db_rows - result.manifest_rows) / 
            result.current_db_rows * 100
          );
        }

        // Spot-check: verify random records exist in backup
        if (body.spot_check && result.hash_match) {
          try {
            const backupRecords = JSON.parse(content);
            if (Array.isArray(backupRecords) && backupRecords.length > 0) {
              const sample = backupRecords[Math.floor(Math.random() * backupRecords.length)];
              if (sample.id) {
                const { data: liveRecord } = await sb
                  .from(tableName)
                  .select("id")
                  .eq("id", sample.id)
                  .single();
                result.spot_check_passed = !!liveRecord;
              } else {
                result.spot_check_passed = true; // no ID to check
              }
            }
          } catch {
            result.spot_check_passed = false;
          }
        }

        if (result.hash_match) totalPassed++;
        else totalFailed++;

      } catch (err) {
        result.error = String(err);
        totalFailed++;
      }

      results.push(result);
    }

    // 3. Log verification result
    const verifyStatus = totalFailed === 0 ? "verified" : "issues_found";
    await sb.from("backup_snapshots").insert({
      backup_type: `verify_${tier}`,
      tables_backed_up: results.map(r => r.table),
      row_counts: {
        checked: totalChecked,
        passed: totalPassed,
        failed: totalFailed,
        results: results,
      },
      status: verifyStatus,
      triggered_by: "verify-drill",
    });

    // 4. Alert on failures
    if (totalFailed > 0) {
      const failedTables = results.filter(r => r.error || !r.hash_match).map(r => r.table);
      await sb.from("admin_notifications").insert({
        title: `Backup Verification Failed: ${totalFailed} table(s)`,
        body: `Date: ${date}, Tier: ${tier}\nFailed: ${failedTables.join(", ")}`,
        category: "system",
        severity: "critical",
      });
    }

    return new Response(JSON.stringify({
      ok: totalFailed === 0,
      date,
      tier,
      checked: totalChecked,
      passed: totalPassed,
      failed: totalFailed,
      results,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[verify-backup] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});
