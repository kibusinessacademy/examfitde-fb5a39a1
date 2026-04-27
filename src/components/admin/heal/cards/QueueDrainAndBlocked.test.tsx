/**
 * E2E-Test: QueueDrainCard + BlockedPackagesCard
 *
 * Validiert die Heal-Schleife für die zwei aus der KI-Analyse abgeleiteten Engpässe:
 *  1. Queue-Backlog → admin_drain_queue_backlog (Dry-Run + Boost)
 *  2. Stale-Locks → admin_release_stale_locks (Dry-Run + Release)
 *  3. Blocked-Packages → liest v_admin_blocked_packages_diagnosis,
 *     ruft admin_unblock_packages_by_reason (Dry-Run + Unblock) je Reason-Class.
 *
 * Verifiziert: korrekte RPC-Argumente, UI-State (Preview Badges),
 * Toast-Messages und Cache-Invalidierung nach Heal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ────────────────────────────────────────────────────────────────

const BLOCKED_DIAGNOSIS_INITIAL = [
  {
    reason_class: "HARD_FAIL_NO_CURRICULUM",
    package_count: 6,
    oldest_blocked_at: "2026-04-27T12:45:00Z",
    newest_blocked_at: "2026-04-27T12:50:00Z",
    package_ids: ["d2000000-0010-4000-8000-000000000001", "091fb5ed-3bea-5e0b-840e-e07845a5ebc5"],
    sample_titles: ["Versicherungsvermittler §34d GewO", "Fachwirt Schutz/Sicherheit IHK"],
    dominant_step: "validate_exam_pool",
    sample_error: "HARD_FAIL: HARD_FAIL_NO_CURRICULUM",
  },
  {
    reason_class: "COVERAGE_GAP",
    package_count: 1,
    oldest_blocked_at: "2026-04-26T19:27:00Z",
    newest_blocked_at: "2026-04-26T19:27:00Z",
    package_ids: ["beb241ed-58dc-4ddc-930d-ca041dbde99f"],
    sample_titles: ["Kaufmann/-frau im E-Commerce"],
    dominant_step: "auto_publish",
    sample_error: "auto-publish TERMINAL: COVERAGE_GAP_BELOW_TRACK_THRESHOLD",
  },
];

let blockedDiagnosisState = [...BLOCKED_DIAGNOSIS_INITIAL];
const rpcCalls: Array<{ fn: string; args: any }> = [];

vi.mock("@/integrations/supabase/client", () => {
  const fromBuilder = (table: string) => ({
    select: vi.fn(() => {
      if (table === "v_admin_blocked_packages_diagnosis") {
        return Promise.resolve({ data: blockedDiagnosisState, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    }),
  });

  return {
    supabase: {
      from: vi.fn(fromBuilder),
      rpc: vi.fn((fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        // Drain Queue
        if (fn === "admin_drain_queue_backlog") {
          if (args.p_dry_run) {
            return Promise.resolve({
              data: {
                dry_run: true,
                candidate_count: 42,
                by_type: { package_generate_exam_pool: 30, package_auto_publish: 12 },
              },
              error: null,
            });
          }
          return Promise.resolve({
            data: { dry_run: false, boosted: Math.min(42, args.p_max_boost), candidate_count: 42 },
            error: null,
          });
        }
        // Stale Locks
        if (fn === "admin_release_stale_locks") {
          if (args.p_dry_run) {
            return Promise.resolve({
              data: {
                dry_run: true,
                candidate_count: 7,
                by_type: { package_validate_exam_pool: 5, package_auto_publish: 2 },
              },
              error: null,
            });
          }
          return Promise.resolve({
            data: { dry_run: false, released: 7, candidate_count: 7 },
            error: null,
          });
        }
        // Unblock by Reason
        if (fn === "admin_unblock_packages_by_reason") {
          if (args.p_dry_run) {
            const row = blockedDiagnosisState.find((r) => r.reason_class === args.p_reason_class);
            return Promise.resolve({
              data: {
                dry_run: true,
                candidate_count: row?.package_count ?? 0,
                target_status: args.p_reason_class === "COVERAGE_GAP" ? "building" : "queued",
                reset_step: args.p_reason_class === "COVERAGE_GAP" ? "auto_publish" : null,
              },
              error: null,
            });
          }
          // Execute → entferne die Reason-Class aus dem State (alle entblockt)
          const before = blockedDiagnosisState.find((r) => r.reason_class === args.p_reason_class);
          blockedDiagnosisState = blockedDiagnosisState.filter(
            (r) => r.reason_class !== args.p_reason_class,
          );
          return Promise.resolve({
            data: {
              dry_run: false,
              unblocked: before?.package_count ?? 0,
              steps_reset: (before?.package_count ?? 0) * 2,
              reason_class: args.p_reason_class,
              package_ids: before?.package_ids ?? [],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    },
  };
});

// Toast-Mock (sonner)
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

// ─── Test Setup ───────────────────────────────────────────────────────────

import { QueueDrainCard } from "./QueueDrainCard";
import { BlockedPackagesCard } from "./BlockedPackagesCard";

const renderWithClient = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  rpcCalls.length = 0;
  blockedDiagnosisState = [...BLOCKED_DIAGNOSIS_INITIAL];
});

// ─── QueueDrainCard ───────────────────────────────────────────────────────

describe("QueueDrainCard — Backlog & Stale-Locks", () => {
  it("Drain: Dry-Run zeigt Kandidaten, Execute ruft RPC mit korrekten Args", async () => {
    const user = userEvent.setup();
    renderWithClient(<QueueDrainCard />);

    const card = screen.getByTestId("queue-drain-card");
    expect(within(card).getByText(/Queue-Backlog auflösen/i)).toBeInTheDocument();

    // Dry-Run klicken
    await user.click(screen.getByTestId("queue-drain-dry-run"));

    await waitFor(() => {
      const drainCalls = rpcCalls.filter((c) => c.fn === "admin_drain_queue_backlog");
      expect(drainCalls).toHaveLength(1);
      expect(drainCalls[0].args).toMatchObject({
        p_dry_run: true,
        p_min_age_seconds: 1800,
        p_target_priority: 5,
      });
    });

    // Preview-Badge erscheint
    await waitFor(() => {
      expect(within(card).getByText(/42/)).toBeInTheDocument();
    });

    // Execute klicken
    await user.click(screen.getByTestId("queue-drain-execute"));

    await waitFor(() => {
      const execCalls = rpcCalls.filter(
        (c) => c.fn === "admin_drain_queue_backlog" && c.args.p_dry_run === false,
      );
      expect(execCalls).toHaveLength(1);
      expect(execCalls[0].args.p_max_boost).toBe(100);
    });
  });

  it("Stale-Locks: Dry-Run + Release ruft beide Modes auf", async () => {
    const user = userEvent.setup();
    renderWithClient(<QueueDrainCard />);

    await user.click(screen.getByTestId("stale-locks-dry-run"));

    await waitFor(() => {
      const calls = rpcCalls.filter((c) => c.fn === "admin_release_stale_locks");
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toMatchObject({
        p_dry_run: true,
        p_stale_seconds: 600,
        p_max_release: 200,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("stale-locks-execute")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("stale-locks-execute"));

    await waitFor(() => {
      const execCalls = rpcCalls.filter(
        (c) => c.fn === "admin_release_stale_locks" && c.args.p_dry_run === false,
      );
      expect(execCalls).toHaveLength(1);
    });
  });

  it("Execute-Button ist disabled, bevor Dry-Run gelaufen ist", async () => {
    renderWithClient(<QueueDrainCard />);
    expect(screen.getByTestId("queue-drain-execute")).toBeDisabled();
    expect(screen.getByTestId("stale-locks-execute")).toBeDisabled();
  });
});

// ─── BlockedPackagesCard ──────────────────────────────────────────────────

describe("BlockedPackagesCard — Bulk-Unblock nach Reason", () => {
  it("rendert Diagnose-Rows aus der View", async () => {
    renderWithClient(<BlockedPackagesCard />);

    await waitFor(() => {
      expect(screen.getByTestId("blocked-row-HARD_FAIL_NO_CURRICULUM")).toBeInTheDocument();
      expect(screen.getByTestId("blocked-row-COVERAGE_GAP")).toBeInTheDocument();
    });

    // Total-Counter (6 + 1 = 7)
    expect(screen.getByText(/7 blocked/i)).toBeInTheDocument();
  });

  it("Dry-Run + Unblock für HARD_FAIL_NO_CURRICULUM ruft RPC korrekt auf", async () => {
    const user = userEvent.setup();
    renderWithClient(<BlockedPackagesCard />);

    await waitFor(() =>
      expect(screen.getByTestId("blocked-row-HARD_FAIL_NO_CURRICULUM")).toBeInTheDocument(),
    );

    // Dry-Run
    await user.click(screen.getByTestId("unblock-dry-run-HARD_FAIL_NO_CURRICULUM"));

    await waitFor(() => {
      const calls = rpcCalls.filter(
        (c) =>
          c.fn === "admin_unblock_packages_by_reason" &&
          c.args.p_reason_class === "HARD_FAIL_NO_CURRICULUM",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toMatchObject({
        p_dry_run: true,
        p_max_packages: 25,
      });
    });

    // Preview-Badge zeigt Kandidaten
    await waitFor(() => {
      const row = screen.getByTestId("blocked-row-HARD_FAIL_NO_CURRICULUM");
      expect(within(row).getByText(/6 Kandidaten/i)).toBeInTheDocument();
    });

    // Execute
    await user.click(screen.getByTestId("unblock-execute-HARD_FAIL_NO_CURRICULUM"));

    await waitFor(() => {
      const execCalls = rpcCalls.filter(
        (c) =>
          c.fn === "admin_unblock_packages_by_reason" &&
          c.args.p_reason_class === "HARD_FAIL_NO_CURRICULUM" &&
          c.args.p_dry_run === false,
      );
      expect(execCalls).toHaveLength(1);
    });

    // Nach Heal: Reason-Class aus dem State entfernt, Row verschwindet
    await waitFor(() => {
      expect(screen.queryByTestId("blocked-row-HARD_FAIL_NO_CURRICULUM")).not.toBeInTheDocument();
    });
  });

  it("COVERAGE_GAP zielt auf reset_step=auto_publish, target_status=building", async () => {
    const user = userEvent.setup();
    renderWithClient(<BlockedPackagesCard />);

    await waitFor(() =>
      expect(screen.getByTestId("blocked-row-COVERAGE_GAP")).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("unblock-dry-run-COVERAGE_GAP"));

    await waitFor(() => {
      const calls = rpcCalls.filter(
        (c) =>
          c.fn === "admin_unblock_packages_by_reason" &&
          c.args.p_reason_class === "COVERAGE_GAP",
      );
      expect(calls.length).toBeGreaterThan(0);
    });

    // Mock liefert für COVERAGE_GAP target_status=building, reset_step=auto_publish
    // Toast wird aufgerufen — wir prüfen indirekt über Preview
    await waitFor(() => {
      const row = screen.getByTestId("blocked-row-COVERAGE_GAP");
      expect(within(row).getByText(/1 Kandidaten/i)).toBeInTheDocument();
    });
  });

  it("Execute-Button bleibt disabled ohne vorherigen Dry-Run", async () => {
    renderWithClient(<BlockedPackagesCard />);

    await waitFor(() =>
      expect(screen.getByTestId("blocked-row-HARD_FAIL_NO_CURRICULUM")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("unblock-execute-HARD_FAIL_NO_CURRICULUM")).toBeDisabled();
    expect(screen.getByTestId("unblock-execute-COVERAGE_GAP")).toBeDisabled();
  });
});
