import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (_: string, d: string) => d }),
}));

const mockMaybeSingle = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: mockMaybeSingle,
          }),
        }),
      }),
    }),
  },
}));

import {
  useTranslatedCourse,
  useTranslatedLesson,
  useTranslatedQuestion,
} from "@/hooks/i18n/useTranslatedContent";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useTranslatedContent resolvers", () => {
  beforeEach(() => mockMaybeSingle.mockReset());

  it("falls back to German source when no translation row", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(
      () => useTranslatedCourse("c1", { title: "Kurs DE", subtitle: null, description: null }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data?.title).toBe("Kurs DE"));
    expect(result.current.data?.isFallback).toBe(true);
    expect(result.current.data?.language).toBe("de");
  });

  it("returns published translation when present", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        title: "Course EN",
        subtitle: null,
        description: null,
        status: "published",
        is_stale: false,
        language: "en",
      },
      error: null,
    });
    const { result } = renderHook(
      () => useTranslatedCourse("c1", { title: "Kurs DE" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data?.title).toBe("Course EN"));
    expect(result.current.data?.isFallback).toBe(false);
    expect(result.current.data?.language).toBe("en");
  });

  it("marks pending when status != published", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { title: "x", status: "queued", is_stale: false, language: "en" },
      error: null,
    });
    const { result } = renderHook(
      () => useTranslatedLesson("l1", { title: "Lektion DE" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data?.isPending).toBe(true));
    expect(result.current.data?.title).toBe("Lektion DE");
  });

  it("flags stale when source_hash drifted", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        question_text: "Q EN",
        options: [],
        explanation: null,
        status: "published",
        is_stale: true,
        language: "en",
      },
      error: null,
    });
    const { result } = renderHook(
      () => useTranslatedQuestion("q1", { question_text: "Q DE" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data?.isStale).toBe(true));
  });
});
