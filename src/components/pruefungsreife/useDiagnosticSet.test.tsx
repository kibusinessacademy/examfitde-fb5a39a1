import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock supabase before importing the hook.
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));

import { useDiagnosticSet } from "@/components/pruefungsreife/useDiagnosticSet";
import { QUESTIONS } from "@/components/pruefungsreife/types";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useDiagnosticSet — Pruefungsreife SSOT", () => {
  it("falls back to generic QUESTIONS when no packageId is given", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDiagnosticSet(null), { wrapper: wrapper(client) });
    expect(result.current.isBlueprintSourced).toBe(false);
    expect(result.current.questions).toBe(QUESTIONS);
    expect(result.current.competencyIds).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("falls back to generic when RPC returns fewer than 4 rows", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { question_id: "q1", competency_id: "c1", competency_title: "X", question_text: "?", options: [], correct_answer: 0, blueprint_id: null, exam_relevance_tier: null, sort_order: 1, learning_field_id: null },
      ],
      error: null,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDiagnosticSet("11111111-1111-1111-1111-111111111111"), { wrapper: wrapper(client) });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBlueprintSourced).toBe(false);
    expect(result.current.questions).toBe(QUESTIONS);
  });

  it("uses blueprint set when RPC returns >=4 rows + emits SSOT metadata", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      question_id: `q-${i}`,
      competency_id: `c-${i}`,
      competency_title: `Kompetenz ${i}`,
      learning_field_id: `lf-${i}`,
      question_text: `Frage ${i}: Was ist X?`,
      options: ["A", "B", "C", "D"],
      correct_answer: 0,
      blueprint_id: i % 2 === 0 ? `bp-${i}` : null,
      exam_relevance_tier: "tier_1",
      sort_order: i,
    }));
    rpcMock.mockResolvedValue({ data: rows, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDiagnosticSet("22222222-2222-2222-2222-222222222222"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isBlueprintSourced).toBe(true));
    expect(result.current.questions).toHaveLength(8);
    expect(result.current.competencyIds).toHaveLength(8);
    expect(result.current.blueprintIds.filter(Boolean)).toHaveLength(4);
    expect(result.current.questions[0].text).toContain("Kompetenz 0");
    // SSOT contract: every question carries one of the 8 generic categories
    const validCats = new Set(QUESTIONS.map((q) => q.category));
    for (const q of result.current.questions) {
      expect(validCats.has(q.category)).toBe(true);
    }
  });

  it("falls back to generic when RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDiagnosticSet("33333333-3333-3333-3333-333333333333"), { wrapper: wrapper(client) });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBlueprintSourced).toBe(false);
    expect(result.current.questions).toBe(QUESTIONS);
  });
});
