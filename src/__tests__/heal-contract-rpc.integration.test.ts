/**
 * RPC-Integrationstest: admin_test_heal_contract
 *
 * Verifiziert in einem einzigen DB-Roundtrip beide Pfade (TX-isoliert,
 * keine persistenten Mutationen):
 *   1. DAG-Block: synthetischer running-Job → admin_retry_failed_step liefert
 *      skipped=true / reason='jobs_already_running'.
 *   2. Retry: failed-Step → admin_retry_failed_step → step.status ∈ (queued|enqueued|running)
 *      + job_queue Eintrag erzeugt.
 *
 * Aktivierung: setze TEST_ADMIN_JWT + TEST_HEAL_PACKAGE_ID. Ohne diese Env-Vars
 * wird der Test übersprungen (CI-freundlich, kein Auth-Boilerplate im Repo).
 *
 * Beispiel:
 *   TEST_ADMIN_JWT=eyJ... TEST_HEAL_PACKAGE_ID=adce63f4-... bunx vitest run \
 *     src/__tests__/heal-contract-rpc.integration.test.ts
 */
import { describe, it, expect } from "vitest";

const SUPABASE_URL = "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON =
  "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G";

const JWT = process.env.TEST_ADMIN_JWT;
const PKG = process.env.TEST_HEAL_PACKAGE_ID;

const skipReason =
  !JWT || !PKG
    ? "[skip] set TEST_ADMIN_JWT + TEST_HEAL_PACKAGE_ID to run live RPC contract test"
    : null;

describe.skipIf(!!skipReason)("admin_test_heal_contract (live RPC)", () => {
  it("verifies DAG-block + retry contract end-to-end", async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_test_heal_contract`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_package_id: PKG }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Top-level
    expect(body.ok).toBe(true);
    expect(body.package_id).toBe(PKG);

    // DAG-Block-Pfad
    expect(body.dag_block.pass).toBe(true);
    expect(body.dag_block.rpc_result.skipped).toBe(true);
    expect(body.dag_block.rpc_result.reason).toBe("jobs_already_running");
    expect(body.dag_block.rpc_result.active_jobs).toBeGreaterThan(0);

    // Retry-Pfad
    expect(body.retry.pass).toBe(true);
    expect(body.retry.rpc_result.ok).toBe(true);
    expect(["queued", "enqueued", "running"]).toContain(body.retry.step_status_after);
    expect(body.retry.jobs_after).toBeGreaterThanOrEqual(body.retry.jobs_before);
  }, 30_000);
});

if (skipReason) {
  describe("admin_test_heal_contract (skipped)", () => {
    it.skip(skipReason!, () => {});
  });
}
