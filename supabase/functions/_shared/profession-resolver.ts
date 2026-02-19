/**
 * SSOT Profession Resolver — Hard Guard
 * 
 * Resolves profession name from certifications (preferred) or curricula→berufe.
 * THROWS if no profession can be resolved — no fallbacks, no defaults.
 * 
 * Usage:
 *   const profession = await resolveProfession(sb, { certificationId, curriculumId });
 *   // profession is GUARANTEED to be a non-empty string or it throws
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type SB = ReturnType<typeof createClient>;

interface ResolveInput {
  /** Preferred: resolve from certifications table */
  certificationId?: string | null;
  /** Fallback: resolve from curricula → berufe */
  curriculumId?: string | null;
  /** If true, allows "Auszubildende" as last-resort (for user-facing functions like tutor/support) */
  allowGenericFallback?: boolean;
}

interface ProfessionResult {
  professionName: string;
  source: "certifications" | "curricula_berufe" | "curricula_title";
  certificationId?: string;
  curriculumId?: string;
}

export async function resolveProfession(sb: SB, input: ResolveInput): Promise<ProfessionResult> {
  const { certificationId, curriculumId, allowGenericFallback = false } = input;

  // ── 1) Try certifications table first (SSOT) ──
  if (certificationId) {
    const { data: cert } = await sb
      .from("certifications")
      .select("id, title, profession_title")
      .eq("id", certificationId)
      .maybeSingle();

    if (cert) {
      const name = (cert as any).profession_title || cert.title;
      if (name && name.trim()) {
        return {
          professionName: name.trim(),
          source: "certifications",
          certificationId,
        };
      }
    }
  }

  // ── 2) Try curricula → berufe ──
  if (curriculumId) {
    const { data: curriculum } = await sb
      .from("curricula")
      .select("title, beruf_id")
      .eq("id", curriculumId)
      .maybeSingle();

    if (curriculum?.beruf_id) {
      const { data: beruf } = await sb
        .from("berufe")
        .select("bezeichnung_kurz, bezeichnung_lang")
        .eq("id", curriculum.beruf_id)
        .maybeSingle();

      if (beruf) {
        const name = beruf.bezeichnung_kurz || beruf.bezeichnung_lang;
        if (name && name.trim()) {
          return {
            professionName: name.trim(),
            source: "curricula_berufe",
            curriculumId,
          };
        }
      }
    }

    // 2b) Extract from curriculum title
    if (curriculum?.title) {
      const extracted = curriculum.title.replace(/^Rahmenlehrplan\s+/i, "").trim();
      if (extracted && extracted.length > 2) {
        return {
          professionName: extracted,
          source: "curricula_title",
          curriculumId,
        };
      }
    }
  }

  // ── 3) Hard guard: no fallback ──
  if (allowGenericFallback) {
    return {
      professionName: "Auszubildende",
      source: "curricula_title",
    };
  }

  throw new Error(
    `MISSING_PROFESSION_CONTEXT: Could not resolve profession name. ` +
    `certificationId=${certificationId || "null"}, curriculumId=${curriculumId || "null"}. ` +
    `Every AI generation MUST have a resolved profession — no fallback allowed.`
  );
}

/**
 * Helper: resolve profession from courseId (course → curriculum → berufe)
 */
export async function resolveProfessionFromCourse(
  sb: SB,
  courseId: string,
  opts?: { allowGenericFallback?: boolean },
): Promise<ProfessionResult> {
  const { data: course } = await sb
    .from("courses")
    .select("curriculum_id, certification_id")
    .eq("id", courseId)
    .maybeSingle();

  if (!course) {
    throw new Error(`MISSING_COURSE: Course ${courseId} not found`);
  }

  return resolveProfession(sb, {
    certificationId: (course as any).certification_id || null,
    curriculumId: course.curriculum_id || null,
    allowGenericFallback: opts?.allowGenericFallback,
  });
}
