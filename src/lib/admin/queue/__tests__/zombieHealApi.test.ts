/**
 * zombieHealApi.test.ts
 * ─────────────────────
 * Test-Szenarien für ghost-locked Jobs:
 *   1. detectZombieLockedJobs erkennt locked-never-started + stale heartbeat
 *   2. healZombieLockedJob meldet step_reset=true wenn package_steps zurückgesetzt wird
 *   3. healJobsTargeted führt Batch-Heal sequentiell durch und sammelt pro job_id ein Resultat
 *   4. Bei ok=true wird step_reset korrekt durchgereicht
 *   5. Bei error wird die Fehlermeldung pro job_id beibehalten
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase client BEFORE importing the API
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import {
  detectZombieLockedJobs,
  healZombieLockedJob,
  healJobsTargeted,
  listRecentIntegrityJobs,
} from "../zombieHealApi";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("detectZombieLockedJobs", () => {
  it("erkennt ghost-locked-never-started Jobs (started_at=NULL)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          job_id: "00000000-0000-0000-0000-000000000001",
          job_type: "package_run_integrity_check",
          package_id: "10eee221-dd82-4b45-9ffd-e927c1c3c3b2",
          status: "processing",
          attempts: 7,
          locked_at: new Date(Date.now() - 60 * 60_000).toISOString(),
          started_at: null,
          last_heartbeat_at: null,
          locked_by: "job-runner-zombie",
          age_minutes: 60,
          zombie_reason: "locked_never_started",
        },
      ],
      error: null,
    });

    const res = await detectZombieLockedJobs(15);
    expect(rpcMock).toHaveBeenCalledWith(
      "admin_detect_zombie_locked_jobs",
      { _age_min: 15 },
    );
    expect(res).toHaveLength(1);
    expect(res[0].zombie_reason).toBe("locked_never_started");
    expect(res[0].started_at).toBeNull();
  });

  it("erkennt stale-heartbeat Jobs", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          job_id: "00000000-0000-0000-0000-000000000002",
          job_type: "package_validate_exam_pool",
          package_id: null,
          status: "running",
          attempts: 2,
          locked_at: new Date(Date.now() - 30 * 60_000).toISOString(),
          started_at: new Date(Date.now() - 25 * 60_000).toISOString(),
          last_heartbeat_at: new Date(Date.now() - 20 * 60_000).toISOString(),
          locked_by: "job-runner-x",
          age_minutes: 30,
          zombie_reason: "heartbeat_stale",
        },
      ],
      error: null,
    });
    const res = await detectZombieLockedJobs();
    expect(res[0].zombie_reason).toBe("heartbeat_stale");
  });

  it("propagiert Fehler", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "rpc-down" } });
    await expect(detectZombieLockedJobs()).rejects.toThrow("rpc-down");
  });
});

describe("healZombieLockedJob", () => {
  it("liefert step_reset=true wenn package_steps zurückgesetzt wurde", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ok: true, job_id: "abc", step_reset: true, step_reset_count: 1 },
      error: null,
    });

    const res = await healZombieLockedJob(
      "00000000-0000-0000-0000-000000000001",
      "test_reason",
    );
    expect(rpcMock).toHaveBeenCalledWith("admin_heal_zombie_locked_job", {
      _job_id: "00000000-0000-0000-0000-000000000001",
      _reason: "test_reason",
    });
    expect(res.ok).toBe(true);
    expect(res.step_reset).toBe(true);
  });

  it("gibt ok=false weiter wenn der Job nicht mehr locked ist", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ok: false, error: "job_not_locked", status: "done" },
      error: null,
    });
    const res = await healZombieLockedJob("xx");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("job_not_locked");
  });
});

describe("healJobsTargeted (Batch / Runbook)", () => {
  it("führt sequentielle Heals durch und liefert pro job_id ein Resultat", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: { ok: true, step_reset: true, step_reset_count: 1 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: false, error: "job_not_locked" },
        error: null,
      });

    const ids = [
      "00000000-0000-0000-0000-0000000000aa",
      "00000000-0000-0000-0000-0000000000bb",
    ];
    const res = await healJobsTargeted(ids, "runbook_test");

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ job_id: ids[0], ok: true, step_reset: true });
    expect(res[1]).toMatchObject({ job_id: ids[1], ok: false, error: "job_not_locked" });
  });

  it("fängt Exceptions pro job_id ab und schreibt sie ins Ergebnis", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const res = await healJobsTargeted(["xyz"], "test");
    expect(res[0]).toEqual({ job_id: "xyz", ok: false, error: "boom" });
  });
});

describe("listRecentIntegrityJobs", () => {
  it("baut die korrekte Query-Kette und liefert die Liste", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          id: "job-1",
          status: "processing",
          created_at: "2026-04-24T03:00:00Z",
          last_error: null,
          locked_by: "runner-1",
          attempts: 3,
        },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq2 = vi.fn().mockReturnValue({ order });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    fromMock.mockReturnValueOnce({ select });

    const res = await listRecentIntegrityJobs("pkg-123", 5);

    expect(fromMock).toHaveBeenCalledWith("job_queue");
    expect(eq1).toHaveBeenCalledWith("package_id", "pkg-123");
    expect(eq2).toHaveBeenCalledWith("job_type", "package_run_integrity_check");
    expect(limit).toHaveBeenCalledWith(5);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("job-1");
  });
});
