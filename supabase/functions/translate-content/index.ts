// translate-content: Translate course / lesson / question content via Lovable AI Gateway.
//
// Modes (POST body):
//   { mode: "translate_one", entity_type, entity_id, language }
//   { mode: "drain_jobs", limit?: number }     // pulls queued translation_jobs and runs them
//   { mode: "enqueue_backfill", language, entity_type?, limit? }  // creates jobs for missing/stale translations
//
// Strict-RAG style: we only translate provided source text. No invented content.
// EXTEND_ONLY: never mutates source tables.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const LANGS = ["en", "tr", "ar", "uk", "ru"] as const;
type Lang = typeof LANGS[number] | "de";

const LANG_LABEL: Record<string, string> = {
  en: "English",
  tr: "Turkish (Türkçe)",
  ar: "Arabic (العربية, MSA)",
  uk: "Ukrainian (Українська)",
  ru: "Russian (Русский)",
  de: "German (Deutsch)",
};

const MODEL_VOLUME = "google/gemini-2.5-flash";

function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", buf).then((d) =>
    Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

async function callGateway(systemPrompt: string, userPrompt: string, model = MODEL_VOLUME) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("AI did not return valid JSON");
  }
}

function systemPrompt(targetLang: string) {
  return `You are a professional translator for German vocational training (Berufsausbildung) content.
Translate from German into ${LANG_LABEL[targetLang]}.

Rules:
- Preserve meaning, tone, and didactic structure exactly.
- Preserve Markdown / HTML formatting and any code blocks.
- Keep German legal / regulatory references (e.g. "BBiG §1", "IHK", "AEVO", "DIN") in original form, but you MAY add a brief gloss in parentheses when first introduced.
- Do NOT invent content, examples, or facts. If a field is empty/null, return an empty string.
- Return ONLY valid JSON with the requested keys. No prose, no markdown fences.`;
}

// ---------- handlers per entity ----------

async function translateCourse(supa: any, courseId: string, language: string) {
  const { data: course, error } = await supa
    .from("courses").select("id,title,description").eq("id", courseId).maybeSingle();
  if (error || !course) throw new Error(`course ${courseId} not found`);
  const src = JSON.stringify({ title: course.title ?? "", description: course.description ?? "" });
  const hash = await sha256Hex(`v1:${src}`);

  const result = await callGateway(
    systemPrompt(language),
    `Translate this course metadata. Return JSON with keys: title, description.\n\nSOURCE:\n${src}`
  );

  await supa.from("course_translations").upsert({
    course_id: courseId,
    language,
    title: result.title ?? "",
    description: result.description ?? "",
    source_hash: hash,
    status: "published",
    model: MODEL_VOLUME,
  }, { onConflict: "course_id,language" });
}

async function translateLesson(supa: any, lessonId: string, language: string) {
  const { data: lesson, error } = await supa
    .from("lessons").select("id,title,content,summary").eq("id", lessonId).maybeSingle();
  if (error || !lesson) throw new Error(`lesson ${lessonId} not found`);
  const src = JSON.stringify({
    title: lesson.title ?? "",
    content: lesson.content ?? "",
    summary: lesson.summary ?? "",
  });
  const hash = await sha256Hex(`v1:${src}`);

  const result = await callGateway(
    systemPrompt(language),
    `Translate this lesson. Return JSON with keys: title, content, summary.\nPreserve Markdown formatting in content.\n\nSOURCE:\n${src}`
  );

  await supa.from("lesson_translations").upsert({
    lesson_id: lessonId,
    language,
    title: result.title ?? "",
    content: result.content ?? "",
    summary: result.summary ?? "",
    source_hash: hash,
    status: "published",
    model: MODEL_VOLUME,
  }, { onConflict: "lesson_id,language" });
}

async function translateQuestion(supa: any, questionId: string, language: string) {
  const { data: q, error } = await supa
    .from("exam_questions")
    .select("id,prompt,options,explanation")
    .eq("id", questionId).maybeSingle();
  if (error || !q) throw new Error(`question ${questionId} not found`);
  const src = JSON.stringify({
    prompt: q.prompt ?? "",
    options: q.options ?? null,
    explanation: q.explanation ?? "",
  });
  const hash = await sha256Hex(`v1:${src}`);

  const result = await callGateway(
    systemPrompt(language),
    `Translate this exam question. Return JSON with keys: prompt (string), options (same JSON shape as input, with all human-readable text translated; keep keys/ids/values that are not natural language), explanation (string).\n\nSOURCE:\n${src}`
  );

  await supa.from("question_translations").upsert({
    question_id: questionId,
    language,
    prompt: result.prompt ?? "",
    options: result.options ?? null,
    explanation: result.explanation ?? "",
    source_hash: hash,
    status: "published",
    model: MODEL_VOLUME,
  }, { onConflict: "question_id,language" });
}

async function runOne(supa: any, entityType: string, entityId: string, language: string) {
  if (entityType === "course") return translateCourse(supa, entityId, language);
  if (entityType === "lesson") return translateLesson(supa, entityId, language);
  if (entityType === "question") return translateQuestion(supa, entityId, language);
  throw new Error(`unknown entity_type ${entityType}`);
}

// ---------- backfill enqueue ----------

async function enqueueBackfill(supa: any, language: string, entityType?: string, limit = 500) {
  const types = entityType ? [entityType] : ["course", "lesson", "question"];
  const rows: any[] = [];

  for (const t of types) {
    const table = t === "course" ? "courses" : t === "lesson" ? "lessons" : "exam_questions";
    const { data, error } = await supa.from(table).select("id").limit(limit);
    if (error) continue;
    for (const r of data ?? []) {
      rows.push({ entity_type: t, entity_id: r.id, language, status: "queued" });
    }
  }
  if (rows.length === 0) return { enqueued: 0 };
  // upsert dedup on (entity_type,entity_id,language)
  const { error } = await supa.from("translation_jobs").upsert(rows, {
    onConflict: "entity_type,entity_id,language",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return { enqueued: rows.length };
}

async function drainJobs(supa: any, limit = 10) {
  const { data: jobs, error } = await supa
    .from("translation_jobs")
    .select("*")
    .eq("status", "queued")
    .order("priority", { ascending: true })
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const results: any[] = [];

  for (const job of jobs ?? []) {
    await supa.from("translation_jobs").update({
      status: "running", started_at: new Date().toISOString(),
      attempts: (job.attempts ?? 0) + 1,
    }).eq("id", job.id);
    try {
      await runOne(supa, job.entity_type, job.entity_id, job.language);
      await supa.from("translation_jobs").update({
        status: "done", finished_at: new Date().toISOString(), last_error: null,
      }).eq("id", job.id);
      results.push({ id: job.id, ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      await supa.from("translation_jobs").update({
        status: "failed", finished_at: new Date().toISOString(), last_error: msg,
      }).eq("id", job.id);
      results.push({ id: job.id, ok: false, error: msg });
    }
  }
  return { processed: results.length, results };
}

// ---------- entry ----------

Deno.serve(async (req) => {
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;
  const origin = req.headers.get("origin");

  try {
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" }, origin);
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? "translate_one";

    if (mode === "translate_one") {
      const { entity_type, entity_id, language } = body;
      if (!entity_type || !entity_id || !language) {
        return json(400, { error: "entity_type, entity_id, language required" }, origin);
      }
      await runOne(supa, entity_type, entity_id, language);
      return json(200, { ok: true }, origin);
    }
    if (mode === "drain_jobs") {
      const r = await drainJobs(supa, body.limit ?? 10);
      return json(200, r, origin);
    }
    if (mode === "enqueue_backfill") {
      const { language, entity_type, limit } = body;
      if (!language) return json(400, { error: "language required" }, origin);
      const r = await enqueueBackfill(supa, language, entity_type, limit ?? 500);
      return json(200, r, origin);
    }
    return json(400, { error: `unknown mode ${mode}` }, origin);
  } catch (e) {
    return json(500, { error: (e as Error).message }, origin);
  }
});
