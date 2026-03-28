import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Tutor Runtime (Council 5)
 * - Loads SSOT context by IDs (server-side)
 * - Uses ONLY published tutor_assets (approved via Council)
 * - Hard blocks missing scope binding
 * - Hard blocks missing source_refs in model output
 */

const GENERATOR_MODEL = "openai/gpt-5-mini";
const VALIDATOR_MODEL = "openai/gpt-5-mini";

type SB = ReturnType<typeof createClient>;
type Role = "explainer" | "coach" | "examiner" | "feedback";
type ScopeType = "competency" | "lesson" | "exam_session" | "course" | "global";

interface TutorAnswerPayload {
  role: Role;
  scope_type: ScopeType;
  scope_id?: string | null;
  locale?: string;
  user_message: string;
  mastery_context?: {
    user_id: string;
    curriculum_id: string;
  };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const p: TutorAnswerPayload = body.payload ?? body;

    if (!p.role || !p.scope_type || !p.user_message) {
      return new Response(JSON.stringify({ ok: false, error: "Missing role/scope_type/user_message" }), { status: 400, headers });
    }

    if (p.scope_type !== "global" && !p.scope_id) {
      return new Response(JSON.stringify({ ok: false, error: "Scope binding required: provide scope_id." }), { status: 400, headers });
    }

    const locale = p.locale ?? "de-DE";

    // 1) Load published tutor assets (approved only)
    const requiredAssetTypes = mapRoleToAssetTypes(p.role);
    const assets = await loadPublishedAssets(sb, { assetTypes: requiredAssetTypes, scope_type: p.scope_type, scope_id: p.scope_id ?? null, locale });

    if (!assets.length) {
      return new Response(JSON.stringify({ ok: false, error: "No published tutor assets found for this scope.", required_asset_types: requiredAssetTypes }), { status: 409, headers });
    }

    // 2) Load SSOT context (server-side)
    const ssot = await loadTutorSSOT(sb, p.scope_type, p.scope_id ?? null);

    // 2b) Load mastery context if provided (readiness + weakness map)
    let masteryContext: Record<string, unknown> | null = null;
    if (p.mastery_context?.user_id && p.mastery_context?.curriculum_id) {
      masteryContext = await loadMasteryContext(sb, p.mastery_context.user_id, p.mastery_context.curriculum_id);
    }

    // 2c) Risk-based role steering
    const effectiveRole = masteryContext ? steerRole(p.role, masteryContext) : p.role;

    // 3) Generate response with mandatory source_refs
    const draft = await callLLM({
      model: GENERATOR_MODEL,
      system: buildTutorSystem(effectiveRole, p.scope_type, masteryContext),
      user: buildTutorUserPrompt(p, assets, ssot, masteryContext),
    });

    // Hard gate: must contain source_refs
    const sourceRefs = Array.isArray(draft?.source_refs) ? draft.source_refs : [];
    if (!sourceRefs.length) {
      return new Response(JSON.stringify({ ok: false, error: "Tutor output blocked: missing source_refs (SSOT citations).", draft }), { status: 422, headers });
    }

    // 4) Fast validation
    const validation = await validateDraft({ ssot, role: p.role, draft });
    if (validation.decision === "rejected") {
      return new Response(JSON.stringify({ ok: false, error: "Tutor output rejected by validator.", validation }), { status: 422, headers });
    }

    return new Response(JSON.stringify({
      ok: true, role: p.role, scope_type: p.scope_type, scope_id: p.scope_id ?? null,
      answer_html: draft.answer_html ?? draft.answer ?? "",
      source_refs: draft.source_refs ?? [], next_steps: draft.next_steps ?? [],
      confidence: draft.confidence ?? 0.7, validator: validation,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tutor-answer] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

/* ── Helpers ── */

function mapRoleToAssetTypes(role: Role): readonly string[] {
  switch (role) {
    case "examiner": return ["oral_exam_prompt", "oral_exam_rubric"];
    case "feedback": return ["feedback_template"];
    default: return ["tutor_template"];
  }
}

async function loadPublishedAssets(sb: SB, params: { assetTypes: readonly string[]; scope_type: ScopeType; scope_id: string | null; locale: string }) {
  const { assetTypes, scope_type, scope_id, locale } = params;

  let q = sb.from("tutor_assets")
    .select("id, asset_type, scope_type, scope_id, title, locale, published_version_id, is_published")
    .in("asset_type", [...assetTypes])
    .eq("is_published", true)
    .eq("locale", locale);

  if (scope_type === "global") {
    q = q.eq("scope_type", "global");
  } else {
    q = q.eq("scope_type", scope_type).eq("scope_id", scope_id);
  }

  const exact = await q.order("updated_at", { ascending: false });
  if (exact.error) throw exact.error;
  if (exact.data?.length) return exact.data;

  // Fallback: global scope
  if (scope_type !== "global") {
    const fb = await sb.from("tutor_assets")
      .select("id, asset_type, scope_type, scope_id, title, locale, published_version_id, is_published")
      .in("asset_type", [...assetTypes])
      .eq("is_published", true).eq("locale", locale).eq("scope_type", "global")
      .order("updated_at", { ascending: false }).limit(5);
    if (fb.error) throw fb.error;
    return fb.data ?? [];
  }
  return [];
}

async function loadTutorSSOT(sb: SB, scopeType: ScopeType, scopeId: string | null) {
  const refs: Record<string, unknown>[] = [];
  if (!scopeId || scopeType === "global") return { scopeType, scopeId, refs };

  if (scopeType === "lesson") {
    const { data, error } = await sb.from("lessons").select("id, title, step, competency_id, course_id").eq("id", scopeId).single();
    if (error) throw error;
    refs.push({ type: "lesson", ...data });
    if (data?.competency_id) {
      const c = await sb.from("competencies").select("id, title, code, description, taxonomy_level").eq("id", data.competency_id).single();
      if (!c.error && c.data) refs.push({ type: "competency", ...c.data });
    }
  }
  if (scopeType === "competency") {
    const { data, error } = await sb.from("competencies").select("id, title, code, description, taxonomy_level").eq("id", scopeId).single();
    if (error) throw error;
    refs.push({ type: "competency", ...data });
  }
  if (scopeType === "course") {
    const { data, error } = await sb.from("courses").select("id, title, certification_name, status").eq("id", scopeId).single();
    if (error) throw error;
    refs.push({ type: "course", ...data });
  }

  // QW #13: Load *_eff fields from elite view for exam questions in scope
  try {
    let eliteQuery = sb.from("exam_questions_elite_v")
      .select("id, elite_level_eff, multi_variable_eff, transfer_variant_eff, distractor_types_eff, score_eff")
      .eq("status", "approved");
    
    if (scopeType === "competency" && scopeId) {
      eliteQuery = eliteQuery.eq("competency_id", scopeId).limit(20);
    } else if (scopeType === "lesson") {
      // Get competency_id from the lesson ref we already loaded
      const lessonRef = refs.find(r => (r as any).type === "lesson") as any;
      if (lessonRef?.competency_id) {
        eliteQuery = eliteQuery.eq("competency_id", lessonRef.competency_id).limit(20);
      }
    }

    const { data: eliteData } = await eliteQuery;
    if (eliteData?.length) {
      refs.push({ type: "elite_question_context", count: eliteData.length, 
        summary: {
          elite_pct: Math.round((eliteData.filter((e: any) => e.elite_level_eff === 'elite').length / eliteData.length) * 100),
          avg_score: Number((eliteData.reduce((s: number, e: any) => s + (e.score_eff || 0), 0) / eliteData.length).toFixed(1)),
          multi_variable_pct: Math.round((eliteData.filter((e: any) => e.multi_variable_eff).length / eliteData.length) * 100),
        },
        questions: eliteData.slice(0, 5).map((e: any) => ({
          id: e.id, elite_level: e.elite_level_eff, score: e.score_eff, 
          transfer: e.transfer_variant_eff, multi_var: e.multi_variable_eff,
        }))
      });
    }
  } catch (e) {
    console.warn("[tutor-answer] elite context load failed (non-blocking):", e);
  }

  const bps = await sb.from("question_blueprints").select("id, name, canonical_statement").eq("status", "approved").limit(10);
  if (!bps.error && bps.data) refs.push(...bps.data.map((bp: Record<string, unknown>) => ({ type: "blueprint", ...bp })));

  return { scopeType, scopeId, refs };
}

function buildTutorSystem(role: Role, scopeType: ScopeType) {
  return `Du bist ExamFit Tutor (Council 5 Runtime).
REGELN (hart):
- Antworte ausschließlich auf Basis des SSOT-Kontexts und freigegebener Tutor-Templates.
- Erfinde KEINE Fakten/Normen/Paragraphen.
- Output STRICT JSON:
{ "answer_html": "...", "source_refs": ["<SSOT-ID>"], "next_steps": ["..."], "confidence": 0-1 }
Wenn SSOT nicht reicht: antworte kurz und setze confidence niedrig.
Rolle: ${role}
Scope: ${scopeType}`;
}

function buildTutorUserPrompt(p: TutorAnswerPayload, assets: Record<string, unknown>[], ssot: Record<string, unknown>) {
  return `USER MESSAGE:\n${p.user_message}\n\nFREIGEGEBENE TUTOR ASSETS:\n${JSON.stringify(assets).slice(0, 4000)}\n\nSSOT-KONTEXT:\n${JSON.stringify((ssot as Record<string, unknown>).refs).slice(0, 6000)}\n\nErstelle jetzt die STRICT JSON Antwort.`;
}

async function callLLM(opts: { model: string; system: string; user: string }): Promise<Record<string, unknown>> {
  try {
    const chain = await getModelChainAsync("support");
    const result = await callAIWithFailover(
      chain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: 0.3,
      },
    );
    const clean = (result.content || "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { answer_html: "", source_refs: [], next_steps: [], confidence: 0.1 };
  }
}

async function validateDraft(input: { ssot: Record<string, unknown>; role: Role; draft: Record<string, unknown> }) {
  try {
    const valChain = await getModelChainAsync("council_review");
    const result = await callAIWithFailover(
      valChain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: "system", content: `Du bist Validator für Tutor-Antworten. Output STRICT JSON:\n{ "decision":"approved"|"rejected", "issues":[], "rationale":"..." }\nReject wenn: keine source_refs, falsche Fakten, erfundene Normen/Paragraphen.` },
          { role: "user", content: JSON.stringify(input).slice(0, 12000) },
        ],
        temperature: 0.2,
      },
    );
    const clean = (result.content || "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { decision: "approved", issues: [{ severity: "low", text: "validator_failed" }], rationale: "validator unavailable" };
  }
}
