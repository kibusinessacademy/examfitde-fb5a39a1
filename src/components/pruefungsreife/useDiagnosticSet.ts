/**
 * Phase 1 — Berufsspezifische Prüfungsreife-Diagnostik.
 *
 * Lädt via SSOT-RPC `fn_get_pruefungsreife_diagnostic_set(package_id)` bis zu
 * 8 echte, freigegebene Diagnose-Fragen (1 pro Kompetenz). Wenn keine
 * Package-ID auflösbar ist oder die RPC leer zurückkommt, bleibt der Konsument
 * auf den generischen `QUESTIONS`-Fallback.
 *
 * Die Fragen werden auf das bestehende `Question`-Schema gemappt, damit der
 * 0–3-Selbsteinschätzungs-Score-Vertrag und der Tracking-Vertrag unverändert
 * bleiben (siehe Memory: Strict Event package_id SSOT).
 *
 * Tracking-Metadaten:
 *   question_source: 'blueprint' | 'generic'
 *   competency_ids:  string[]   (nur bei blueprint)
 *   blueprint_ids:   string[]   (nur bei blueprint, kann teilweise null sein)
 *   question_count:  number
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { QUESTIONS, type CategoryKey, type Question } from "./types";

interface DiagnosticRow {
  question_id: string;
  competency_id: string;
  competency_title: string | null;
  learning_field_id: string | null;
  question_text: string;
  options: unknown;
  correct_answer: number;
  blueprint_id: string | null;
  exam_relevance_tier: string | null;
  sort_order: number | null;
}

export interface DiagnosticSet {
  /** True when blueprint-sourced questions are used. */
  isBlueprintSourced: boolean;
  /** Final question set passed to the quiz (already mapped to `Question`). */
  questions: Question[];
  /** Per-question competency_id (parallel to `questions`). Only set on blueprint sets. */
  competencyIds: string[];
  /** Per-question blueprint_id (parallel to `questions`). Nulls allowed. Empty for generic. */
  blueprintIds: Array<string | null>;
  /** Per-question original exam_question_id, for downstream MC layer (Phase 2). */
  questionIds: string[];
  isLoading: boolean;
}

/**
 * Heuristic mapping of competency exam-relevance to one of the 8 generic
 * `CategoryKey`s. Keeps the existing "weakest_categories" tracking + result
 * grouping working without a separate UI rewrite. Order is stable.
 */
const CATEGORY_CYCLE: CategoryKey[] = [
  "lernstand",
  "pruefungspraxis",
  "typische_fehler",
  "schriftliche_sicherheit",
  "muendliche_sicherheit",
  "zeitmanagement",
  "wiederholungssystem",
  "pruefungsangst",
];

export function useDiagnosticSet(packageId: string | null): DiagnosticSet {
  const { data, isLoading } = useQuery({
    queryKey: ["pruefungsreife-diagnostic-set", packageId],
    enabled: !!packageId,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<DiagnosticRow[]> => {
      const { data, error } = await supabase.rpc(
        "fn_get_pruefungsreife_diagnostic_set" as any,
        { p_package_id: packageId, p_limit: 8 },
      );
      if (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[pruefungsreife] diagnostic RPC failed → fallback generic", error.message);
        }
        return [];
      }
      return (data ?? []) as DiagnosticRow[];
    },
  });

  return useMemo<DiagnosticSet>(() => {
    const rows = data ?? [];
    if (!packageId || rows.length < 4) {
      return {
        isBlueprintSourced: false,
        questions: QUESTIONS,
        competencyIds: [],
        blueprintIds: [],
        questionIds: [],
        isLoading,
      };
    }
    const questions: Question[] = rows.map((r, idx) => ({
      id: `bp-${r.question_id}`,
      category: CATEGORY_CYCLE[idx % CATEGORY_CYCLE.length],
      text: r.competency_title
        ? `${r.competency_title}: Wie sicher würdest du diese Aufgabe lösen? — „${truncateStem(r.question_text)}"`
        : `Wie sicher würdest du diese Aufgabe lösen? — „${truncateStem(r.question_text)}"`,
    }));
    return {
      isBlueprintSourced: true,
      questions,
      competencyIds: rows.map((r) => r.competency_id),
      blueprintIds: rows.map((r) => r.blueprint_id),
      questionIds: rows.map((r) => r.question_id),
      isLoading,
    };
  }, [data, packageId, isLoading]);
}

function truncateStem(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + "…";
}
