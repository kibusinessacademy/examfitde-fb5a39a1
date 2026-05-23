import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import PlatformConsciencePage from "@/pages/admin/PlatformConsciencePage";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/integrations/supabase/client";

const SUMMARY = {
  p18: {
    open_drifts: 3,
    blocked_findings: 1,
    healed_count: 5,
    rejected_count: 2,
    escalated_count: 0,
    total_count: 11,
    last_entry_at: "2026-05-23T08:00:00Z",
    last_entry_drift_type: "ssot_conflict",
    last_entry_status: "detected",
  },
  gil: {
    market_signals_total: 12,
    internal_drift_signals: 4,
    open_signals: 6,
    critical_signals: 1,
    last_signal_at: "2026-05-23T07:00:00Z",
    briefings_total: 2,
    last_briefing_at: "2026-05-22T18:00:00Z",
    last_briefing_headline: "Q2 Growth Outlook",
    open_recommendations: 7,
  },
  runtime: {
    ai_runs_total: 50,
    ai_runs_failed_7d: 2,
    ai_runs_succeeded_7d: 30,
    ai_runs_running: 0,
    last_run_at: "2026-05-23T06:00:00Z",
    policy_versions_total: 8,
    policy_versions_active: 5,
  },
  generated_at: "2026-05-23T08:30:00Z",
};

function renderHub() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PlatformConsciencePage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("PlatformConsciencePage (P20 Cut 0C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows all three pillar cards with deep links", async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: SUMMARY, error: null });

    renderHub();

    await waitFor(() => {
      expect(screen.getByTestId("pillar-p18")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pillar-gil")).toBeInTheDocument();
    expect(screen.getByTestId("pillar-runtime")).toBeInTheDocument();

    expect(screen.getByTestId("pillar-p18-link").getAttribute("href")).toBe("/admin/governance/architecture");
    expect(screen.getByTestId("pillar-gil-link").getAttribute("href")).toBe("/admin/growth-intelligence");
    expect(screen.getByTestId("pillar-runtime-link").getAttribute("href")).toBe("/admin/runtime");
  });

  it("renders KPIs from the summary RPC and contains no action buttons", async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: SUMMARY, error: null });

    renderHub();

    await waitFor(() => expect(screen.getByText(/Q2 Growth Outlook/)).toBeInTheDocument());
    expect(screen.getByText("Open drifts")).toBeInTheDocument();
    expect(screen.getByText("Market signals")).toBeInTheDocument();
    expect(screen.getByText("AI runs total")).toBeInTheDocument();

    // read-only: no <button> elements should exist on the hub.
    expect(document.querySelectorAll("button").length).toBe(0);
  });

  it("renders an error state when the RPC fails", async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });

    renderHub();

    await waitFor(() =>
      expect(screen.getByText(/konnte nicht geladen werden/i)).toBeInTheDocument(),
    );
  });

  it("calls the admin_get_platform_conscience_summary RPC exactly once", async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: SUMMARY, error: null });

    renderHub();

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("admin_get_platform_conscience_summary"),
    );
  });
});
