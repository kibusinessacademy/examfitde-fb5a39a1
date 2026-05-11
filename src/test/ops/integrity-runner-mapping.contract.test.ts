/**
 * Contract: Integrity Runner Mapping (v2)
 *
 * Guarantees that:
 *  1. job-runner has an integrity-gate-fail branch that maps
 *     ok:true + integrity_passed:false → status='failed' + QUALITY_THRESHOLD_NOT_MET.
 *  2. The materialization-guard does NOT overwrite that finalState.
 *  3. The terminal job_queue UPDATE is CAS-guarded (.eq("status","processing")).
 *  4. The integrity worker exposes integrity_passed at the TOP LEVEL of its JSON
 *     response and writes step.status='failed' (not 'done') when the gate fails.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUNNER = readFileSync("supabase/functions/job-runner/index.ts", "utf-8");
const WORKER = readFileSync("supabase/functions/package-run-integrity-check/index.ts", "utf-8");

describe("Integrity Runner Mapping v2 — contract", () => {
  it("worker returns integrity_passed at top level (not only nested in report)", () => {
    expect(WORKER).toMatch(/return json\(\s*\{[\s\S]*?integrity_passed:\s*gatePassed/);
    expect(WORKER).toMatch(/error_code:\s*gatePassed\s*\?\s*null\s*:\s*"QUALITY_THRESHOLD_NOT_MET"/);
  });

  it("worker writes step.status='failed' when gate fails (governance-trigger safe)", () => {
    expect(WORKER).toMatch(/status:\s*gatePassed\s*\?\s*"done"\s*:\s*"failed"/);
    expect(WORKER).toMatch(/QUALITY_THRESHOLD_NOT_MET:\s*score=/);
  });

  it("runner has explicit integrity-gate-fail branch in Completed handler", () => {
    expect(RUNNER).toMatch(/INTEGRITY GATE ROUTING/i);
    expect(RUNNER).toMatch(/job\.job_type === "package_run_integrity_check"/);
    expect(RUNNER).toMatch(/integrityPassed === false/);
    expect(RUNNER).toMatch(/error_code\s*\|\|\s*"QUALITY_THRESHOLD_NOT_MET"/);
  });

  it("runner reads integrity signal from top-level OR nested report", () => {
    // Must check both shapes — defensive against worker drift.
    expect(RUNNER).toMatch(/parsed\?\.integrity_passed/);
    expect(RUNNER).toMatch(/parsed\?\.report\?\.integrity_passed/);
  });

  it("materialization-guard skips when finalState already set", () => {
    expect(RUNNER).toMatch(/finalState \? \{ ok: true \} as any : await verifyArtifact/);
    expect(RUNNER).toMatch(/!finalState && !artifactCheck\.ok/);
    expect(RUNNER).toMatch(/else if \(!finalState\) \{[\s\S]*?status:\s*"completed"/);
  });

  it("runner terminal UPDATE is CAS-guarded against status='processing'", () => {
    // Both the primary write and the meta-less retry must include CAS.
    const casCount = (RUNNER.match(/\.eq\("id",\s*job\.id\)\s*\.eq\("status",\s*"processing"\)/g) || []).length;
    expect(casCount).toBeGreaterThanOrEqual(2);
  });

  it("runner audits CAS conflicts to auto_heal_log", () => {
    expect(RUNNER).toMatch(/action_type:\s*"complete_job_cas_conflict"/);
    expect(RUNNER).toMatch(/observed_status/);
  });

  it("invariant: ok:true + integrity_passed:false MUST NOT mark step done", () => {
    // Worker side: no unconditional status:'done' for run_integrity_check anymore.
    const integritySection = WORKER.split("Mark run_integrity_check step")[1]?.split("AUTO-ENQUEUE")[0] ?? "";
    expect(integritySection).not.toMatch(/status:\s*"done",[\s\S]{0,200}last_error:\s*gatePassed\s*\?\s*null\s*:/);
    expect(integritySection).toMatch(/status:\s*gatePassed\s*\?\s*"done"\s*:\s*"failed"/);
  });
});
