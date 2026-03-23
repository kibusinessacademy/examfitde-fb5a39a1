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

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

/**
 * Ensure a profession_profile exists for a given beruf_id.
 * If missing, generates one via AI and inserts it.
 * Returns the profile JSONB or null if generation failed.
 * 
 * This is the pipeline hook — called before content/exam generation
 * to guarantee profile availability for all professions.
 */
export async function ensureProfessionProfile(
  sb: SB,
  berufId: string,
  opts?: { professionName?: string },
): Promise<Record<string, unknown> | null> {
  // Check if profile already exists
  const { data: existing } = await sb
    .from("profession_profiles")
    .select("profile")
    .eq("beruf_id", berufId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.profile) return existing.profile as Record<string, unknown>;

  // Load beruf data for generation
  const { data: beruf } = await sb
    .from("berufe")
    .select("id, bezeichnung_kurz, bezeichnung_lang, zustaendigkeit, ausbildungsdauer_monate, taetigkeitsprofil")
    .eq("id", berufId)
    .maybeSingle();

  if (!beruf) {
    console.warn(`[ensureProfessionProfile] beruf_id=${berufId} not found`);
    return null;
  }

  const name = opts?.professionName || beruf.bezeichnung_kurz || beruf.bezeichnung_lang || "Fachkraft";

  // Load LF context
  const { data: curricula } = await sb
    .from("curricula")
    .select("id")
    .eq("beruf_id", berufId)
    .limit(1);

  let lfContext = "";
  if (curricula?.[0]) {
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("code, title, exam_part")
      .eq("curriculum_id", curricula[0].id)
      .order("code")
      .limit(15);
    if (lfs?.length) {
      lfContext = `\nLernfelder: ${lfs.map((lf: any) => `${lf.code}: ${lf.title} (${lf.exam_part || 'k.A.'})`).join("; ")}`;
    }
  }

  try {
    // Dynamic import to avoid circular deps at module load time
    const { callAIWithFailover } = await import("../ai-client.ts");
    const { getModelChainAsync } = await import("../model-routing.ts");

    const chain = await getModelChainAsync("seo_content");
    const aiResp = await callAIWithFailover(
      chain.map((c: any) => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          {
            role: "system",
            content: `Du bist ein IHK-Prüfungsexperte. Erstelle ein PROFESSION_PROFILE für "${name}".
${beruf.taetigkeitsprofil ? `Tätigkeitsprofil: ${(beruf.taetigkeitsprofil as string).slice(0, 500)}` : ""}
${lfContext}

Liefere ein JSON-Objekt:
{
  "typical_task_types": ["Berechnung", "Fehleranalyse", "Best-Option", "Compliance", "Fallstudie"],
  "common_error_patterns": [{"error": "Beschreibung", "domain": "Bereich", "severity": "high|medium|low"}],
  "term_strictness": "strict|medium|relaxed",
  "preferred_scenario_types": [{"type": "Szenariotyp", "description": "Kurz", "frequency": "high|medium"}],
  "assessment_focus_areas": [{"area": "Bereich", "weight": "high|medium|low", "exam_part": "AP1|AP2|beide"}],
  "industry_context": {"typical_employers": ["..."], "work_environments": ["..."], "key_regulations": ["..."], "digital_tools": ["..."]},
  "exam_style_hints": ["Spezifische Hinweise"]
}

Sei SPEZIFISCH für den Beruf. Keine generischen Antworten.`,
          },
          { role: "user", content: `Profession Profile für: ${name} (${beruf.zustaendigkeit || "IHK"}, ${beruf.ausbildungsdauer_monate || "36"} Monate)` },
        ],
        max_tokens: 2048,
      },
    );

    const raw = aiResp.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const profile = JSON.parse(raw.slice(jsonStart, jsonEnd + 1).replace(/,\s*([\]}])/g, "$1"));

    const { error } = await sb.from("profession_profiles").insert({
      beruf_id: berufId,
      profession_name: name,
      profile,
    });

    if (error) {
      // Might be a race condition (concurrent insert) — try to read again
      if (error.code === "23505") {
        const { data: retry } = await sb.from("profession_profiles").select("profile").eq("beruf_id", berufId).limit(1).maybeSingle();
        return retry?.profile as Record<string, unknown> || null;
      }
      console.error(`[ensureProfessionProfile] DB insert error: ${error.message}`);
      return null;
    }

    console.log(`[ensureProfessionProfile] AUTO-GENERATED profile for "${name}" (beruf_id=${berufId})`);
    return profile;
  } catch (e) {
    console.error(`[ensureProfessionProfile] AI generation failed for "${name}": ${(e as Error).message}`);
    return null;
  }
}
