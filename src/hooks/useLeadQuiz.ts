/**
 * useLeadQuiz — Lädt eine Quiz-Definition + Fragen aus der DB.
 * Public-readable wenn is_active = true (RLS).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface QuizOption {
  key: string;
  label: string;
  /** Binärer Korrektheits-Marker (klassische MC-Quizzes, z. B. AEVO) */
  is_correct: boolean;
  /** Optionaler Self-Assessment-Score 0..N (z. B. 0–4). Hat Vorrang vor is_correct. */
  score?: number;
  explanation?: string;
}

export interface QuizQuestion {
  id: string;
  position: number;
  question_text: string;
  options: QuizOption[];
  weight: number;
  topic_tag: string | null;
}

export interface LeadQuiz {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  curriculum_id: string | null;
  lernplan_slug: string | null;
  pass_threshold: number;
  questions: QuizQuestion[];
}

export function useLeadQuiz(slug: string | undefined) {
  const [data, setData] = useState<LeadQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: quiz, error: qErr } = await (supabase as any)
          .from("lead_quizzes")
          .select("id, slug, title, subtitle, description, curriculum_id, lernplan_slug, pass_threshold")
          .eq("slug", slug)
          .eq("is_active", true)
          .maybeSingle();
        if (qErr) throw qErr;
        if (!quiz) {
          if (!cancelled) {
            setData(null);
            setError("Quiz nicht gefunden.");
          }
          return;
        }
        const { data: questions, error: quErr } = await (supabase as any)
          .from("quiz_questions")
          .select("id, position, question_text, options, weight, topic_tag")
          .eq("quiz_id", quiz.id)
          .order("position", { ascending: true });
        if (quErr) throw quErr;

        if (!cancelled) {
          setData({ ...(quiz as any), questions: (questions ?? []) as any });
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Fehler beim Laden des Quiz.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { data, loading, error };
}
