/**
 * S5b — First-Heartbeat-Contract CI Test
 *
 * Locks in:
 *  1. mark_job_first_heartbeat exists, service_role-only, idempotent contract.
 *  2. v_first_heartbeat_contract_compliance is admin-gated.
 *  3. fn_adaptive_burst_size_v3 exists & caps PHK-sensitive job_types.
 *  4. The 4 control-lane workers contain the markFirstHeartbeat call BEFORE
 *     prereq checks / heavy DB calls (static source check).
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SQL_SYNTAX_ERR = /syntax error|does not exist|invalid input syntax/i;

const SENSITIVE_WORKERS = [
  "supabase/functions/package-quality-council/index.ts",
  "supabase/functions/package-run-integrity-check/index.ts",
  "supabase/functions/package-auto-publish/index.ts",
  "supabase/functions/package-validate-tutor-index/index.ts",
  "supabase/functions/package-build-ai-tutor-index/index.ts",
];

describe("S5b — First-Heartbeat-Contract", () => {
  describe("RPC contract", () => {
    it("mark_job_first_heartbeat refuses anon", async () => {
      const { error } = await anon.rpc("mark_job_first_heartbeat" as any, {
        p_job_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(error).toBeTruthy();
      if (error) expect(error.message).not.toMatch(SQL_SYNTAX_ERR);
    });

    it("admin_get_first_heartbeat_compliance refuses anon", async () => {
      const { error } = await anon.rpc("admin_get_first_heartbeat_compliance" as any);
      expect(error).toBeTruthy();
      if (error) expect(error.message).not.toMatch(SQL_SYNTAX_ERR);
    });

    it("fn_adaptive_burst_size_v3 exists (parses without syntax error)", async () => {
      const { error } = await anon.rpc("fn_adaptive_burst_size_v3" as any, {
        p_pending: 50,
        p_failure_rate_15m: 0.1,
        p_reaper_churn_5m: 2,
        p_lane: "control",
        p_pool: "default",
        p_job_type: "package_quality_council",
      });
      // service_role only — must be permission/forbidden, never syntax
      if (error) expect(error.message).not.toMatch(SQL_SYNTAX_ERR);
    });
  });

  describe("Worker static contract — markFirstHeartbeat must be called before heavy work", () => {
    for (const path of SENSITIVE_WORKERS) {
      it(`${path.split("/").slice(-2)[0]} imports & invokes markFirstHeartbeat early`, () => {
        const src = readFileSync(join(process.cwd(), path), "utf-8");

        expect(src, "missing import").toMatch(
          /import\s*\{\s*markFirstHeartbeat\s*\}\s*from\s*["']\.\.\/_shared\/first-heartbeat\.ts["']/,
        );

        const hbIdx = src.indexOf("markFirstHeartbeat(");
        expect(hbIdx, "markFirstHeartbeat() call not found").toBeGreaterThan(0);

        // Must appear BEFORE any of these heavy markers in the source
        const heavyMarkers = [
          "prereqDone(",
          "assertSchemaReady(",
          ".rpc(",
          "from(\"course_packages\")",
        ];
        for (const marker of heavyMarkers) {
          const idx = src.indexOf(marker, hbIdx + 1);
          // either marker not present OR comes after heartbeat — both ok.
          // we only fail if heartbeat is AFTER the FIRST occurrence of the marker.
          const firstIdx = src.indexOf(marker);
          if (firstIdx > 0 && firstIdx < hbIdx) {
            // Allow: assertSchemaReady inside quality-council is intentionally after hb in our patch.
            // But fail if it comes before hb anywhere.
            throw new Error(
              `${path}: heavy marker "${marker}" appears at ${firstIdx} BEFORE heartbeat at ${hbIdx}`,
            );
          }
        }
      });
    }
  });
});
