/**
 * SeoRollbackDialog — Telemetry + Filter behavior.
 *
 * Covers Step 4/5 of the SEO Rollback wave:
 *  - Telemetry RPC is called on open and renders 24h / 7d / Score / Last
 *  - Filter inputs (min Score, error_code, hard_fail_only) trigger the
 *    integrity-failure RPC with the expected params (after 300 ms debounce)
 *  - Reset clears all filters and re-issues the RPC without filter params
 *  - The integrity-failure RPC is gated by debounce (no extra calls per keystroke)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SeoRollbackDialog } from "../SeoRollbackDialog";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const FLAG = "seo_sitemap_refresh_producer_enabled";

function setupRpc() {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "admin_get_recent_integrity_gate_failures") {
      return Promise.resolve({ data: [], error: null });
    }
    if (fn === "admin_get_seo_toggle_telemetry") {
      return Promise.resolve({
        data: [{
          flag_key: FLAG,
          toggles_24h: 2,
          toggles_7d: 5,
          enable_count_7d: 3,
          disable_count_7d: 2,
          last_toggle_at: new Date("2026-05-11T10:00:00Z").toISOString(),
          last_toggle_actor: "admin@examfit.de",
          last_toggle_direction: "disable",
          rollback_frequency_score: 0.42,
        }],
        error: null,
      });
    }
    if (fn === "admin_get_seo_feature_flag_toggle_log") {
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SeoRollbackDialog
        open
        onOpenChange={() => {}}
        flagKey={FLAG}
        currentEnabled={true}
      />
    </QueryClientProvider>,
  );
}

function failureCalls() {
  return rpcMock.mock.calls.filter(
    (c) => c[0] === "admin_get_recent_integrity_gate_failures",
  );
}
function lastFailureParams(): Record<string, unknown> {
  const calls = failureCalls();
  return (calls[calls.length - 1]?.[1] ?? {}) as Record<string, unknown>;
}

describe("SeoRollbackDialog — Telemetry + Filters", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    setupRpc();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads telemetry on open and shows 24h/7d/Score", async () => {
    renderDialog();
    await waitFor(() =>
      expect(
        rpcMock.mock.calls.some((c) => c[0] === "admin_get_seo_toggle_telemetry"),
      ).toBe(true),
    );
    expect(await screen.findByText(/Toggle-Telemetrie/i)).toBeInTheDocument();
    expect(screen.getByText("24h:")).toBeInTheDocument();
    expect(screen.getByText("7d:")).toBeInTheDocument();
    expect(screen.getByText("Score:")).toBeInTheDocument();
    // 24h count + 7d count rendered
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // score formatted to 2 decimals
    expect(screen.getByText("0.42")).toBeInTheDocument();
    // telemetry RPC was called with the flag key
    const tel = rpcMock.mock.calls.find(
      (c) => c[0] === "admin_get_seo_toggle_telemetry",
    );
    expect(tel?.[1]).toMatchObject({ p_flag_key: FLAG });
  });

  it("issues unfiltered failure RPC on first load", async () => {
    renderDialog();
    await waitFor(() => expect(failureCalls().length).toBeGreaterThan(0));
    expect(lastFailureParams()).toEqual({ p_limit: 10, p_window_minutes: 60 });
  });

  it("debounces score input → exactly one new failure RPC after 300ms", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDialog();
    await waitFor(() => expect(failureCalls().length).toBeGreaterThan(0));
    const baseline = failureCalls().length;

    const input = screen.getByLabelText(/min Score/i);
    await user.type(input, "85");

    // Before debounce flush: no additional call
    expect(failureCalls().length).toBe(baseline);

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await waitFor(() => expect(failureCalls().length).toBe(baseline + 1));
    expect(lastFailureParams()).toMatchObject({
      p_limit: 10,
      p_window_minutes: 60,
      p_min_score: 85,
    });
  });

  it("hard_fail_only checkbox forwards p_hard_fail_only=true immediately", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDialog();
    await waitFor(() => expect(failureCalls().length).toBeGreaterThan(0));
    const baseline = failureCalls().length;

    await user.click(screen.getByRole("checkbox", { name: /hard_fail/i }));
    // Checkbox change is not debounced; takes effect via memo on re-render
    await waitFor(() => expect(failureCalls().length).toBe(baseline + 1));
    expect(lastFailureParams()).toMatchObject({ p_hard_fail_only: true });
  });

  it("Reset clears filters and re-issues failure RPC without filter params", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDialog();
    await waitFor(() => expect(failureCalls().length).toBeGreaterThan(0));

    // Apply filters
    await user.type(screen.getByLabelText(/min Score/i), "70");
    await user.type(screen.getByLabelText(/error_code/i), "QUALITY_THRESHOLD_NOT_MET");
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await waitFor(() => {
      const p = lastFailureParams();
      expect(p).toMatchObject({
        p_min_score: 70,
        p_error_code: "QUALITY_THRESHOLD_NOT_MET",
      });
    });

    // Reset button appears only when filters active
    const reset = screen.getByRole("button", { name: /Reset/i });
    await user.click(reset);
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => {
      const p = lastFailureParams();
      expect(p).toEqual({ p_limit: 10, p_window_minutes: 60 });
    });

    // Reset button hidden again
    expect(screen.queryByRole("button", { name: /Reset/i })).toBeNull();

    // Inputs cleared
    expect(
      (screen.getByLabelText(/min Score/i) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText(/error_code/i) as HTMLInputElement).value,
    ).toBe("");
  });

  it("ignores invalid (non-UUID) package_id input", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDialog();
    await waitFor(() => expect(failureCalls().length).toBeGreaterThan(0));
    const baseline = failureCalls().length;

    await user.type(screen.getByLabelText(/package_id/i), "not-a-uuid");
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    // Debounced state changed → re-render, but params should NOT include p_package_id.
    // We tolerate either: (a) no extra call, or (b) one extra call with no p_package_id.
    const calls = failureCalls();
    if (calls.length > baseline) {
      expect(lastFailureParams()).not.toHaveProperty("p_package_id");
    }
  });
});
