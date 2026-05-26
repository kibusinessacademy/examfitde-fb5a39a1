/**
 * Cut 6.1 Phase 3 — Vitest-Smoke /demo/hr
 *
 * Deckt ab:
 *  - Initial-Render + lead_magnet_view-Tracking beim Mount
 *  - Painpoint-Auswahl-Flow
 *  - SSE-Parsing: erst meta-Frame (Match-Card), dann delta-Frames (Plan-Text)
 *  - quiz_started + quiz_completed mit korrekter persona + package_id
 *  - 429-Rate-Limit-Pfad → Alert sichtbar
 *
 * Edge-Function wird über globalen fetch-Mock gestubbt; keine echten Calls.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

import DemoHrPage from "@/pages/demo/DemoHrPage";

const trackFunnelMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/conversionTracking", () => ({
  trackFunnel: (...args: any[]) => trackFunnelMock(...args),
  getAnonymousId: () => "anon-test",
  getSessionId: () => "sess-test",
}));

function makeSseStream(frames: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(enc.encode(frames[i++]));
      } else {
        controller.close();
      }
    },
  });
}

function mockOkStream(meta: Record<string, unknown>, deltas: string[]) {
  const frames: string[] = [];
  frames.push(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`);
  for (const d of deltas) {
    frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`);
  }
  frames.push("data: [DONE]\n\n");
  return {
    ok: true,
    status: 200,
    body: makeSseStream(frames),
  } as unknown as Response;
}

const renderPage = () =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/demo/hr"]}>
        <DemoHrPage />
      </MemoryRouter>
    </HelmetProvider>,
  );

beforeEach(() => {
  trackFunnelMock.mockClear();
  (global.fetch as any) = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/demo/hr — Cut 6.1 Phase 3 smoke", () => {
  it("rendert Hero + 6 Painpoint-Optionen und feuert lead_magnet_view beim Mount", async () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: /3-Schritte-Aktivierungsplan/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(6);

    await waitFor(() => expect(trackFunnelMock).toHaveBeenCalled());
    const firstCall = trackFunnelMock.mock.calls[0];
    expect(firstCall[0]).toBe("lead_magnet_view");
    expect(firstCall[1]).toMatchObject({
      source_page: "/demo/hr",
      persona: "hr",
    });
  });

  it("streamt meta + Plan-Text und feuert quiz_started/quiz_completed mit package_id", async () => {
    const pkgId = "00000000-0000-0000-0000-000000000aaa";
    (global.fetch as any).mockResolvedValueOnce(
      mockOkStream(
        {
          package_id: pkgId,
          package_title: "AEVO Komplett",
          package_key: "aevo-komplett",
          track: "EXAM_FIRST",
          matches: [
            { package_id: pkgId, package_title: "AEVO Komplett", score: 0.9 },
          ],
        },
        ["**Worum es geht** — Test. ", "1. Schritt eins · 5 Min"],
      ),
    );

    renderPage();
    await waitFor(() => expect(trackFunnelMock).toHaveBeenCalled());
    trackFunnelMock.mockClear();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Personalisierten Aktivierungsplan starten/i }),
      );
    });

    await waitFor(() => expect(screen.getByText("AEVO Komplett")).toBeInTheDocument());
    await waitFor(() => {
      const out = screen.getByTestId("demo-hr-output");
      expect(out.textContent ?? "").toContain("Schritt eins");
    });

    const types = trackFunnelMock.mock.calls.map((c) => c[0]);
    expect(types).toContain("quiz_started");
    expect(types).toContain("quiz_completed");

    const completed = trackFunnelMock.mock.calls.find((c) => c[0] === "quiz_completed");
    expect(completed?.[1]).toMatchObject({
      persona: "hr",
      package_id: pkgId,
      source_page: "/demo/hr",
    });
    expect(completed?.[1]?.metadata?.painpoint_key).toBeTruthy();
  });

  it("zeigt Rate-Limit-Hinweis bei 429-Antwort", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "rate_limited", message: "Maximal 5 Personalisierungen pro Stunde." }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderPage();
    await waitFor(() => expect(trackFunnelMock).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Personalisierten Aktivierungsplan starten/i }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText(/Maximal 5 Personalisierungen/i)).toBeInTheDocument(),
    );
  });
});
