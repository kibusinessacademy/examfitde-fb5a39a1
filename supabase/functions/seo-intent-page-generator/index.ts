// SEO Intent Page Generator — Loop A
// Hybrid: SSOT skeleton (DB) + AI-generated 3 sections (intro/pain_points/expert_tip).
// Strict-RAG: only curriculum + competency context is passed to the LLM.
// Hard QC gate; UPSERT into seo_content_pages.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

interface Payload {
  job_id?: string;
  package_id?: string;
  curriculum_id?: string;
  competency_id?: string;
  intent_template?: string;
  persona_type?: string;
  dry_run?: boolean;
}

const FORBIDDEN_GLOBAL = [
  "in der heutigen zeit",
  "maßgeschneidert",
  "tauche ein",
  "egal ob anfänger oder profi",
  "dieser artikel zeigt dir alles",
];

const MIN_WORDS = 480;
const MAX_WORDS = 1200;
const REQUIRED_SECTIONS = ["intro", "pain_points", "expert_tip"];
const AI_RETRY_BACKOFF_MS = [5_000, 10_000, 20_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsertConflict(err: any): boolean {
  return err?.code === "23505" || String(err?.message ?? "").toLowerCase().includes("duplicate key");
}

function upsertLogContext(row: Record<string, unknown>) {
  return {
    package_id: row.package_id ?? null,
    curriculum_id: row.curriculum_id ?? null,
    competency_id: row.competency_id ?? null,
    intent_template: row.intent_template ?? null,
    slug: row.slug ?? null,
    status: row.status ?? null,
  };
}

function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length;
}

function runQc(
  sections: Record<string, string>,
  curriculumTitle: string,
  templateForbidden: string[],
): { ok: boolean; reasons: string[]; total_words: number; quality_score: number } {
  const reasons: string[] = [];

  for (const sec of REQUIRED_SECTIONS) {
    if (!sections[sec] || sections[sec].trim().length < 80) {
      reasons.push(`section_too_short:${sec}`);
    }
  }

  const combined = REQUIRED_SECTIONS.map((s) => sections[s] ?? "").join("\n\n");
  const total = wordCount(combined);
  if (total < MIN_WORDS) reasons.push(`words_too_few:${total}<${MIN_WORDS}`);
  if (total > MAX_WORDS) reasons.push(`words_too_many:${total}>${MAX_WORDS}`);

  const lower = combined.toLowerCase();
  const allForbidden = [...FORBIDDEN_GLOBAL, ...templateForbidden.map((p) => p.toLowerCase())];
  for (const phrase of allForbidden) {
    if (phrase && lower.includes(phrase)) reasons.push(`forbidden_phrase:${phrase}`);
  }

  const curriculumToken = curriculumTitle.split(/[\s\-(]+/)[0]?.toLowerCase() ?? "";
  if (curriculumToken && curriculumToken.length > 2 && !lower.includes(curriculumToken)) {
    reasons.push(`missing_curriculum_token:${curriculumToken}`);
  }

  const wordPenalty =
    total < 600 ? 5 : total > 1000 ? 3 : 0;
  const score = Math.max(0, 100 - reasons.length * 15 - wordPenalty);

  return { ok: reasons.length === 0, reasons, total_words: total, quality_score: score };
}

async function callLovableAi(
  systemPrompt: string,
  userPrompt: string,
  model: string,
): Promise<{ sections: Record<string, string>; raw: string; cost_eur: number }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.6,
    }),
  });

  if (res.status === 429) throw new Error("ai_rate_limited");
  if (res.status === 402) throw new Error("ai_credits_exhausted");
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ai_http_${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "";
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ai_invalid_json");
  }

  const sections: Record<string, string> = {};
  for (const sec of REQUIRED_SECTIONS) {
    const v = parsed[sec];
    sections[sec] = typeof v === "string" ? v : "";
  }

  // crude cost estimate (gemini-3-flash-preview): inputs ~ free preview, set 0
  return { sections, raw, cost_eur: 0 };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, origin);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid_json_body" }, origin);
  }

  // Resolve from job_id if provided
  let job: any = null;
  if (payload.job_id) {
    const { data, error } = await supabase
      .from("job_queue")
      .select("id, payload, status, attempts")
      .eq("id", payload.job_id)
      .maybeSingle();
    if (error || !data) return json(404, { error: "job_not_found" }, origin);
    job = data;
    const p = (data.payload ?? {}) as Payload;
    payload.package_id ??= p.package_id;
    payload.curriculum_id ??= p.curriculum_id;
    payload.competency_id ??= p.competency_id;
    payload.intent_template ??= p.intent_template;
    payload.persona_type ??= p.persona_type;

    await supabase
      .from("job_queue")
      .update({ status: "processing", attempts: (data.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", payload.job_id);
  }

  const { curriculum_id, competency_id, intent_template, persona_type } = payload;
  if (!curriculum_id || !competency_id || !intent_template) {
    return json(400, { error: "missing_fields", got: payload }, origin);
  }
  const persona = persona_type ?? "azubi";

  let packageId = payload.package_id ?? null;
  if (!packageId) {
    const { data: pkg, error: pkgErr } = await supabase
      .from("course_packages")
      .select("id")
      .eq("curriculum_id", curriculum_id)
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (pkgErr || !pkg?.id) {
      if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `package_missing:${pkgErr?.message ?? "no_published_package"}` }).eq("id", job.id);
      return json(409, { error: "package_missing", detail: pkgErr?.message ?? "no_published_package_for_curriculum" }, origin);
    }
    packageId = pkg.id;
  }

  // 1) Skeleton
  const { data: skeleton, error: skelErr } = await supabase.rpc(
    "fn_seo_build_ssot_skeleton",
    {
      p_curriculum_id: curriculum_id,
      p_competency_id: competency_id,
      p_intent_template: intent_template,
    },
  );
  if (skelErr || !skeleton) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `skeleton_failed:${skelErr?.message ?? "null"}` }).eq("id", job.id);
    return json(500, { error: "skeleton_failed", detail: skelErr?.message }, origin);
  }

  // 2) Template
  const templateKey = `${intent_template}_v1`.replace(/^intent_intent_/, "intent_");
  const { data: template, error: tplErr } = await supabase
    .from("seo_templates")
    .select("template_key, prompt_system, prompt_user, qc_rules_json, intent_key")
    .eq("doc_type", "intent_page")
    .eq("intent_key", intent_template)
    .eq("is_active", true)
    .maybeSingle();
  if (tplErr || !template) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `template_missing:${intent_template}` }).eq("id", job.id);
    return json(404, { error: "template_not_found", intent_template }, origin);
  }

  const curriculumTitle = (skeleton as any).curriculum.title as string;
  const competencyTitle = (skeleton as any).competency.title as string;
  const competencyDesc = (skeleton as any).competency.description ?? "";
  const lfTitle = (skeleton as any).learning_field?.title ?? "";

  const promptUserTpl = (template.prompt_user as string | null) ??
    `Generiere drei Sektionen für "{competency_title}" im "{curriculum_title}". intro (200-260 Wörter), pain_points (220-300 Wörter), expert_tip (130-180 Wörter).`;
  const promptSystem = (template.prompt_system as string | null) ??
    `Du bist erfahrener IHK-Prüfer und Lerncoach. Schreibe ehrlich, prüfungsnah, ohne Floskeln. Nutze nur Fakten aus dem mitgelieferten Kontext.`;
  const userPrompt = promptUserTpl
    .replaceAll("{competency_title}", competencyTitle)
    .replaceAll("{curriculum_title}", curriculumTitle) +
    `\n\nKontext (Strict-RAG):\n- Curriculum: ${curriculumTitle}\n- Lernfeld: ${lfTitle}\n- Kompetenz: ${competencyTitle}\n- Beschreibung: ${competencyDesc}\n\nAntworte als reines JSON: {"intro": "...", "pain_points": "...", "expert_tip": "..."} — keine Markdown-Codefences.`;

  // 3) AI
  const model = "google/gemini-3-flash-preview";
  let ai;
  let aiLastError: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      ai = await callLovableAi(promptSystem, userPrompt, model);
      aiLastError = null;
      break;
    } catch (e: any) {
      aiLastError = e;
      console.error("seo_intent_ai_attempt_failed", {
        attempt: attempt + 1,
        package_id: packageId,
        curriculum_id,
        competency_id,
        intent_template,
        error: String(e?.message ?? e),
      });
      if (attempt < 2) await sleep(AI_RETRY_BACKOFF_MS[attempt]);
    }
  }
  if (!ai) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `ai_failed:${aiLastError?.message ?? aiLastError}` }).eq("id", job.id);
    return json(502, { error: "ai_failed", detail: String(aiLastError?.message ?? aiLastError) }, origin);
  }

  // 4) QC
  const templateForbidden = ((template.qc_rules_json as any)?.forbidden_phrases ?? []) as string[];
  const qc = runQc(ai.sections, curriculumTitle, templateForbidden);

  if (payload.dry_run) {
    return json(200, { qc, sections: ai.sections, skeleton }, origin);
  }

  if (!qc.ok) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `qc_failed:${qc.reasons.join(",")}` }).eq("id", job.id);
    await supabase.from("auto_heal_log").insert({
      action_type: "seo_intent_page_qc_failed",
      target_type: "seo_intent_page",
      target_id: null,
      result_status: "failed",
      metadata: { curriculum_id, competency_id, intent_template, persona_type: persona, qc, model },
    });
    return json(422, { error: "qc_failed", qc, sections: ai.sections }, origin);
  }

  // 5) UPSERT
  const sk = skeleton as any;
  const upsertRow = {
    package_id: packageId,
    curriculum_id,
    competency_id,
    intent_template,
    persona_type: persona,
    page_type: "intent_page",
    slug: sk.slug as string,
    title: sk.h1 as string,
    meta_description: sk.meta_description as string,
    sections_json: {
      h1: sk.h1,
      breadcrumbs: sk.breadcrumbs,
      intro: ai.sections.intro,
      pain_points: ai.sections.pain_points,
      expert_tip: ai.sections.expert_tip,
      internal_links: sk.internal_links,
      cta: sk.cta,
    },
    faq_json: sk.faq_seed,
    status: "published",
    quality_score: qc.quality_score,
    last_generated_at: new Date().toISOString(),
    generation_source: "hybrid_ssot_ai",
    generation_model: model,
    generation_cost_eur: ai.cost_eur,
  };

  // Manual upsert: partial unique index can't be used by PostgREST onConflict
  const { data: existing } = await supabase
    .from("seo_content_pages")
    .select("id")
    .eq("curriculum_id", curriculum_id)
    .eq("competency_id", competency_id)
    .eq("intent_template", intent_template)
    .eq("persona_type", persona)
    .maybeSingle();

  let upserted: any = null;
  let upErr: any = null;
  if (existing?.id) {
    const r = await supabase.from("seo_content_pages").update(upsertRow as any).eq("id", existing.id).select("id, slug, quality_score").maybeSingle();
    upserted = r.data; upErr = r.error;
  } else {
    const r = await supabase.from("seo_content_pages").insert(upsertRow as any).select("id, slug, quality_score").maybeSingle();
    upserted = r.data; upErr = r.error;
  }

  if (upErr) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `upsert_failed:${upErr.message}` }).eq("id", job.id);
    return json(500, { error: "upsert_failed", detail: upErr.message }, origin);
  }

  if (job) {
    await supabase.from("job_queue").update({
      status: "completed",
      result: { page_id: upserted?.id, slug: upserted?.slug, quality_score: qc.quality_score },
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  await supabase.from("auto_heal_log").insert({
    action_type: "seo_intent_page_generated",
    target_type: "seo_intent_page",
    target_id: upserted?.id ?? null,
    result_status: "success",
    metadata: {
      curriculum_id, competency_id, intent_template, persona_type: persona,
      slug: upserted?.slug, quality_score: qc.quality_score, words: qc.total_words, model,
    },
  });

  return json(200, { ok: true, page: upserted, qc }, origin);
});
