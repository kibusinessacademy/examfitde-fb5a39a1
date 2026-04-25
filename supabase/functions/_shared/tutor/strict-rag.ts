/**
 * tutor/strict-rag.ts
 *
 * Loop C: Strict-RAG + Citation enforcement helpers for the AI Tutor.
 *
 * Responsibilities:
 *  1. Build the canonical SSOT-ID set the tutor is allowed to cite from
 *     (lessons / competencies / blueprints / minicheck-results / exam-attempts).
 *  2. Build the system-prompt addendum that forces the model to emit a
 *     machine-readable [SOURCES] block with at least one valid ID.
 *  3. Extract & validate the citation block from a model response.
 *  4. Enforce sanitization: any answer without a valid citation is treated as
 *     a refusal.
 *
 * The companion DB primitives (see migration LOOP C) are:
 *   - public.tutor_access_check(curriculum_id, daily_limit) → JSONB
 *   - public.tutor_log_audit(...)                            → audit row id
 *   - public.ai_tutor_audit                                  → audit table
 */

export type CitationSource = "lesson" | "competency" | "blueprint" | "minicheck" | "exam_session";

export interface AllowedSources {
  lessons: string[];        // lesson IDs
  competencies: string[];   // competency IDs
  blueprints: string[];     // blueprint IDs
  miniChecks: string[];     // minicheck question IDs
  examSessions: string[];   // exam session IDs
}

export interface ParsedCitation {
  source: CitationSource;
  id: string;
  raw: string;
}

export interface ValidationResult {
  ok: boolean;
  citations: ParsedCitation[];
  invalidIds: string[];
  reason?: string;
}

/**
 * Build the system-prompt addendum that forces strict citation behaviour.
 * Must be appended AFTER the role/mode prompt and AFTER the SSOT context block.
 */
export function buildCitationContract(allowed: AllowedSources): string {
  const lines: string[] = [];
  lines.push("\n--- STRICT-RAG CITATION CONTRACT (PFLICHT) ---");
  lines.push("Du DARFST inhaltliche Antworten NUR auf Basis der nachfolgend gelisteten SSOT-IDs geben.");
  lines.push("Du DARFST KEINE Inhalte erfinden, KEINE Paragraphen / Normen / Quellen halluzinieren und KEINE externen Webquellen nennen.");
  lines.push("");
  lines.push("ERLAUBTE QUELLEN (ID-Whitelist):");
  if (allowed.lessons.length) lines.push(`- lesson: ${allowed.lessons.slice(0, 12).join(", ")}`);
  if (allowed.competencies.length) lines.push(`- competency: ${allowed.competencies.slice(0, 12).join(", ")}`);
  if (allowed.blueprints.length) lines.push(`- blueprint: ${allowed.blueprints.slice(0, 12).join(", ")}`);
  if (allowed.miniChecks.length) lines.push(`- minicheck: ${allowed.miniChecks.slice(0, 12).join(", ")}`);
  if (allowed.examSessions.length) lines.push(`- exam_session: ${allowed.examSessions.slice(0, 6).join(", ")}`);
  if (
    !allowed.lessons.length &&
    !allowed.competencies.length &&
    !allowed.blueprints.length &&
    !allowed.miniChecks.length &&
    !allowed.examSessions.length
  ) {
    lines.push("- (keine Quellen verfügbar)");
  }
  lines.push("");
  lines.push("PFLICHT-FORMAT am ENDE jeder inhaltlichen Antwort (genau so, ohne Anführungszeichen):");
  lines.push("[SOURCES]");
  lines.push("- lesson:<UUID>");
  lines.push("- competency:<UUID>");
  lines.push("[/SOURCES]");
  lines.push("");
  lines.push("REGELN:");
  lines.push("1. Mindestens EINE Citation aus der Whitelist ist Pflicht.");
  lines.push("2. Citations OHNE passende ID in der Whitelist sind verboten.");
  lines.push("3. Wenn die Whitelist leer ist ODER die Frage außerhalb des Curriculums liegt:");
  lines.push("   Antworte exakt: \"Ich kann diese Frage nicht aus dem freigegebenen Lehrmaterial beantworten.\"");
  lines.push("   und füge KEINEN [SOURCES]-Block an.");
  lines.push("4. Im Prüfungsmodus gelten zusätzlich die Mode-Regeln (keine inhaltliche Hilfe).");
  return lines.join("\n");
}

/**
 * Extract the [SOURCES]…[/SOURCES] block from a model response and validate
 * each citation against the allow-list. Returns parsed + invalid IDs and
 * a final ok flag (true → at least one valid citation).
 */
export function extractAndValidateCitations(
  response: string,
  allowed: AllowedSources,
): ValidationResult {
  if (!response || typeof response !== "string") {
    return { ok: false, citations: [], invalidIds: [], reason: "empty_response" };
  }

  // Special refusal sentence is acceptable (no citation required)
  if (/Ich kann diese Frage nicht aus dem freigegebenen Lehrmaterial beantworten\.?/i.test(response)) {
    return { ok: true, citations: [], invalidIds: [], reason: "refused_off_topic" };
  }

  const blockMatch = response.match(/\[SOURCES\]([\s\S]*?)\[\/SOURCES\]/i);
  if (!blockMatch) {
    return { ok: false, citations: [], invalidIds: [], reason: "no_sources_block" };
  }

  const body = blockMatch[1];
  const lineRegex = /(lesson|competency|blueprint|minicheck|exam_session)\s*:\s*([0-9a-f-]{8,})/gi;
  const found: ParsedCitation[] = [];
  const invalid: string[] = [];

  const allowedSets: Record<CitationSource, Set<string>> = {
    lesson: new Set(allowed.lessons),
    competency: new Set(allowed.competencies),
    blueprint: new Set(allowed.blueprints),
    minicheck: new Set(allowed.miniChecks),
    exam_session: new Set(allowed.examSessions),
  };

  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(body)) !== null) {
    const source = m[1].toLowerCase() as CitationSource;
    const id = m[2].toLowerCase();
    const raw = `${source}:${id}`;
    if (allowedSets[source]?.has(id)) {
      found.push({ source, id, raw });
    } else {
      invalid.push(raw);
    }
  }

  if (!found.length) {
    return {
      ok: false,
      citations: [],
      invalidIds: invalid,
      reason: invalid.length ? "all_citations_invalid" : "empty_sources_block",
    };
  }

  return { ok: true, citations: found, invalidIds: invalid };
}

/**
 * Strip the [SOURCES] block from the user-facing response (we surface
 * citations separately via the API response payload).
 */
export function stripSourcesBlock(response: string): string {
  return response.replace(/\n*\[SOURCES\][\s\S]*?\[\/SOURCES\]\n*/gi, "").trim();
}

/**
 * Load the curated allow-list for a given context. Falls back to curriculum-wide
 * lesson/competency lists when no narrow context (lesson/competency) is given.
 */
export async function loadAllowedSources(
  supabase: any,
  ctx: {
    userId?: string | null;
    curriculumId?: string | null;
    lessonId?: string | null;
    competencyId?: string | null;
  },
  limit = 25,
): Promise<AllowedSources> {
  const out: AllowedSources = {
    lessons: [],
    competencies: [],
    blueprints: [],
    miniChecks: [],
    examSessions: [],
  };

  if (!ctx.curriculumId && !ctx.lessonId && !ctx.competencyId) return out;

  try {
    // Lessons (narrow → broad)
    if (ctx.lessonId) {
      out.lessons.push(ctx.lessonId);
    } else if (ctx.competencyId) {
      const { data } = await supabase
        .from("lessons")
        .select("id")
        .eq("competency_id", ctx.competencyId)
        .limit(limit);
      out.lessons.push(...(data || []).map((r: any) => r.id));
    } else if (ctx.curriculumId) {
      const { data } = await supabase
        .from("lessons")
        .select("id, competencies!inner(learning_fields!inner(curriculum_id))")
        .eq("competencies.learning_fields.curriculum_id", ctx.curriculumId)
        .limit(limit);
      out.lessons.push(...(data || []).map((r: any) => r.id));
    }

    // Competencies (via learning_fields — see SSOT join rule)
    if (ctx.competencyId) {
      out.competencies.push(ctx.competencyId);
    } else if (ctx.curriculumId) {
      const { data } = await supabase
        .from("competencies")
        .select("id, learning_fields!inner(curriculum_id)")
        .eq("learning_fields.curriculum_id", ctx.curriculumId)
        .limit(limit);
      out.competencies.push(...(data || []).map((r: any) => r.id));
    }

    // Blueprints (per competency)
    if (out.competencies.length) {
      const { data } = await supabase
        .from("question_blueprints")
        .select("id")
        .in("competency_id", out.competencies.slice(0, 10))
        .in("status", ["draft", "review", "approved"])
        .limit(limit);
      out.blueprints.push(...(data || []).map((r: any) => r.id));
    }

    // Recent minichecks for the user (only if context narrow enough)
    if (ctx.userId && ctx.curriculumId) {
      const { data } = await supabase
        .from("minicheck_questions")
        .select("id")
        .eq("curriculum_id", ctx.curriculumId)
        .limit(15);
      out.miniChecks.push(...(data || []).map((r: any) => r.id));
    }

    // Last finished exam session for the user
    if (ctx.userId && ctx.curriculumId) {
      const { data } = await supabase
        .from("exam_sessions")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("curriculum_id", ctx.curriculumId)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(3);
      out.examSessions.push(...(data || []).map((r: any) => r.id));
    }
  } catch (e) {
    console.warn("[strict-rag] loadAllowedSources failed:", e);
  }

  // Deduplicate + lowercase
  const norm = (xs: string[]) => Array.from(new Set(xs.map((x) => String(x).toLowerCase())));
  out.lessons = norm(out.lessons);
  out.competencies = norm(out.competencies);
  out.blueprints = norm(out.blueprints);
  out.miniChecks = norm(out.miniChecks);
  out.examSessions = norm(out.examSessions);

  return out;
}

/**
 * Convenience: write an audit entry through the SECURITY DEFINER RPC.
 * Always best-effort; never throws.
 */
export async function writeTutorAudit(
  supabase: any,
  payload: {
    userId: string;
    sessionId?: string | null;
    curriculumId?: string | null;
    lessonId?: string | null;
    competencyId?: string | null;
    generationId?: string | null;
    mode: string;
    role?: string | null;
    decision:
      | "allowed"
      | "blocked_no_citation"
      | "blocked_no_entitlement"
      | "blocked_rate_limit"
      | "blocked_exam_mode"
      | "blocked_off_topic"
      | "validator_rejected";
    blockReason?: string | null;
    sourceRefs?: ParsedCitation[];
    validatorScore?: number | null;
    validatorDecision?: string | null;
    promptExcerpt?: string | null;
    responseExcerpt?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.rpc("tutor_log_audit", {
      p_user_id: payload.userId,
      p_session_id: payload.sessionId ?? null,
      p_curriculum_id: payload.curriculumId ?? null,
      p_lesson_id: payload.lessonId ?? null,
      p_competency_id: payload.competencyId ?? null,
      p_generation_id: payload.generationId ?? null,
      p_mode: payload.mode,
      p_role: payload.role ?? null,
      p_decision: payload.decision,
      p_block_reason: payload.blockReason ?? null,
      p_source_refs: (payload.sourceRefs ?? []).map((c) => ({ source: c.source, id: c.id })),
      p_validator_score: payload.validatorScore ?? null,
      p_validator_decision: payload.validatorDecision ?? null,
      p_prompt_excerpt: payload.promptExcerpt ?? null,
      p_response_excerpt: payload.responseExcerpt ?? null,
      p_metadata: payload.metadata ?? {},
    });
  } catch (e) {
    console.warn("[strict-rag] writeTutorAudit failed:", e);
  }
}
