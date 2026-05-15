// SEO Pillar Page Generator — Pillar/Hub Foundation v1
// Strict-RAG: curriculum + learning_fields + competencies + published intent-spokes.
// 4 sections (intro, curriculum_overview, learning_journey, exam_strategy) >= 800 words.
// Hard QC gate. UPSERT into seo_content_pages with page_type='pillar_page'.
// Slug-SSOT: fn_normalize_curriculum_slug(curricula.title) — same as intent-spoke prefix.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

interface Payload {
  job_id?: string;
  curriculum_id?: string;
  package_id?: string;
  dry_run?: boolean;
}

const FORBIDDEN = [
  "in der heutigen zeit",
  "maßgeschneidert",
  "tauche ein",
  "egal ob anfänger oder profi",
  "dieser artikel zeigt dir alles",
  "in der schnelllebigen welt",
  "spannende reise",
];

const REQUIRED_SECTIONS = ["intro", "curriculum_overview", "learning_journey", "exam_strategy"];
const MIN_WORDS = 800;
const MAX_WORDS = 2200;
const MIN_FAQ = 5;
const MIN_INTERNAL_LINKS = 6;
const AI_RETRY_BACKOFF_MS = [5_000, 10_000, 20_000];
const MODEL = "google/gemini-3-flash-preview";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function wordCount(s: string) { return (s.trim().match(/\S+/g) ?? []).length; }
function isInsertConflict(err: any) {
  return err?.code === "23505" || String(err?.message ?? "").toLowerCase().includes("duplicate key");
}

async function callLovableAi(systemPrompt: string, userPrompt: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.55,
    }),
  });
  if (res.status === 429) throw new Error("ai_rate_limited");
  if (res.status === 402) throw new Error("ai_credits_exhausted");
  if (!res.ok) throw new Error(`ai_http_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error("ai_invalid_json"); }
  return parsed;
}

function runQc(
  parsed: any,
  curriculumTitle: string,
  internalLinkCount: number,
): { ok: boolean; reasons: string[]; total_words: number; quality_score: number } {
  const reasons: string[] = [];
  const sections: Record<string, string> = {};
  for (const sec of REQUIRED_SECTIONS) {
    const v = parsed?.sections?.[sec];
    sections[sec] = typeof v === "string" ? v : "";
    if (!sections[sec] || sections[sec].trim().length < 120) {
      reasons.push(`section_too_short:${sec}`);
    }
  }
  const combined = REQUIRED_SECTIONS.map((s) => sections[s] ?? "").join("\n\n");
  const total = wordCount(combined);
  if (total < MIN_WORDS) reasons.push(`words_too_few:${total}<${MIN_WORDS}`);
  if (total > MAX_WORDS) reasons.push(`words_too_many:${total}>${MAX_WORDS}`);

  const lower = combined.toLowerCase();
  for (const phrase of FORBIDDEN) {
    if (lower.includes(phrase)) reasons.push(`forbidden_phrase:${phrase}`);
  }

  // Pflichtbegriff: erstes signifikantes Wort des Curriculums
  const curriculumToken = curriculumTitle
    .replace(/^Rahmenlehrplan\s+/i, "")
    .split(/[\s\-(/]+/)[0]
    ?.toLowerCase() ?? "";
  if (curriculumToken && curriculumToken.length > 2 && !lower.includes(curriculumToken)) {
    reasons.push(`missing_curriculum_token:${curriculumToken}`);
  }

  // FAQ
  const faq = Array.isArray(parsed?.faq) ? parsed.faq : [];
  if (faq.length < MIN_FAQ) reasons.push(`faq_too_few:${faq.length}<${MIN_FAQ}`);
  for (const item of faq) {
    if (!item?.question || !item?.answer || String(item.answer).length < 60) {
      reasons.push("faq_item_invalid");
      break;
    }
  }

  // H1 + Meta
  if (!parsed?.h1 || String(parsed.h1).length < 12) reasons.push("h1_invalid");
  if (!parsed?.meta_description || String(parsed.meta_description).length < 80 || String(parsed.meta_description).length > 175) {
    reasons.push("meta_description_invalid");
  }

  if (internalLinkCount < MIN_INTERNAL_LINKS) {
    reasons.push(`internal_links_too_few:${internalLinkCount}<${MIN_INTERNAL_LINKS}`);
  }

  const score = Math.max(0, 100 - reasons.length * 10);
  return { ok: reasons.length === 0, reasons, total_words: total, quality_score: score };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: Payload;
  try { payload = await req.json(); } catch { return json(400, { error: "invalid_json_body" }, origin); }

  // Optional: hydrate from job
  let job: any = null;
  if (payload.job_id) {
    const { data } = await supabase.from("job_queue")
      .select("id, payload, status, attempts").eq("id", payload.job_id).maybeSingle();
    if (!data) return json(404, { error: "job_not_found" }, origin);
    job = data;
    const p = (data.payload ?? {}) as Payload;
    payload.curriculum_id ??= p.curriculum_id;
    payload.package_id ??= p.package_id;
    await supabase.from("job_queue")
      .update({ status: "processing", attempts: (data.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", payload.job_id);
  }

  if (!payload.curriculum_id) return json(400, { error: "missing_curriculum_id" }, origin);
  const curriculumId = payload.curriculum_id;

  // 1) Curriculum + Slug-SSOT
  const { data: curriculum } = await supabase
    .from("curricula").select("id, title, description")
    .eq("id", curriculumId).maybeSingle();
  if (!curriculum) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: "curriculum_missing" }).eq("id", job.id);
    return json(404, { error: "curriculum_missing" }, origin);
  }

  const { data: slugRow } = await supabase.rpc("fn_normalize_curriculum_slug", { p_title: curriculum.title });
  const curriculumSlug = String(slugRow ?? "").trim();
  if (!curriculumSlug) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: "slug_normalization_failed" }).eq("id", job.id);
    return json(500, { error: "slug_normalization_failed" }, origin);
  }

  // 2) Package
  let packageId = payload.package_id ?? null;
  if (!packageId) {
    const { data: pkg } = await supabase.from("course_packages")
      .select("id, package_key, status, published_at")
      .eq("curriculum_id", curriculumId).eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (!pkg?.id) {
      if (job) await supabase.from("job_queue").update({ status: "failed", last_error: "no_published_package" }).eq("id", job.id);
      return json(409, { error: "no_published_package_for_curriculum" }, origin);
    }
    packageId = pkg.id;
  }

  // 3) Strict-RAG context
  const { data: lfs } = await supabase.from("learning_fields")
    .select("id, code, title, description, hours, sort_order")
    .eq("curriculum_id", curriculumId).order("sort_order", { ascending: true });

  const lfIds = (lfs ?? []).map((l: any) => l.id);
  const { data: comps } = lfIds.length
    ? await supabase.from("competencies")
        .select("id, learning_field_id, code, title, description, exam_relevance_tier, sort_order")
        .in("learning_field_id", lfIds).order("sort_order", { ascending: true })
    : { data: [] as any[] };

  const { data: spokes } = await supabase.from("seo_content_pages")
    .select("id, slug, title, meta_description, intent_template, quality_score, persona_type, competency_id")
    .eq("curriculum_id", curriculumId).eq("page_type", "intent_page")
    .eq("status", "published").gte("quality_score", 80)
    .order("quality_score", { ascending: false }).limit(40);

  const spokeList = spokes ?? [];
  if (spokeList.length < 3) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `insufficient_spokes:${spokeList.length}` }).eq("id", job.id);
    return json(409, { error: "insufficient_spokes", spoke_count: spokeList.length }, origin);
  }

  // Internal links: spokes + curriculum overview link itself counts only as self → exclude.
  const internalLinks = spokeList.slice(0, 24).map((s: any) => ({
    href: `/${s.slug}`,
    label: s.title,
    intent: s.intent_template,
  }));

  // 4) Prompt (Strict-RAG)
  const ragLfs = (lfs ?? []).slice(0, 12).map((l: any) =>
    `- ${l.code ?? ""} ${l.title}${l.description ? ` — ${String(l.description).slice(0, 220)}` : ""}`
  ).join("\n");

  const ragComps = (comps ?? []).slice(0, 30).map((c: any) =>
    `- [${c.code ?? ""}] ${c.title}${c.exam_relevance_tier ? ` (Prüfungsrelevanz: ${c.exam_relevance_tier})` : ""}`
  ).join("\n");

  const ragSpokes = spokeList.slice(0, 18).map((s: any) =>
    `- /${s.slug} — ${s.title} (${s.intent_template})`
  ).join("\n");

  const curriculumToken = curriculum.title
    .replace(/^Rahmenlehrplan\s+/i, "")
    .split(/[\s\-(/]+/)[0] ?? curriculum.title;

  const systemPrompt =
    `Du bist erfahrener IHK-Prüfer und Lerncoach für die Ausbildung "${curriculum.title}". ` +
    `Schreibe sachlich, prüfungsnah, ohne Marketing-Floskeln. ` +
    `Nutze AUSSCHLIESSLICH Fakten aus dem mitgelieferten Strict-RAG-Kontext. ` +
    `Erfinde keine Lernfelder, Kompetenzen, Prüfungsteile oder Statistiken.`;

  const userPrompt = [
    `Generiere eine Pillar-Page (Hub-Seite) für "${curriculum.title}".`,
    ``,
    `Antwortformat: JSON-Objekt mit den Feldern h1, meta_description, sections (Objekt mit intro, curriculum_overview, learning_journey, exam_strategy), faq (Array von {question, answer}).`,
    ``,
    `Pflichtanforderungen:`,
    `- h1: starker, klarer H1 mit "${curriculumToken}", max. 70 Zeichen`,
    `- meta_description: 120–170 Zeichen, mit "${curriculumToken}" und Nutzen`,
    `- sections.intro: 180–260 Wörter, ehrlicher Einstieg, Zielgruppe Azubi`,
    `- sections.curriculum_overview: 220–320 Wörter, fasst Lernfelder und Prüfungsstruktur faktentreu zusammen`,
    `- sections.learning_journey: 200–280 Wörter, beschreibt typische Lernphasen, Reihenfolge der Kompetenzen`,
    `- sections.exam_strategy: 180–260 Wörter, prüfungsnahe Strategie (typische Fehler, Zeitmanagement, Wiederholungslogik)`,
    `- Gesamt aller vier Sektionen >= 800 Wörter (Hard-QC-Gate)`,
    `- Pflichtbegriff "${curriculumToken}" muss in mindestens 3 Sektionen vorkommen`,
    `- faq: mindestens 5 prägnante Fragen mit Antworten >= 60 Zeichen`,
    `- KEINE Floskeln ("in der heutigen Zeit", "spannende Reise", "tauche ein", "maßgeschneidert", "egal ob Anfänger oder Profi")`,
    `- KEINE Markdown-Codefences im Output, reines JSON`,
    ``,
    `Strict-RAG Kontext (NUR diese Fakten verwenden):`,
    ``,
    `Curriculum:`,
    `Titel: ${curriculum.title}`,
    `Beschreibung: ${(curriculum.description ?? "").slice(0, 600)}`,
    ``,
    `Lernfelder (${(lfs ?? []).length}):`,
    ragLfs || "(keine)",
    ``,
    `Kompetenzen (Auswahl, ${(comps ?? []).length} insgesamt):`,
    ragComps || "(keine)",
    ``,
    `Bereits veröffentlichte Intent-Spokes für interne Verlinkung (${spokeList.length}):`,
    ragSpokes,
    ``,
    `Wichtig: Verweise im Fließtext NICHT mit URLs auf die Spokes (die Verlinkung passiert im Frontend). Du sollst aber die Themen der Spokes inhaltlich aufgreifen, damit die Hub-Seite als Einstiegsknoten funktioniert.`,
  ].join("\n");

  // 5) AI mit Retry
  let parsed: any = null;
  let aiErr: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { parsed = await callLovableAi(systemPrompt, userPrompt); aiErr = null; break; }
    catch (e: any) {
      aiErr = e;
      console.error("seo_pillar_ai_attempt_failed", { attempt: attempt + 1, curriculum_id: curriculumId, error: String(e?.message ?? e) });
      if (attempt < 2) await sleep(AI_RETRY_BACKOFF_MS[attempt]);
    }
  }
  if (!parsed) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `ai_failed:${aiErr?.message ?? aiErr}` }).eq("id", job.id);
    return json(502, { error: "ai_failed", detail: String(aiErr?.message ?? aiErr) }, origin);
  }

  // 6) QC
  const qc = runQc(parsed, curriculum.title, internalLinks.length);

  if (payload.dry_run) {
    return json(200, { qc, parsed, slug: curriculumSlug, internal_links: internalLinks.length }, origin);
  }

  if (!qc.ok || qc.quality_score < 80) {
    if (job) await supabase.from("job_queue").update({ status: "failed", last_error: `qc_failed:${qc.reasons.join(",")}` }).eq("id", job.id);
    await supabase.from("auto_heal_log").insert({
      action_type: "seo_pillar_page_qc_failed",
      target_type: "seo_pillar_page",
      target_id: null,
      result_status: "failed",
      metadata: { curriculum_id: curriculumId, package_id: packageId, slug: curriculumSlug, qc, model: MODEL },
    });
    return json(422, { error: "qc_failed", qc }, origin);
  }

  // 7) UPSERT (slug = curriculum_slug, page_type='pillar_page', competency_id NULL)
  const sectionsJson = {
    h1: parsed.h1,
    breadcrumbs: [
      { label: "Start", href: "/" },
      { label: "Kurse", href: "/kurse" },
      { label: parsed.h1, href: `/kurse/${curriculumSlug}` },
    ],
    intro: parsed.sections.intro,
    curriculum_overview: parsed.sections.curriculum_overview,
    learning_journey: parsed.sections.learning_journey,
    exam_strategy: parsed.sections.exam_strategy,
    internal_links: internalLinks,
    cta: { label: "Prüfung starten", href: `/pruefungstrainer/${curriculumSlug}` },
  };

  const upsertRow = {
    package_id: packageId,
    curriculum_id: curriculumId,
    competency_id: null,
    intent_template: null,
    persona_type: "azubi",
    page_type: "pillar_page",
    slug: curriculumSlug,
    title: parsed.h1,
    meta_description: parsed.meta_description,
    sections_json: sectionsJson,
    faq_json: parsed.faq,
    status: "published",
    quality_score: qc.quality_score,
    last_generated_at: new Date().toISOString(),
    generation_source: "pillar_strict_rag",
    generation_model: MODEL,
    generation_cost_eur: 0,
  };

  // robust upsert by (curriculum_id, page_type='pillar_page')
  const existingRes = await supabase.from("seo_content_pages")
    .select("id").eq("curriculum_id", curriculumId).eq("page_type", "pillar_page").maybeSingle();

  let upserted: any = null;
  let upErr: any = null;

  if (existingRes.data?.id) {
    const r = await supabase.from("seo_content_pages")
      .update(upsertRow as any).eq("id", existingRes.data.id)
      .select("id, slug, quality_score").maybeSingle();
    upserted = r.data; upErr = r.error;
  } else {
    const r = await supabase.from("seo_content_pages")
      .insert(upsertRow as any)
      .select("id, slug, quality_score").maybeSingle();
    upserted = r.data; upErr = r.error;
    if (upErr && isInsertConflict(upErr)) {
      const e2 = await supabase.from("seo_content_pages")
        .select("id").eq("curriculum_id", curriculumId).eq("page_type", "pillar_page").maybeSingle();
      if (e2.data?.id) {
        const r2 = await supabase.from("seo_content_pages")
          .update(upsertRow as any).eq("id", e2.data.id)
          .select("id, slug, quality_score").maybeSingle();
        upserted = r2.data; upErr = r2.error;
      }
    }
  }

  if (upErr) {
    console.error("seo_pillar_pages_upsert_failed", upErr);
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
    action_type: "seo_pillar_page_generated",
    target_type: "seo_pillar_page",
    target_id: upserted?.id ?? null,
    result_status: "success",
    metadata: {
      curriculum_id: curriculumId,
      package_id: packageId,
      slug: curriculumSlug,
      quality_score: qc.quality_score,
      words: qc.total_words,
      faq_count: Array.isArray(parsed.faq) ? parsed.faq.length : 0,
      internal_links: internalLinks.length,
      model: MODEL,
    },
  });

  return json(200, { ok: true, page: upserted, slug: curriculumSlug, qc, internal_links: internalLinks.length }, origin);
});
