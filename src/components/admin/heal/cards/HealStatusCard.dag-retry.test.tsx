/**
 * HealStatusCard — DAG-Block-Detection + Per-Step-Retry Tests
 *
 * Deckt den Heal-Flow für die 5 failed quality_council Pakete ab:
 *   1. Pakete mit aktiven (DAG-blocked) Jobs → Retry-Button disabled
 *   2. Pakete ohne aktive Jobs → Retry-Button enabled, ruft admin_retry_failed_step
 *      mit (package_id, step_key, reason='ui_per_step_retry')
 *   3. RPC-Antwort {ok:true, attempts:1} → Success-Toast + Query-Invalidation
 *   4. RPC-Antwort {skipped:true, reason:'jobs_already_running', active_jobs:N} → Warn-Toast
 *   5. Unit-Test der Skip-Logik (3-Versuche-Cap-Mirror)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { HealStatusCard } from "./HealStatusCard";

function makeBuilder(rows: unknown[]) {
  const b: any = {
    select: () => b,
    order: () => b,
    eq: () => b,
    limit: () => Promise.resolve({ data: rows, error: null }),
    then: undefined,
  };
  // also resolve when awaited directly after order()
  b.order = () => ({ ...b, then: (cb: any) => Promise.resolve({ data: rows, error: null }).then(cb) });
  return b;
}

const FAILED_COUNCIL_FIVE = [
  { package_id: "eebb9776", package_title: "Fachangestellte/-r Arbeitsmarktdienstl.", track: "AUSBILDUNG", package_status: "building", blocked_reason: null, heals_success: 0, heals_skipped: 0, heals_failed: 1, heals_total: 1, last_heal_at: "2026-05-05T05:23:03Z", last_success_at: null, last_failure_at: "2026-05-05T05:23:03Z", last_skip_at: null, last_reason: "Quality gate failed: score=89, 1 blocking rules", last_action_type: "council", failed_steps: 1, queued_steps: 0, running_steps: 0, failed_step_keys: ["quality_council"], active_jobs: 1, heal_state: "jobs_running" },
  { package_id: "adce63f4", package_title: "Fachlagerist/-in",                       track: "AUSBILDUNG", package_status: "building", blocked_reason: null, heals_success: 0, heals_skipped: 0, heals_failed: 1, heals_total: 1, last_heal_at: "2026-05-05T05:22:06Z", last_success_at: null, last_failure_at: "2026-05-05T05:22:06Z", last_skip_at: null, last_reason: "Quality gate failed: score=78, 2 blocking rules", last_action_type: "council", failed_steps: 1, queued_steps: 0, running_steps: 0, failed_step_keys: ["quality_council"], active_jobs: 0, heal_state: "has_failed_steps" },
];

function setupQueries(rows: unknown[]) {
  fromMock.mockImplementation((table: string) => {
    if (table === "v_admin_heal_status_per_package") return makeBuilder(rows);
    if (table === "v_admin_heal_status_by_track") return makeBuilder([]);
    return makeBuilder([]);
  });
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return { qc, ...render(
    <QueryClientProvider client={qc}>
      <HealStatusCard />
    </QueryClientProvider>,
  ) };
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  toastSuccess.mockReset();
  toastWarning.mockReset();
  toastError.mockReset();
});

describe("HealStatusCard · DAG-Block-Detection", () => {
  it("disables Per-Step-Retry-Button wenn aktive Pipeline-Jobs (DAG-blocked) vorhanden", async () => {
    setupQueries(FAILED_COUNCIL_FIVE);
    renderCard();

    const buttons = await screen.findAllByRole("button", { name: /quality_council/ });
    expect(buttons).toHaveLength(2);

    // Paket #1 (active_jobs=1) → disabled mit Tooltip
    expect(buttons[0]).toBeDisabled();
    expect(buttons[0].getAttribute("title")).toMatch(/Pipeline-Jobs laufen/i);

    // Paket #2 (active_jobs=0) → enabled
    expect(buttons[1]).not.toBeDisabled();
    expect(buttons[1].getAttribute("title")).toMatch(/Retry quality_council/);
  });
});

describe("HealStatusCard · Per-Step-Retry RPC-Vertrag", () => {
  it("ruft admin_retry_failed_step mit korrektem Payload für freies Paket", async () => {
    setupQueries(FAILED_COUNCIL_FIVE);
    rpcMock.mockResolvedValueOnce({ data: { ok: true, attempts: 1 }, error: null });

    renderCard();
    const buttons = await screen.findAllByRole("button", { name: /quality_council/ });
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock).toHaveBeenCalledWith(
      "admin_retry_failed_step",
      expect.objectContaining({
        p_package_id: "adce63f4",
        p_step_key: "quality_council",
        p_reason: "ui_per_step_retry",
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/quality_council retry angesto(ß|ss)en/i),
    ));
  });

  it("zeigt Warn-Toast wenn RPC mit skipped=true (jobs_already_running) antwortet", async () => {
    setupQueries(FAILED_COUNCIL_FIVE);
    rpcMock.mockResolvedValueOnce({
      data: { ok: false, skipped: true, reason: "jobs_already_running", active_jobs: 2 },
      error: null,
    });

    renderCard();
    const buttons = await screen.findAllByRole("button", { name: /quality_council/ });
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    const [title, opts] = toastWarning.mock.calls[0];
    expect(title).toMatch(/jobs_already_running/);
    expect(String(opts?.description ?? "")).toMatch(/2 aktive Jobs/);
  });
});

describe("Per-Step-Retry · 3-Versuche-Cap (Logik-Mirror)", () => {
  // Spiegelt fn_recover_failed_predecessor_steps Cap (max 3 Recovery-Versuche / 24h, 20min Cooldown)
  type Step = { auto_recovery_count: number; last_auto_recovery_at: string | null };
  const COOLDOWN_MS = 20 * 60 * 1000;
  const MAX_ATTEMPTS = 3;

  function canRetry(step: Step, now = Date.now()): { ok: boolean; reason?: string; nextAttempt?: number } {
    if (step.auto_recovery_count >= MAX_ATTEMPTS) return { ok: false, reason: "max_attempts" };
    if (step.last_auto_recovery_at) {
      const elapsed = now - new Date(step.last_auto_recovery_at).getTime();
      if (elapsed < COOLDOWN_MS) return { ok: false, reason: "cooldown" };
    }
    return { ok: true, nextAttempt: step.auto_recovery_count + 1 };
  }

  it("erlaubt attempt 1/3 für frischen Step", () => {
    expect(canRetry({ auto_recovery_count: 0, last_auto_recovery_at: null }))
      .toEqual({ ok: true, nextAttempt: 1 });
  });

  it("erlaubt attempt 2/3 nach Ablauf des Cooldowns", () => {
    const past = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(canRetry({ auto_recovery_count: 1, last_auto_recovery_at: past }))
      .toEqual({ ok: true, nextAttempt: 2 });
  });

  it("blockiert Retry innerhalb der 20min Cooldown-Phase", () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const r = canRetry({ auto_recovery_count: 1, last_auto_recovery_at: recent });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("cooldown");
  });

  it("blockiert nach 3 Versuchen (manueller Bypass nötig)", () => {
    const r = canRetry({ auto_recovery_count: 3, last_auto_recovery_at: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("max_attempts");
  });
});
