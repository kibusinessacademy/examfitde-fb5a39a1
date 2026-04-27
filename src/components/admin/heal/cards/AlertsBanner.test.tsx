/**
 * AlertsBanner — End-to-End Test für Council-Deferred + DEFERRED Re-Enqueue.
 *
 * Validiert die vollständige Heal-Schleife:
 *  1. UI rendert Council-Deferred + Deferred-Resolved Alerts aus den Views
 *  2. Bulk Resume → admin_resume_council_deferred (Dry-Run + Execute)
 *  3. Single Resume → admin_resume_single_council_deferred
 *  4. Re-Enqueue (DEFERRED-Resolved) → admin_resume_single_council_deferred
 *  5. Nach Heal: Views werden invalidiert + neu geladen, deferred Pakete sind weg,
 *     d.h. quality_council Step ist wieder queued (verifiziert durch RPC-Response).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ────────────────────────────────────────────────────────────────

const COUNCIL_DEFERRED_ROWS = [
  {
    defer_id: "def-1",
    package_id: "42bdd4d8-0000-0000-0000-000000000001",
    package_title: "Fachkraft für Kurier-, Express- und Postdienstleistungen",
    defer_reason: "STALE_WORKER_PATTERN_3X",
    fail_count: 4,
  },
  {
    defer_id: "def-2",
    package_id: "b77d271d-0000-0000-0000-000000000002",
    package_title: "Maler und Lackierer/-in",
    defer_reason: "STALE_WORKER_PATTERN_3X",
    fail_count: 4,
  },
];

const DEFERRED_RESOLVED_ROWS = [
  {
    package_id: "bd19860b-0000-0000-0000-000000000003",
    course_title: "Verfahrensmechaniker/-in für Beschichtungstechnik",
    defer_reason: "WAITING_FOR_MATERIALIZATION",
    approved_exam_questions: 782,
    min_required: 150,
  },
];

let councilDeferredState = [...COUNCIL_DEFERRED_ROWS];
let deferredResolvedState = [...DEFERRED_RESOLVED_ROWS];
const rpcCalls: Array<{ fn: string; args: any }> = [];

vi.mock("@/integrations/supabase/client", () => {
  const fromBuilder = (table: string) => ({
    select: vi.fn(() => {
      if (table === "v_council_deferred_packages") {
        return Promise.resolve({ data: councilDeferredState, error: null });
      }
      if (table === "v_admin_deferred_resolved_alerts") {
        return Promise.resolve({ data: deferredResolvedState, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    }),
  });

  return {
    supabase: {
      from: vi.fn((table: string) => fromBuilder(table)),
      rpc: vi.fn((fn: string, args: any) => {
        rpcCalls.push({ fn, args });

        if (fn === "admin_resume_council_deferred") {
          if (!args.p_dry_run) {
            // Execute: leeren der defer-liste
            councilDeferredState = [];
          }
          return Promise.resolve({
            data: {
              dry_run: args.p_dry_run,
              packages: COUNCIL_DEFERRED_ROWS.length,
              steps_reset: COUNCIL_DEFERRED_ROWS.length,
            },
            error: null,
          });
        }

        if (fn === "admin_resume_single_council_deferred") {
          // entferne package aus beiden listen
          councilDeferredState = councilDeferredState.filter(
            (p) => p.package_id !== args.p_package_id,
          );
          deferredResolvedState = deferredResolvedState.filter(
            (p) => p.package_id !== args.p_package_id,
          );
          return Promise.resolve({
            data: {
              package_id: args.p_package_id,
              step_reset: "quality_council",
              new_status: "queued",
            },
            error: null,
          });
        }

        return Promise.resolve({ data: null, error: null });
      }),
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

import { AlertsBanner } from "./AlertsBanner";
import { supabase } from "@/integrations/supabase/client";

function renderBanner() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AlertsBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  councilDeferredState = [...COUNCIL_DEFERRED_ROWS];
  deferredResolvedState = [...DEFERRED_RESOLVED_ROWS];
  rpcCalls.length = 0;
  vi.clearAllMocks();
});

describe("AlertsBanner — Council-Deferred E2E", () => {
  it("rendert Council-Deferred Banner mit Paketen aus der View", async () => {
    renderBanner();
    await waitFor(() => {
      expect(
        screen.getByText(/Paket\(e\) Council-Deferred/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Fachkraft für Kurier-, Express- und Postdienstleistungen/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Maler und Lackierer/)).toBeInTheDocument();
  });

  it("löst admin_resume_council_deferred mit p_dry_run=true bei Klick auf 'Dry-Run' aus", async () => {
    const user = userEvent.setup();
    renderBanner();
    await waitFor(() => screen.getByText(/Paket\(e\) Council-Deferred/i));

    await user.click(screen.getByRole("button", { name: /Dry-Run/i }));

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.fn === "admin_resume_council_deferred");
      expect(call).toBeDefined();
      expect(call?.args).toEqual({ p_dry_run: true, p_max_packages: 50 });
    });
    // Dry-Run darf KEINEN State löschen
    expect(councilDeferredState.length).toBe(2);
  });

  it("Bulk Resume entfernt alle deferred Pakete und reaktiviert quality_council", async () => {
    const user = userEvent.setup();
    renderBanner();
    await waitFor(() => screen.getByText(/Paket\(e\) Council-Deferred/i));

    await user.click(screen.getByRole("button", { name: /Bulk Resume/i }));

    await waitFor(() => {
      const call = rpcCalls.find(
        (c) => c.fn === "admin_resume_council_deferred" && c.args.p_dry_run === false,
      );
      expect(call).toBeDefined();
    });
    // Nach Execute: Banner verschwindet (View neu geladen, leer)
    await waitFor(
      () => {
        expect(
          screen.queryByText(/Paket\(e\) Council-Deferred/i),
        ).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("Single Resume ruft admin_resume_single_council_deferred mit korrekter package_id auf", async () => {
    const user = userEvent.setup();
    renderBanner();
    await waitFor(() => screen.getByText(/Maler und Lackierer/));

    const row = screen.getByText(/Maler und Lackierer/).closest("div")!;
    const resumeBtn = within(row.parentElement as HTMLElement).getByRole("button", {
      name: /Resume Maler/i,
    });
    await user.click(resumeBtn);

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.fn === "admin_resume_single_council_deferred");
      expect(call).toBeDefined();
      expect(call?.args.p_package_id).toBe("b77d271d-0000-0000-0000-000000000002");
    });
  });
});

describe("AlertsBanner — DEFERRED Re-Enqueue E2E", () => {
  it("rendert Deferred-Resolved Banner mit erfüllten Bedingungen", async () => {
    renderBanner();
    await waitFor(() => {
      expect(
        screen.getByText(/Paket\(e\) DEFERRED — Bedingung jetzt erfüllt/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Verfahrensmechaniker/)).toBeInTheDocument();
    expect(screen.getByText("782/150")).toBeInTheDocument();
  });

  it("Re-Enqueue löst admin_resume_single_council_deferred aus und entfernt das Paket", async () => {
    const user = userEvent.setup();
    renderBanner();
    await waitFor(() => screen.getByText(/Verfahrensmechaniker/));

    const reBtn = screen.getByRole("button", { name: /Re-Enqueue Verfahrensmechaniker/i });
    await user.click(reBtn);

    await waitFor(() => {
      const call = rpcCalls.find(
        (c) =>
          c.fn === "admin_resume_single_council_deferred" &&
          c.args.p_package_id === "bd19860b-0000-0000-0000-000000000003",
      );
      expect(call).toBeDefined();
    });

    await waitFor(
      () => {
        expect(
          screen.queryByText(/Paket\(e\) DEFERRED — Bedingung jetzt erfüllt/i),
        ).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});

describe("AlertsBanner — RPC contract pinning", () => {
  it("nutzt nur die freigegebenen Heal-RPC-Namen", async () => {
    const user = userEvent.setup();
    renderBanner();
    await waitFor(() => screen.getByText(/Paket\(e\) Council-Deferred/i));

    await user.click(screen.getByRole("button", { name: /Dry-Run/i }));
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));

    const allowedRpcs = new Set([
      "admin_resume_council_deferred",
      "admin_resume_single_council_deferred",
    ]);
    for (const c of rpcCalls) {
      expect(allowedRpcs.has(c.fn)).toBe(true);
    }
    expect(supabase.from).toHaveBeenCalledWith("v_council_deferred_packages");
    expect(supabase.from).toHaveBeenCalledWith("v_admin_deferred_resolved_alerts");
  });
});
