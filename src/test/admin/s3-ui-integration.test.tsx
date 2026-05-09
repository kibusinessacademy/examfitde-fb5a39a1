/**
 * Sprint S3.UI — Integration tests for new admin/learner Cards & Pages.
 *
 * Verifies:
 *  - BurstSizeSimulatorCard: rendert Inputs + Recommendation aus fn_adaptive_burst_size_v2.
 *  - GateHistoryDashboardPage: rendert Filter + Export-Buttons + Timeline-Items.
 *  - AutoPulseImpactCard: rendert Decision-Daten + window switcher.
 *  - NextBestStepCard: rendert Empfehlungen aus learner_next_best_step.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
});

describe("BurstSizeSimulatorCard", () => {
  it("rendert Inputs + Empfehlung aus fn_adaptive_burst_size_v2", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "fn_adaptive_burst_size_v2")
        return Promise.resolve({ data: 50, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const { BurstSizeSimulatorCard } = await import(
      "@/components/admin/heal/cards/BurstSizeSimulatorCard"
    );
    wrap(<BurstSizeSimulatorCard />);
    expect(screen.getByTestId("burst-input-pending")).toBeInTheDocument();
    expect(screen.getByTestId("burst-input-failure")).toBeInTheDocument();
    expect(screen.getByTestId("burst-input-churn")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("burst-recommendation").textContent).toContain("50"),
    );
    expect(rpc).toHaveBeenCalledWith(
      "fn_adaptive_burst_size_v2",
      expect.objectContaining({ p_pending: 500, p_pool: "default" }),
    );
  });
});

describe("AutoPulseImpactCard", () => {
  it("rendert Decision-Rows nach RPC-Antwort", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "admin_get_auto_pulse_impact")
        return Promise.resolve({
          data: [
            {
              decision: "PULSED",
              decisions_count: 4,
              measured_pairs: 4,
              avg_pending_delta: -100,
              avg_failure_rate_delta: -0.02,
              avg_oldest_min_delta: -5,
              avg_pending_reduction_pct: 25,
              success_count: 3,
              success_rate_pct: 75,
              total_pulsed_jobs: 100,
              last_at: new Date().toISOString(),
            },
          ],
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    });
    const { AutoPulseImpactCard } = await import(
      "@/components/admin/heal/cards/AutoPulseImpactCard"
    );
    wrap(<AutoPulseImpactCard />);
    await waitFor(() => expect(screen.getByText("PULSED")).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith(
      "admin_get_auto_pulse_impact",
      expect.objectContaining({ p_window_days: 7 }),
    );
  });
});

describe("GateHistoryDashboardPage", () => {
  it("rendert Tabs + Drift-Header + lädt Lane-Pivot", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "admin_get_gate_decision_drift")
        return Promise.resolve({
          data: [{ day: "2026-05-08", decision: "READY_TO_PUBLISH", decisions_count: 3 }],
          error: null,
        });
      if (fn === "admin_get_gate_decision_lane_pivot")
        return Promise.resolve({
          data: [
            {
              lane: "default",
              decision: "READY_TO_PUBLISH",
              current_count: 5,
              prev_count: 2,
              delta_count: 3,
              delta_pct: 150,
            },
          ],
          error: null,
        });
      return Promise.resolve({ data: [], error: null });
    });
    const { default: Page } = await import(
      "@/pages/admin/v2/GateHistoryDashboardPage"
    );
    wrap(<Page />);
    expect(screen.getByText(/Gate Decision History/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Lane-Pivot/i }));
    await waitFor(() => expect(screen.getByText("default")).toBeInTheDocument());
  });

  it("Pro-Paket-Tab zeigt Filter + deaktivierte Export-Buttons ohne Daten", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { default: Page } = await import(
      "@/pages/admin/v2/GateHistoryDashboardPage"
    );
    wrap(<Page />);
    fireEvent.click(screen.getByRole("tab", { name: /Pro Paket/i }));
    await waitFor(() => {
      expect(screen.getByTestId("gate-history-package-input")).toBeInTheDocument();
      expect(screen.getByTestId("gate-history-lane-filter")).toBeInTheDocument();
      expect(screen.getByTestId("gate-history-export-csv")).toBeDisabled();
      expect(screen.getByTestId("gate-history-export-json")).toBeDisabled();
    });
  });
});

describe("NextBestStepCard", () => {
  it("rendert Empfehlungen aus learner_next_best_step", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "learner_next_best_step")
        return Promise.resolve({
          data: [
            {
              competency_id: "c1",
              competency_title: "Marktforschung",
              recommended_action: "REPAIR",
              reason: "Mastery niedrig",
              mastery_score: 30,
              decay_score: 60,
              exam_readiness: 25,
              priority_score: 90,
              payload: null,
            },
            {
              competency_id: "c2",
              competency_title: "Kalkulation",
              recommended_action: "DRILL",
              reason: "Decay steigt",
              mastery_score: 65,
              decay_score: 40,
              exam_readiness: 55,
              priority_score: 70,
              payload: null,
            },
          ],
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    });
    const { NextBestStepCard } = await import(
      "@/features/mastery/components/NextBestStepCard"
    );
    wrap(<NextBestStepCard courseId="course-1" />);
    await waitFor(() => {
      expect(screen.getByText("Marktforschung")).toBeInTheDocument();
      expect(screen.getByText("Kalkulation")).toBeInTheDocument();
    });
    expect(screen.getAllByTestId("next-best-step-item")).toHaveLength(2);
    expect(screen.getByText("Reparieren")).toBeInTheDocument();
    expect(screen.getByText("Üben")).toBeInTheDocument();
  });
});
