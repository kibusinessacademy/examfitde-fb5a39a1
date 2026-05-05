/**
 * RecurringPatternsCard — Snooze-Fallback bei active_recommendation_id = NULL.
 *
 * Resolve UND Dismiss müssen `admin_heal_pattern_snooze` aufrufen, wenn keine
 * Recommendation existiert (Pattern stammt direkt aus auto_heal_log).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { RecurringPatternsCard } from "../RecurringPatternsCard";

// --- Supabase client mock --------------------------------------------------
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: vi.fn() },
  },
}));

// sonner toast no-op
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const NO_RECO_PATTERN = {
  pattern_key: "pk-no-reco",
  cluster: "zombie_detected_hard_stalled",
  target_id: "tgt-1",
  package_id: "pkg-1",
  package_title: "AWS Cloud Practitioner",
  package_status: "building",
  severity_score: 88,
  recurrence_24h: 12,
  escalation_rate_pct: 70,
  blocked_reason: null,
  package_last_error: null,
  dominant_error: null,
  active_recommendation_id: null, // ← critical
  recommendation_confidence: null,
  recommendation_root_cause: null,
  recommendation_permanent_fix: null,
  has_active_recommendation: false,
  prior_heal_attempts: 5,
};

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RecurringPatternsCard limit={5} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function defaultRpc(name: string) {
  if (name === "admin_heal_next_best_action") {
    return Promise.resolve({ data: [NO_RECO_PATTERN], error: null });
  }
  if (name === "admin_heal_pattern_snooze") {
    return Promise.resolve({ data: { ok: true }, error: null });
  }
  return Promise.resolve({ data: null, error: null });
}

describe("RecurringPatternsCard — snooze fallback (no active_recommendation_id)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockImplementation((name: string) => defaultRpc(name));
  });

  async function clickButton(buttonName: RegExp) {
    renderCard();
    await waitFor(() =>
      expect(screen.getByText("AWS Cloud Practitioner")).toBeInTheDocument(),
    );
    const btn = await screen.findByRole("button", { name: buttonName });
    await userEvent.click(btn);
  }

  it("invokes admin_heal_pattern_snooze on Resolve when no recommendation exists", async () => {
    await clickButton(/als gelöst markieren|gelöst|resolve/i);

    await waitFor(() => {
      const calls = rpcMock.mock.calls.map((c) => c[0]);
      expect(calls).toContain("admin_heal_pattern_snooze");
    });

    const snoozeCall = rpcMock.mock.calls.find(
      (c) => c[0] === "admin_heal_pattern_snooze",
    );
    expect(snoozeCall?.[1]).toMatchObject({
      p_cluster: "zombie_detected_hard_stalled",
      p_target_id: "tgt-1",
    });
    // never called the recommendation-bound RPC
    expect(rpcMock.mock.calls.find((c) => c[0] === "admin_heal_pattern_mark_resolved")).toBeUndefined();
  });

  it("invokes admin_heal_pattern_snooze on Dismiss when no recommendation exists", async () => {
    await clickButton(/verwerfen|dismiss/i);

    await waitFor(() => {
      const calls = rpcMock.mock.calls.map((c) => c[0]);
      expect(calls).toContain("admin_heal_pattern_snooze");
    });

    expect(
      rpcMock.mock.calls.find((c) => c[0] === "admin_heal_pattern_dismiss"),
    ).toBeUndefined();
  });
});
