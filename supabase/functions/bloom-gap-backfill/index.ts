/**
 * Bloom Gap Backfill — Targeted understand question generation
 * 
 * For each competency with <12% understand coverage, generates
 * new understand-level questions and inserts them as 'pending'.
 * 
 * Input: { curriculum_id, max_competencies?, questions_per_competency? }
 * Auth: Admin only (internal edge-to-edge or admin JWT)
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { assertNoContamination } from "../_shared/contamination-guard.ts";
import { shouldSoftStop } from "../_shared/time-budget.ts";

const UNDERSTAND_GATE_PCT = 12;
const META_TEXT_PATTERNS = [
  /\bich muss\b/i, /\bich ändere\b/i, /\btippfehler\b/i,
  /\bes tut mir leid\b/i, /\bich habe einen fehler\b/i,
  /\bich korrigiere\b/i, /\bich prüfe\b/i, /\blass mich\b/i,
];

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const auth = await validateAuth(req, true);
  if (auth.error) {
    return auth.error === "Admin access required"
      ? forbiddenResponse(auth.error)
      : unauthorizedResponse(auth.error);
  }

  try {
    const {
      curriculum_id,
      max_competencies = 15,
      questions_per_competency = 5,
      dry_run = false,
    } = await req.json();

    if (!curriculum_id) throw new Error("MISSING curriculum_id");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve profession name
    const prof = await resolveProfession(supabase, { curriculumId: curriculum_id });
    const professionName = prof.professionName;
    console.log(`[bloom-backfill] Profession: ${professionName}, curriculum: ${curriculum_id}`);

    // Find competencies with understand deficit
    const { data: compStats, error: statsErr } = await supabase.rpc("get_competency_bloom_stats", {
      p_curriculum_id: curriculum_id,
    });

    // Fallback: direct query if RPC doesn't exist
    let targets: Array<{
      competency_id: string;
      comp_title: string;
      lf_title: string;
      total: number;
      understand_ct: number;
      understand_pct: number;
      needed: number;
    }>;

    if (statsErr || !compStats) {
      console.log("[bloom-backfill] RPC not available, using direct query");
      const { data: rawStats } = await supabase
        .from("exam_questions")
        .select("competency_id, cognitive_level")
        .eq("curriculum_id", curriculum_id)
        .eq("status", "approved");

      if (!rawStats || rawStats.length === 0) throw new Error("No approved questions found");

      // Aggregate per competency
      const byComp = new Map<string, { total: number; understand: number }>();
      for (const q of rawStats) {
        const entry = byComp.get(q.competency_id) || { total: 0, understand: 0 };
        entry.total++;
        if (q.cognitive_level === "understand") entry.understand++;
        byComp.set(q.competency_id, entry);
      }

      // Load competency + LF titles
      const compIds = [...byComp.keys()];
      const { data: compData } = await supabase
        .from("competencies")
        .select("id, title, learning_field_id, learning_fields(title)")
        .in("id", compIds);

      const compMap = new Map<string, { title: string; lf_title: string }>();
      for (const c of compData || []) {
        compMap.set(c.id, {
          title: c.title,
          lf_title: (c as any).learning_fields?.title || "Unbekannt",
        });
      }

      targets = [];
      for (const [compId, stats] of byComp) {
        const pct = (100 * stats.understand) / stats.total;
        if (pct < UNDERSTAND_GATE_PCT) {
          const needed = Math.ceil((UNDERSTAND_GATE_PCT / 100) * stats.total) - stats.understand;
          const meta = compMap.get(compId);
          targets.push({
            competency_id: compId,
            comp_title: meta?.title || "?",
            lf_title: meta?.lf_title || "?",
            total: stats.total,
            understand_ct: stats.understand,
            understand_pct: Math.round(pct * 10) / 10,
            needed: Math.max(needed, 0),
          });
        }
      }
      targets.sort((a, b) => b.needed - a.needed);
    } else {
      targets = compStats;
    }

    // Cap to max_competencies
    const batch = targets.slice(0, max_competencies);
    console.log(`[bloom-backfill] ${targets.length} competencies below gate, processing ${batch.length}`);

    if (dry_run) {
      return new Response(
        JSON.stringify({ dry_run: true, targets: batch, total_needed: batch.reduce((s, t) => s + t.needed, 0) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Generate understand questions per competency
    const chain = await getModelChainAsync("exam_questions");
    const startMs = Date.now();
    const results: Array<{ competency_id: string; generated: number; inserted: number; errors: string[] }> = [];
    let totalInserted = 0;

    for (const target of batch) {
      if (shouldSoftStop(startMs, "exam_pool_fanout")) {
        console.log("[bloom-backfill] Soft stop reached, stopping generation loop");
        break;
      }

      const genCount = Math.min(target.needed, questions_per_competency);
      if (genCount <= 0) continue;

      const errors: string[] = [];

      try {
        const systemPrompt = buildSystemPrompt(professionName, genCount);
        const userPrompt = buildUserPrompt(professionName, target.lf_title, target.comp_title, genCount);

        const result = await callAIWithFailover(
          chain.map((c) => ({ provider: c.provider, model: c.model })),
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.7,
          },
        );

        if (!result.content) {
          errors.push("No AI content");
          results.push({ competency_id: target.competency_id, generated: 0, inserted: 0, errors });
          continue;
        }

        const cleanContent = result.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        let questions;
        try {
          questions = JSON.parse(cleanContent);
        } catch {
          errors.push("JSON parse failed");
          results.push({ competency_id: target.competency_id, generated: 0, inserted: 0, errors });
          continue;
        }

        // Validate & filter
        const valid = questions.filter((q: any, idx: number) => {
          const ca = typeof q.correct_answer === "number" ? q.correct_answer : parseInt(q.correct_answer);
          if (isNaN(ca) || ca < 0 || ca >= (q.options?.length || 4)) {
            errors.push(`Q${idx}: bad correct_answer`);
            return false;
          }
          for (const p of META_TEXT_PATTERNS) {
            if (p.test(q.explanation || "")) {
              errors.push(`Q${idx}: meta-text`);
              return false;
            }
          }
          try {
            assertNoContamination(q.question_text + " " + (q.explanation || ""), professionName, `backfill-q${idx}`);
          } catch (e) {
            errors.push(`Q${idx}: contamination`);
            return false;
          }
          return true;
        });

        // Insert as pending
        if (valid.length > 0) {
          const rows = valid.map((q: any) => ({
            question_text: q.question_text,
            options: q.options,
            correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : parseInt(q.correct_answer),
            explanation: q.explanation,
            difficulty: q.difficulty || "medium",
            cognitive_level: "understand",
            competency_id: target.competency_id,
            curriculum_id,
            ai_generated: true,
            status: "pending",
          }));

          const { error: insertErr } = await supabase.from("exam_questions").insert(rows);
          if (insertErr) {
            errors.push(`Insert error: ${insertErr.message}`);
          } else {
            totalInserted += rows.length;
          }
          results.push({
            competency_id: target.competency_id,
            generated: valid.length,
            inserted: insertErr ? 0 : rows.length,
            errors,
          });
        } else {
          results.push({ competency_id: target.competency_id, generated: 0, inserted: 0, errors });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        results.push({ competency_id: target.competency_id, generated: 0, inserted: 0, errors });
      }
    }

    console.log(`[bloom-backfill] Done: ${totalInserted} questions inserted across ${results.length} competencies`);

    return new Response(
      JSON.stringify({
        success: true,
        curriculum_id,
        profession: professionName,
        competencies_processed: results.length,
        total_inserted: totalInserted,
        total_gap_competencies: targets.length,
        results,
        elapsed_ms: Date.now() - startMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[bloom-backfill] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function buildSystemPrompt(professionName: string, count: number): string {
  return `Du bist ein erfahrener IHK-Prüfungsexperte für ${professionName}. Du erstellst ausschließlich VERSTEHEN-Fragen (Bloom K2).

KOGNITIVE STUFE: UNDERSTAND (K2) — PFLICHT für ALLE Fragen
- Zusammenhänge erklären
- Bedeutung/Funktion beschreiben  
- Prinzipien erläutern
- Unterschiede benennen und begründen
- Auswirkungen beschreiben
- KEIN reines Faktenabrufen (das wäre recall/K1)
- KEINE Berechnungen (das wäre apply/K3)
- KEINE Fehleranalyse (das wäre analyze/K4)

TYPISCHE FRAGEMUSTER FÜR K2:
- "Welche Funktion hat... und warum?"
- "Worin liegt der Unterschied zwischen... und...?"
- "Warum ist... in der Praxis von ${professionName} wichtig?"
- "Welche Auswirkung hat... auf...?"
- "Was bewirkt... bei...?"

REGELN:
- Jede Frage hat genau 4 Antwortmöglichkeiten (Index 0-3)
- Nur eine Antwort ist korrekt
- Konkreter Praxisbezug zu ${professionName}
- Distraktoren bilden typische Verständnisfehler ab
- Ausführliche Erklärung mit Fachbegriffen
- KEINE generischen Fragen ohne Berufsbezug

Antworte AUSSCHLIESSLICH mit einem validen JSON-Array:
[
  {
    "question_text": "...",
    "options": ["A", "B", "C", "D"],
    "correct_answer": 0,
    "explanation": "...",
    "difficulty": "easy|medium|hard",
    "cognitive_level": "understand"
  }
]`;
}

function buildUserPrompt(
  professionName: string,
  lfTitle: string,
  compTitle: string,
  count: number,
): string {
  return `Erstelle ${count} VERSTEHEN-Fragen (Bloom K2) für ${professionName}.

Lernfeld: ${lfTitle}
Kompetenz: ${compTitle}

PFLICHT: Jede Frage muss Zusammenhänge, Funktionen oder Prinzipien abfragen — KEIN reines Wissen, KEINE Berechnungen.
Schwierigkeitsverteilung: 1 leicht, ${Math.max(count - 2, 1)} mittelschwer, ${count > 2 ? "1 schwer" : ""}
correct_answer muss 0, 1, 2 oder 3 sein.`;
}
