/**
 * PR-3: Client-Resolver hooks for translated content.
 *
 * EXTEND_ONLY: Reads from additive translation tables created in PR-2.
 * Falls back to German source content when no translation exists.
 *
 * All hooks return:
 *   { title, body, isFallback, isPending, isStale, language }
 *
 * Where:
 *   - language: actual served language (target or 'de' fallback)
 *   - isFallback: true when target translation missing → German served
 *   - isPending: target translation is queued/in_progress
 *   - isStale: target translation exists but source_hash drifted
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

export type SupportedLang = "de" | "en" | "tr" | "ar" | "uk" | "ru";

export interface ResolvedText {
  language: SupportedLang;
  isFallback: boolean;
  isPending: boolean;
  isStale: boolean;
}

export interface ResolvedCourse extends ResolvedText {
  title: string;
  subtitle: string | null;
  description: string | null;
}

export interface ResolvedLesson extends ResolvedText {
  title: string;
  content: string | null;
  summary: string | null;
}

export interface ResolvedQuestion extends ResolvedText {
  question_text: string;
  options: unknown;
  explanation: string | null;
}

function useTargetLang(): SupportedLang {
  const { i18n } = useTranslation();
  const lang = (i18n.language || "de").slice(0, 2).toLowerCase();
  const supported: SupportedLang[] = ["de", "en", "tr", "ar", "uk", "ru"];
  return (supported.includes(lang as SupportedLang) ? lang : "de") as SupportedLang;
}

/* ------------------------------------------------------------------ */
/* Course                                                              */
/* ------------------------------------------------------------------ */

export function useTranslatedCourse(
  courseId: string | null | undefined,
  source?: { title?: string | null; subtitle?: string | null; description?: string | null }
) {
  const lang = useTargetLang();

  return useQuery<ResolvedCourse>({
    enabled: !!courseId,
    queryKey: ["i18n", "course", courseId, lang, source?.title, source?.subtitle, source?.description],
    queryFn: async () => {
      const baseDe: ResolvedCourse = {
        title: source?.title ?? "",
        subtitle: source?.subtitle ?? null,
        description: source?.description ?? null,
        language: "de",
        isFallback: lang !== "de",
        isPending: false,
        isStale: false,
      };
      if (!courseId || lang === "de") return { ...baseDe, isFallback: false, language: "de" };

      const { data, error } = await (supabase as any)
        .from("course_translations")
        .select("title,subtitle,description,status,is_stale,language")
        .eq("course_id", courseId)
        .eq("language", lang)
        .maybeSingle();

      if (error || !data) return baseDe;
      if (data.status !== "published") {
        return { ...baseDe, isPending: true };
      }
      return {
        title: data.title ?? baseDe.title,
        subtitle: data.subtitle ?? baseDe.subtitle,
        description: data.description ?? baseDe.description,
        language: lang,
        isFallback: false,
        isPending: false,
        isStale: !!data.is_stale,
      };
    },
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------------ */
/* Lesson                                                              */
/* ------------------------------------------------------------------ */

export function useTranslatedLesson(
  lessonId: string | null | undefined,
  source?: { title?: string | null; content?: string | null; summary?: string | null }
) {
  const lang = useTargetLang();

  return useQuery<ResolvedLesson>({
    enabled: !!lessonId,
    queryKey: ["i18n", "lesson", lessonId, lang, source?.title],
    queryFn: async () => {
      const baseDe: ResolvedLesson = {
        title: source?.title ?? "",
        content: source?.content ?? null,
        summary: source?.summary ?? null,
        language: "de",
        isFallback: lang !== "de",
        isPending: false,
        isStale: false,
      };
      if (!lessonId || lang === "de") return { ...baseDe, isFallback: false, language: "de" };

      const { data, error } = await (supabase as any)
        .from("lesson_translations")
        .select("title,content,summary,status,is_stale,language")
        .eq("lesson_id", lessonId)
        .eq("language", lang)
        .maybeSingle();

      if (error || !data) return baseDe;
      if (data.status !== "published") return { ...baseDe, isPending: true };
      return {
        title: data.title ?? baseDe.title,
        content: data.content ?? baseDe.content,
        summary: data.summary ?? baseDe.summary,
        language: lang,
        isFallback: false,
        isPending: false,
        isStale: !!data.is_stale,
      };
    },
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------------ */
/* Question                                                            */
/* ------------------------------------------------------------------ */

export function useTranslatedQuestion(
  questionId: string | null | undefined,
  source?: { question_text?: string | null; options?: unknown; explanation?: string | null }
) {
  const lang = useTargetLang();

  return useQuery<ResolvedQuestion>({
    enabled: !!questionId,
    queryKey: ["i18n", "question", questionId, lang],
    queryFn: async () => {
      const baseDe: ResolvedQuestion = {
        question_text: source?.question_text ?? "",
        options: source?.options ?? null,
        explanation: source?.explanation ?? null,
        language: "de",
        isFallback: lang !== "de",
        isPending: false,
        isStale: false,
      };
      if (!questionId || lang === "de") return { ...baseDe, isFallback: false, language: "de" };

      const { data, error } = await (supabase as any)
        .from("question_translations")
        .select("question_text,options,explanation,status,is_stale,language")
        .eq("question_id", questionId)
        .eq("language", lang)
        .maybeSingle();

      if (error || !data) return baseDe;
      if (data.status !== "published") return { ...baseDe, isPending: true };
      return {
        question_text: data.question_text ?? baseDe.question_text,
        options: data.options ?? baseDe.options,
        explanation: data.explanation ?? baseDe.explanation,
        language: lang,
        isFallback: false,
        isPending: false,
        isStale: !!data.is_stale,
      };
    },
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------------ */
/* Helper: target language for AI Tutor / Oral Exam                    */
/* ------------------------------------------------------------------ */

export function useTargetLanguage(): SupportedLang {
  return useTargetLang();
}

/** BCP-47 mapping for STT/TTS. */
export const STT_TTS_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-US",
  tr: "tr-TR",
  ar: "ar-SA",
  uk: "uk-UA",
  ru: "ru-RU",
};
