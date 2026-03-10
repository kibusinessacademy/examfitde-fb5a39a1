import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const TIME_BUDGET_MS = 50_000;
const ITEMS_PER_COMPETENCY = 5;

/**
 * seed-drill-questions
 *
 * Generates drill-mode minicheck questions for a curriculum.
 * Independent of the package pipeline — used for seeding test data
 * and ensuring drill questions exist for all curricula.
 *
 * POST { curriculum_id: uuid, limit?: number }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id;
  const maxComps = Math.min(body.limit || 20, 50);

  if (!curriculumId) return json({ error: "curriculum_id required" }, 400);

  const startTime = Date.now();

  try {
    // Get profession name
    const { data: currRow } = await sb
      .from("curricula")
      .select("beruf_id, title")
      .eq("id", curriculumId)
      .maybeSingle();

    if (!currRow) return json({ error: "Curriculum not found" }, 404);

    let professionName = currRow.title || "Fachberuf";
    if (currRow.beruf_id) {
      const { data: berufRow } = await sb
        .from("berufe")
        .select("bezeichnung_kurz")
        .eq("id", currRow.beruf_id)
        .maybeSingle();
      if (berufRow) professionName = berufRow.bezeichnung_kurz;
    }

    // Get all competencies for this curriculum
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("id, title")
      .eq("curriculum_id", curriculumId);
    const lfIds = (lfs || []).map(lf => lf.id);
    if (lfIds.length === 0) return json({ error: "No learning fields" }, 404);

    const lfMap: Record<string, string> = {};
    for (const lf of lfs || []) lfMap[lf.id] = lf.title;

    const { data: allComps } = await sb
      .from("competencies")
      .select("id, title, description, learning_field_id")
      .in("learning_field_id", lfIds)
      .order("created_at", { ascending: true });

    if (!allComps?.length) return json({ error: "No competencies" }, 404);

    // Check existing drill questions
    const compIds = allComps.map(c => c.id);
    const { data: existing } = await sb
      .from("minicheck_questions")
      .select("competency_id")
      .in("competency_id", compIds)
      .eq("curriculum_id", curriculumId)
      .eq("mode", "drill");
    const existingSet = new Set((existing || []).map(e => e.competency_id));

    const toGenerate = allComps
      .filter(c => !existingSet.has(c.id))
      .slice(0, maxComps);

    if (toGenerate.length === 0) {
      return json({
        ok: true,
        message: "All competencies already have drill questions",
        existing: existingSet.size,
        total_competencies: allComps.length,
      });
    }

    console.log(`[SeedDrill] Generating for ${toGenerate.length} competencies of "${professionName}"`);

    let totalGenerated = 0;
    let totalFailed = 0;

    for (const comp of toGenerate) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`[SeedDrill] Time budget hit after ${totalGenerated} questions`);
        break;
      }

      const lfTitle = lfMap[comp.learning_field_id] || "";

      const system = `Du bist ein erfahrener IHK-Prüfungsexperte für den Beruf "${professionName}".
Erstelle exakt ${ITEMS_PER_COMPETENCY} Drill-Fragen (Micro-Training) im Multiple-Choice-Format.

REGELN:
- Jede Frage hat genau 4 Antwortoptionen (A-D)
- Genau EINE Antwort ist korrekt
- Distraktoren müssen fachlich plausibel sein (typische IHK-Fallen)
- Erklärung muss begründen, warum die richtige Antwort korrekt ist UND warum Distraktoren falsch sind
- Schwierigkeitsverteilung: 30% leicht, 40% mittel, 30% schwer
- Keine Trivialfragen — Anwendungs-/Transferfragen bevorzugen

AUSGABE: Reines JSON-Array:
[{"question_text":"...","options":[{"text":"..."},{"text":"..."},{"text":"..."},{"text":"..."}],"correct_answer":0,"explanation":"...","difficulty":"easy|medium|hard"}]`;

      const user = `Erstelle ${ITEMS_PER_COMPETENCY} Drill-Fragen für:
Lernfeld: "${lfTitle}"
Kompetenz: "${comp.title}"
${comp.description ? `Beschreibung: ${comp.description.slice(0, 1500)}` : ""}`;

      try {
        const result = await callAIJSON({
          provider: "openai" as AIProvider,
          model: "gpt-5.2",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.4,
          max_tokens: 4000,
        });

        const raw = result.content || "";
        const questions = parseJsonArray(raw);

        if (!Array.isArray(questions) || questions.length === 0) {
          totalFailed++;
          continue;
        }

        const rows = questions.map((q: any, idx: number) => ({
          lesson_id: null,
          curriculum_id: curriculumId,
          competency_id: comp.id,
          question_text: q.question_text || q.text || "",
          options: normalizeOptions(q.options),
          correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : 0,
          explanation: q.explanation || "",
          difficulty: q.difficulty || "medium",
          cognitive_level: q.cognitive_level || "understand",
          trap_tags: Array.isArray(q.trap_tags) ? q.trap_tags : [],
          distractor_meta: {},
          mode: "drill",
          status: "approved", // drill questions are approved immediately for testing
          sort_order: idx,
        }));

        const validRows = rows.filter((r: any) =>
          r.question_text.length > 10 &&
          Array.isArray(r.options) && r.options.length === 4 &&
          r.explanation.length > 10
        );

        if (validRows.length > 0) {
          const { error: insertErr } = await sb
            .from("minicheck_questions")
            .insert(validRows);

          if (insertErr) {
            console.warn(`[SeedDrill] Insert error: ${insertErr.message}`);
            totalFailed++;
          } else {
            totalGenerated += validRows.length;
          }
        } else {
          totalFailed++;
        }
      } catch (err) {
        console.warn(`[SeedDrill] AI error for ${comp.title}: ${(err as Error).message}`);
        totalFailed++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[SeedDrill] ✅ Done: ${totalGenerated} drill questions, ${totalFailed} failed, ${elapsed}ms`);

    return json({
      ok: true,
      generated: totalGenerated,
      failed: totalFailed,
      competencies_processed: toGenerate.length,
      competencies_remaining: allComps.length - existingSet.size - toGenerate.length,
      elapsed_ms: elapsed,
    });
  } catch (e: unknown) {
    console.error(`[SeedDrill] FATAL: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});

function normalizeOptions(opts: unknown): Array<{ text: string }> {
  if (!Array.isArray(opts)) return [];
  return opts.map((o: unknown) => {
    if (typeof o === "string") return { text: o.replace(/^[A-D]\)\s*/, "") };
    if (o && typeof o === "object" && "text" in (o as any)) return { text: String((o as any).text) };
    return { text: String(o) };
  });
}

function parseJsonArray(raw: string): any[] {
  let cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    const v = JSON.parse(cleaned);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray((v as any).items)) return (v as any).items;
  } catch { /* fallback */ }

  const start = cleaned.indexOf("[");
  if (start === -1) throw new Error("No JSON array found");
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "[") depth++;
    if (cleaned[i] === "]") { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)); }
  }
  throw new Error("Unclosed JSON array");
}
