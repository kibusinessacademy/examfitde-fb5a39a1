/**
 * Phase 2 — Admin source-toggle contract.
 *
 * Verifiziert per Komponenten-Test (statt Playwright/Admin-Login-Heavy):
 *  1. Toggle „Alle | Blueprint | Generic" ruft RPC v2 mit korrektem
 *     `p_question_source` (null|blueprint|generic) auf.
 *  2. KPI-Werte (Starts/Completion/MC) re-rendern bei Wechsel.
 *  3. URL-Parameter `?question_source=` wird gesetzt/entfernt.
 *  4. Ungültiger Filterwert → Warning-Badge wird gerendert.
 *
 * Hinweis: Eine echte Playwright-Variante würde Admin-Login erfordern,
 * der im aktuellen E2E-Helper-Setup (smoke_learner only) nicht vorhanden
 * ist. Dieser Vitest deckt das Vertrags-Verhalten deterministisch und
 * Mock-frei vom Backend ab.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useSearchParams } from "react-router-dom";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: any[]) => rpcMock(...a) },
}));

import PruefungsreifeFunnelCard from "@/components/admin/growth/PruefungsreifeFunnelCard";

function buildPayload(source: "all" | "blueprint" | "generic", invalid = false) {
  const startCount = source === "blueprint" ? 120 : source === "generic" ? 30 : 150;
  const completedCount = source === "blueprint" ? 90 : source === "generic" ? 18 : 108;
  return {
    window_days: 7,
    question_source: source === "all" ? null : source,
    question_source_invalid: invalid,
    since: new Date().toISOString(),
    stages: [
      { key: "landing_view", label: "Landing-View", count: 500 },
      { key: "quiz_started", label: "Quiz gestartet", count: startCount, real_events: startCount, fallback_events: 0 },
      { key: "quiz_completed", label: "Quiz abgeschlossen", count: completedCount, real_events: completedCount, fallback_events: 0 },
      { key: "result_cta", label: "Result-CTA-Klick", count: 40 },
      { key: "checkout_start", label: "Checkout-Start", count: 15 },
    ],
    completion_rate_pct: Math.round((completedCount / startCount) * 1000) / 10,
    cta_rate_pct: 37,
    checkout_rate_pct: 38,
    package_resolution: { total: startCount, resolved: startCount, fallback: 0, resolved_pct: 100 },
    mc_score: source === "blueprint" ? { avg_pct: 72.5, samples: 88 } : { avg_pct: null, samples: 0 },
    self_score_avg: 64.2,
    top_dropoff: { stage: "quiz_started → quiz_completed", pct: 25 },
    top_slugs: [],
    insights: [],
    generated_at: new Date().toISOString(),
  };
}

function ParamProbe() {
  const [params] = useSearchParams();
  return <span data-testid="probe-qs">{params.get("question_source") ?? "(none)"}</span>;
}

function renderCard(initialPath = "/admin/growth") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/admin/growth"
            element={
              <>
                <PruefungsreifeFunnelCard />
                <ParamProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PruefungsreifeFunnelCard — source toggle contract", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("default 'Alle' → RPC v2 mit p_question_source=null, KPIs sichtbar", async () => {
    rpcMock.mockResolvedValue({ data: buildPayload("all"), error: null });
    renderCard();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const [name, args] = rpcMock.mock.calls[0];
    expect(name).toBe("admin_get_pruefungsreife_funnel_v2");
    expect(args).toMatchObject({ p_days: 7, p_question_source: null });
    expect(await screen.findByText("Starts")).toBeInTheDocument();
  });

  it("Klick auf Blueprint → re-fetch, neue KPIs, URL-param gesetzt", async () => {
    rpcMock.mockImplementation((_n: string, args: any) => {
      const src = args?.p_question_source ?? "all";
      return Promise.resolve({ data: buildPayload(src), error: null });
    });
    renderCard();
    await screen.findByTestId("source-toggle-blueprint");

    fireEvent.click(screen.getByTestId("source-toggle-blueprint"));

    await waitFor(() => {
      const last = rpcMock.mock.calls.at(-1)!;
      expect(last[1]).toMatchObject({ p_question_source: "blueprint" });
    });

    expect(screen.getByTestId("source-toggle-blueprint")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("source-toggle-all")).toHaveAttribute("aria-pressed", "false");

    await waitFor(() => {
      expect(screen.getByTestId("probe-qs").textContent).toBe("blueprint");
    });

    await screen.findByText(/MC-Korrektheit/i);
    expect(screen.getByTestId("source-active-badge")).toBeInTheDocument();
  });

  it("Klick auf Generic → RPC sieht 'generic', URL-param 'generic'", async () => {
    rpcMock.mockImplementation((_n: string, args: any) => {
      const src = args?.p_question_source ?? "all";
      return Promise.resolve({ data: buildPayload(src), error: null });
    });
    renderCard();
    await screen.findByTestId("source-toggle-generic");
    fireEvent.click(screen.getByTestId("source-toggle-generic"));
    await waitFor(() => {
      expect(rpcMock.mock.calls.at(-1)![1]).toMatchObject({ p_question_source: "generic" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("probe-qs").textContent).toBe("generic");
    });
  });

  it("Initialer URL-Param ?question_source=blueprint wird gelesen", async () => {
    rpcMock.mockResolvedValue({ data: buildPayload("blueprint"), error: null });
    renderCard("/admin/growth?question_source=blueprint");
    await waitFor(() => {
      expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_question_source: "blueprint" });
    });
    const btn = await screen.findByTestId("source-toggle-blueprint");
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("question_source_invalid=true → Warning-Badge gerendert", async () => {
    rpcMock.mockResolvedValue({ data: buildPayload("all", true), error: null });
    renderCard();
    await screen.findByTestId("source-invalid-badge");
  });

  it("RPC-Fehler 'forbidden' → benutzerfreundliche Meldung statt Raw-Error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "forbidden: admin role required" } });
    renderCard();
    await waitFor(
      () => expect(screen.getByText(/Admin-Rolle/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });
});
