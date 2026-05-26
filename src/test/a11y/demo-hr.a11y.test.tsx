/**
 * Cut 6.1 Phase 3 — A11y-Regression /demo/hr
 *
 * Prüft Hero/Form-Zustand (idle) und Streaming-Done-Zustand
 * (Match-Card + Plan-Text + CTA-Pfade) gegen axe.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { axe, toHaveNoViolations } from "jest-axe";

import DemoHrPage from "@/pages/demo/DemoHrPage";

expect.extend(toHaveNoViolations);

vi.mock("@/lib/conversionTracking", () => ({
  trackFunnel: vi.fn().mockResolvedValue(undefined),
  getAnonymousId: () => "anon-test",
  getSessionId: () => "sess-test",
}));

function sse(meta: object, deltas: string[]) {
  const enc = new TextEncoder();
  const frames = [
    `event: meta\ndata: ${JSON.stringify(meta)}\n\n`,
    ...deltas.map(
      (d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`,
    ),
    "data: [DONE]\n\n",
  ];
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < frames.length) c.enqueue(enc.encode(frames[i++]));
        else c.close();
      },
    }),
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

async function expectClean(container: HTMLElement) {
  const results = await axe(container, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
    },
  });
  expect(results).toHaveNoViolations();
}

beforeEach(() => {
  (global.fetch as any) = vi.fn();
});

describe("A11y regression: /demo/hr", () => {
  it("idle: Form + Radios sind sauber", async () => {
    const { container } = renderPage();
    await expectClean(container);
  });

  it("done: Match-Card + Plan-Output + CTAs sind sauber", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      sse(
        {
          package_id: "00000000-0000-0000-0000-000000000aaa",
          package_title: "AEVO Komplett",
          package_key: "aevo-komplett",
          track: "EXAM_FIRST",
          matches: [
            { package_id: "00000000-0000-0000-0000-000000000aaa", package_title: "AEVO Komplett" },
          ],
        },
        ["**Worum es geht** — A11y-Sample.\n", "1. Schritt eins · 5 Min\n"],
      ),
    );

    const { container } = renderPage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Personalisierten Aktivierungsplan starten/i }),
      );
    });
    await waitFor(() => expect(screen.getByText(/AEVO Komplett/)).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Paket im Detail/i })).toBeInTheDocument(),
    );

    await expectClean(container);
  });
});
