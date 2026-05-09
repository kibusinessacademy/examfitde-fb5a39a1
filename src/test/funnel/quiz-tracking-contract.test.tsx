/**
 * Phase 2 — Quiz-Tracking-Contract.
 *
 * Verträge:
 *  1. Ohne package_id → KEIN strict event (`quiz_started`/`quiz_completed`).
 *     Stattdessen `lead_magnet_view` mit `metadata.stage` ∈ {quiz_started, quiz_completed}.
 *  2. Mit package_id (Blueprint-RPC liefert ≥4 Rows) → strict events
 *     `quiz_started` + `quiz_completed` mit Pflichtfeldern packageId + persona + sourcePage.
 *  3. Allowlist-Vertrag: kanonische Funnel-Event-Namen MÜSSEN in der Edge-Allowlist stehen.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// --- Mocks BEFORE imports of SUT ---
const trackMock = vi.fn();
vi.mock("@/hooks/useTrackGrowthEvent", () => ({
  useTrackGrowthEvent: () => ({ track: trackMock }),
}));

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: any[]) => rpcMock(...a) },
}));

// HomepageCatalog hook used by usePackageResolverForSlug
const catalogMock = vi.fn();
vi.mock("@/hooks/usePublishedCourses", () => ({
  useHomepageCatalog: () => catalogMock(),
}));

// SEO + auth side-effect free
vi.mock("@/components/seo/SEOHead", () => ({ SEOHead: () => null }));

import PruefungsreifeCheckPage from "@/components/pruefungsreife/PruefungsreifeCheckPage";
import { FUNNEL_EVENTS } from "@/lib/funnelEvents";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

function renderPage(initialPath = "/pruefungsreife-check") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <PruefungsreifeCheckPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function clickThroughAllQuestions(qcount: number) {
  for (let i = 0; i < qcount; i++) {
    const btns = await screen.findAllByTestId("quiz-answer");
    fireEvent.click(btns[2]); // pick "Teilweise" (score=2)
  }
}

describe("Quiz-Tracking-Contract — Phase 2", () => {
  beforeEach(() => {
    trackMock.mockReset();
    rpcMock.mockReset();
    catalogMock.mockReset();
  });

  it("Allowlist: FUNNEL_EVENTS.QUIZ_STARTED/_COMPLETED kanonisch", () => {
    expect(FUNNEL_EVENTS.QUIZ_STARTED).toBe("quiz_started");
    expect(FUNNEL_EVENTS.QUIZ_COMPLETED).toBe("quiz_completed");
    expect(FUNNEL_EVENTS.LEAD_MAGNET_VIEW).toBe("lead_magnet_view");
  });

  it("Fallback (kein package_id): emittiert lead_magnet_view + metadata.stage, nie strict", async () => {
    catalogMock.mockReturnValue({ data: [], isLoading: false });
    rpcMock.mockResolvedValue({ data: [], error: null });
    renderPage("/pruefungsreife-check");

    fireEvent.click(await screen.findByTestId("quiz-start"));
    await waitFor(() => expect(trackMock).toHaveBeenCalled());

    const types = trackMock.mock.calls.map((c) => c[0]);
    expect(types).not.toContain("quiz_started");
    expect(types).not.toContain("quiz_completed");

    const startCall = trackMock.mock.calls.find(
      (c) => c[0] === "lead_magnet_view" && c[1]?.metadata?.stage === "quiz_started",
    );
    expect(startCall).toBeDefined();

    // Walk through 8 generic questions
    await clickThroughAllQuestions(8);

    const completeCall = trackMock.mock.calls.find(
      (c) => c[0] === "lead_magnet_view" && c[1]?.metadata?.stage === "quiz_completed",
    );
    expect(completeCall).toBeDefined();
  });

  it("Strict (mit package_id): emittiert quiz_started + quiz_completed mit packageId/persona/sourcePage", async () => {
    catalogMock.mockReturnValue({
      data: [
        {
          slug: "bankkaufmann",
          packageId: VALID_UUID,
          curriculumId: "22222222-2222-2222-2222-222222222222",
          personaProfile: "azubi",
          berufDisplayName: "Bankkaufmann",
          title: "Bankkaufmann Bundle",
        },
      ],
      isLoading: false,
    });
    // Blueprint-RPC liefert 8 Rows ohne MC (options leer → kein mc-Block)
    rpcMock.mockResolvedValue({
      data: Array.from({ length: 8 }, (_, i) => ({
        question_id: `q-${i}`,
        competency_id: `c-${i}`,
        competency_title: `Kompetenz ${i}`,
        learning_field_id: null,
        question_text: `Frage ${i}?`,
        options: [],
        correct_answer: 0,
        blueprint_id: null,
        exam_relevance_tier: "tier_1",
        sort_order: i,
      })),
      error: null,
    });

    renderPage("/pruefungsreife-check?source=beruf&slug=bankkaufmann");

    // Wait until blueprint set is loaded (headline switches to "Prüfungsreife-Check für ...")
    await screen.findByText(/Prüfungsreife-Check für/i);

    fireEvent.click(await screen.findByTestId("quiz-start"));
    await waitFor(() => {
      const types = trackMock.mock.calls.map((c) => c[0]);
      expect(types).toContain("quiz_started");
    });

    const startCall = trackMock.mock.calls.find((c) => c[0] === "quiz_started");
    expect(startCall![1].packageId).toBe(VALID_UUID);
    expect(startCall![1].persona).toBe("azubi");
    expect(typeof startCall![1].sourcePage).toBe("string");
    expect(startCall![1].metadata.question_source).toBe("blueprint");

    await clickThroughAllQuestions(8);

    const completeCall = trackMock.mock.calls.find((c) => c[0] === "quiz_completed");
    expect(completeCall).toBeDefined();
    expect(completeCall![1].packageId).toBe(VALID_UUID);
    expect(completeCall![1].metadata.score).toBeGreaterThan(0);
    // mc_score_pct soll präsent sein (auch wenn null, weil kein MC-Stage in dieser Variante)
    expect(completeCall![1].metadata).toHaveProperty("mc_score_pct");
  });
});
