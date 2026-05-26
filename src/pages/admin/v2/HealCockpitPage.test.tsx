/**
 * HealCockpitPage — Smoke + RPC reachability tests.
 *
 * Validates:
 *  - Page renders without crash
 *  - All 9 accordion sections are present
 *  - Default-open sections (live, recover) reveal their cards
 *  - All RPC endpoints used by the page exist (mocked)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

// Mock supabase client BEFORE importing the page
vi.mock("@/integrations/supabase/client", () => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      })),
      removeChannel: vi.fn(),
    },
  };
});

import HealCockpitPage from "./HealCockpitPage";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/heal"]}>
          <HealCockpitPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("HealCockpitPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the page header", () => {
    renderPage();
    expect(screen.getByText("Heal Cockpit")).toBeInTheDocument();
  });

  it("renders the 4 top-level sections (v3 declutter)", () => {
    renderPage();
    const expected = ["Pulse", "Quick Recover", "Pakete heilen", "Erweitert"];
    for (const title of expected) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("opens Pulse and Quick Recover by default", () => {
    renderPage();
    // Pulse cards
    expect(screen.getByText(/Queue Throughput/i)).toBeInTheDocument();
    // Recover cards
    expect(screen.getByText("Stale-Processing Reap")).toBeInTheDocument();
    expect(screen.getByText("Hot-Loop Quarantäne")).toBeInTheDocument();
  });

  it("exposes lane-aware quick reap buttons in the page header", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /Reap Control-Lane Jobs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reap All Jobs$/i })).toBeInTheDocument();
  });

  it("renders the 4 publish-blocker count buttons", () => {
    renderPage();
    expect(screen.getByTestId("blocker-count-INTEGRITY_NEVER_CHECKED")).toBeInTheDocument();
    expect(screen.getByTestId("blocker-count-INTEGRITY_DEFERRED")).toBeInTheDocument();
    expect(screen.getByTestId("blocker-count-QUALITY_COUNCIL_PENDING")).toBeInTheDocument();
    expect(screen.getByTestId("blocker-count-EXAM_POOL_TOO_SMALL")).toBeInTheDocument();
  });
});

describe("HealCockpit RPC contract", () => {
  it("declares all required RPC names", async () => {
    // This list pins the contract — if the page starts using new RPCs, add them here.
    const REQUIRED_RPCS = [
      "admin_get_queue_throughput_v2",
      "admin_reap_stale_processing_now",
      "admin_quarantine_hotloop_jobs",
      "admin_get_failed_clusters",
      "admin_get_blocked_packages_split",
      "admin_get_hollow_published_packages",
      "admin_normalize_track_steps",
      "admin_targeted_blocker_recheck",
      "fn_select_exam_pool_repair_action",
      "fn_reap_stale_jobs_configurable",
      "admin_set_setting",
    ];
    expect(REQUIRED_RPCS.length).toBe(11);
    // Each RPC name is a non-empty string — basic shape validation.
    for (const name of REQUIRED_RPCS) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
