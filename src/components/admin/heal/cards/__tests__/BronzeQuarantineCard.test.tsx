/**
 * BronzeQuarantineCard unit tests.
 *
 * Covers:
 *  - buildReasonClusters: empty/null, UNKNOWN fallback, ordering, counts.
 *  - AlertDialog Re-Queue confirmation flow (no window.confirm).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BronzeQuarantineCard, buildReasonClusters } from "../BronzeQuarantineCard";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("buildReasonClusters", () => {
  it("returns [] for null/undefined/empty", () => {
    expect(buildReasonClusters(null)).toEqual([]);
    expect(buildReasonClusters(undefined)).toEqual([]);
    expect(buildReasonClusters([])).toEqual([]);
  });

  it("maps null reason to UNKNOWN and counts", () => {
    const out = buildReasonClusters([
      { reason: null },
      { reason: undefined },
      { reason: "STALE_REAP_LOOP_TERMINAL" },
      { reason: "STALE_REAP_LOOP_TERMINAL" },
    ]);
    expect(out).toEqual([
      ["UNKNOWN", 2],
      ["STALE_REAP_LOOP_TERMINAL", 2],
    ]);
  });

  it("preserves insertion order", () => {
    const out = buildReasonClusters([
      { reason: "A" }, { reason: "B" }, { reason: "A" }, { reason: "C" },
    ]);
    expect(out.map(([k]) => k)).toEqual(["A", "B", "C"]);
  });
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BronzeQuarantineCard />
    </QueryClientProvider>,
  );
}

describe("BronzeQuarantineCard Re-Queue AlertDialog", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "admin_get_bronze_quarantine") {
        return Promise.resolve({
          data: [{
            package_id: "11111111-1111-1111-1111-111111111111",
            package_key: "pkg-test",
            title: "Testpaket",
            status: "blocked",
            reason: "STALE_REAP_LOOP_TERMINAL",
            since: new Date().toISOString(),
            occurrences: 1,
            source_job_type: "package_quality_council",
            last_error_excerpt: "STALE_REAP_LOOP_TERMINAL",
            curriculum_id: null,
            manual_bypass: false,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
  });

  it("opens AlertDialog and confirms re-queue without window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderCard();
    await waitFor(() => screen.getByTestId("bronze-quarantine-list"));

    await userEvent.click(screen.getByTestId("bronze-quarantine-requeue-btn"));
    const confirmBtn = await screen.findByTestId("bronze-quarantine-requeue-confirm");
    await userEvent.click(confirmBtn);

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "admin_requeue_bronze_quarantine",
        expect.objectContaining({ p_package_id: "11111111-1111-1111-1111-111111111111" }),
      ),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
