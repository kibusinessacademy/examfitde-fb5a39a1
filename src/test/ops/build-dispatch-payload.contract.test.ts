import { describe, it, expect } from "vitest";
import { buildDispatchPayload } from "../../../supabase/functions/_shared/build-dispatch-payload.ts";

describe("buildDispatchPayload — payload contract defaults", () => {
  const baseJob = {
    id: "00000000-0000-0000-0000-000000000001",
    job_type: "seo_internal_links",
    package_id: "11111111-1111-1111-1111-111111111111",
    curriculum_id: "22222222-2222-2222-2222-222222222222",
    course_id: null,
  };

  it('seo_internal_links: injects mode="batch" when document_id and mode are missing', () => {
    const out = buildDispatchPayload({ ...baseJob, payload: {} });
    expect(out.mode).toBe("batch");
  });

  it("seo_internal_links: preserves explicit document_id, does NOT inject mode", () => {
    const out = buildDispatchPayload({
      ...baseJob,
      payload: { document_id: "doc-123" },
    });
    expect(out.document_id).toBe("doc-123");
    expect(out.mode).toBeUndefined();
  });

  it("seo_internal_links: preserves explicit mode override", () => {
    const out = buildDispatchPayload({
      ...baseJob,
      payload: { mode: "single" },
    });
    expect(out.mode).toBe("single");
  });

  it("seo_internal_links: injects package_id/curriculum_id from top-level columns", () => {
    const out = buildDispatchPayload({ ...baseJob, payload: {} });
    expect(out.package_id).toBe(baseJob.package_id);
    expect(out.curriculum_id).toBe(baseJob.curriculum_id);
    expect(out.mode).toBe("batch");
  });

  it("non-seo_internal_links job: never injects mode/document_id", () => {
    const out = buildDispatchPayload({
      ...baseJob,
      job_type: "package_run_integrity_check",
      payload: {},
    });
    expect(out.mode).toBeUndefined();
    expect(out.document_id).toBeUndefined();
  });

  it("emits BOTH job_id and _job_id (PHK first-heartbeat contract)", () => {
    const out = buildDispatchPayload({
      ...baseJob,
      job_type: "package_run_integrity_check",
      payload: {},
    });
    // Workers' markFirstHeartbeat() reads `job_id`; without it the heartbeat
    // RPC is a silent no-op and the reaper PHK-kills the job after 3min.
    expect(out.job_id).toBe(baseJob.id);
    expect(out._job_id).toBe(baseJob.id);
    expect(out.job_type).toBe("package_run_integrity_check");
    expect(out._job_type).toBe("package_run_integrity_check");
  });
});
