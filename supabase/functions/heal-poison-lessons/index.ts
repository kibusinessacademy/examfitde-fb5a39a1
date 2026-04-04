import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { DEPTH_SELF_CHECK, REGULATORY_GUARD, runV2QualityGate, getRequiredDepth, mapToDifficultyLevel } from "../_shared/prompt-kit.ts";
import type { DifficultyLevel } from "../_shared/prompt-kit.ts";
import { canonicalStepKey } from "../_shared/step-keys.ts";

/**
 * heal-poison-lessons — Auto-Heal for persistently failing lessons
 *
 * Called after generate_learning_content completes with poison pills.
 * Uses escalation model chain (repair_content intent: haiku → gpt-5.2)
 * to retry each failed lesson with a different model/prompt strategy.
 *
 * If ALL retries fail → marks package for manual review.
 */

const BATCH_SIZE = 3;
const DELAY_MS = 2000;

const CONTENT_TOOL = {
  type: "function" as const,
  function: {
    name: "create_lesson_content",
    description: "Erstelle strukturierten Lerninhalt für eine Lektion.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML-Inhalt, mindestens 800 Zeichen" },
        objectives: { type: "array", items: { type: "string" }, description: "2-4 konkrete Lernziele" },
      },
      required: ["html", "objectives"],
    },
  },
};

const MINICHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 4, maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correct_answer: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string" },
            },
            required: ["question", "options", "correct_answer", "explanation"],
          },
        },
        objectives: { type: "array", items: { type: "string" } },
      },
      required: ["questions", "objectives"],
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

  try {
    const p = await req.json();
    const packageId = p.package_id;
    const courseId = p.course_id;
    const curriculumId = p.curriculum_id || p.certification_id;
    const poisonLessonIds: string[] = p.poison_lesson_ids || [];

    if (!packageId || !courseId || poisonLessonIds.length === 0) {
      return json({ error: "Missing package_id, course_id, or poison_lesson_ids" }, 400);
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load lessons to heal
    const { data: lessons, error: fetchErr } = await sb
      .from("lessons")
      .select("id, title, step, module_id, content, modules!inner(course_id, title)")
      .in("id", poisonLessonIds)
      .eq("modules.course_id", courseId);

    if (fetchErr || !lessons || lessons.length === 0) {
      return json({ error: fetchErr?.message || "No lessons found", healed: 0, failed: poisonLessonIds.length });
    }

    // Resolve profession
    let professionName = "Fachkraft";
    try {
      const resolved = await resolveProfession(sb, { curriculumId });
      professionName = resolved.professionName;
    } catch { /* fallback */ }

    // Use repair_content chain (stronger models for retry)
    const chain = await getModelChainAsync("repair_content");

    let healed = 0;
    let stillFailed = 0;
    const details: Array<{ id: string; title: string; status: string; model?: string; error?: string }> = [];

    for (const lesson of lessons.slice(0, BATCH_SIZE * 3)) { // max 9 per invocation
      const isMiniCheck = lesson.step === "mini_check";
      const moduleName = (lesson as any).modules?.title || "";

      // Simplified but robust prompt for repair
      const repairPrompt = isMiniCheck
        ? `Erstelle 4 IHK-Prüfungsfragen für:\nBeruf: ${professionName}\nModul: ${moduleName}\nLektion: ${lesson.title}\n\nExakt 4 Fragen, je 4 Optionen, plausible Distraktoren.`
        : `Erstelle ausführliches Lernmaterial (mindestens 800 Zeichen HTML) für:\n\nBeruf: ${professionName}\nModul: ${moduleName}\nLektion: ${lesson.title}\nSchritt: ${lesson.step}\n\nStruktur:\n- <h3>Fachlicher Titel</h3>\n- Ausführliche Erklärung mit Praxisbeispielen\n- Konkrete Zahlenbeispiele aus dem Berufsalltag\n- ⭐ IHK-Prüfungstipp\n- ⚠️ Typische Prüfungsfalle\n\nMINDESTENS 1000 Wörter. Schreibe wie ein erfahrener Ausbilder.`;

      try {
        const result = await callAIWithFailover(
          chain.map(c => ({ provider: c.provider, model: c.model })),
          {
            messages: [
              {
                role: "system",
                content: `IHK-Fachexperte für ${professionName}. REPARATUR: Vorherige Versuche fehlgeschlagen. Generiere sorgfältig + vollständig. Nutze die Funktion.`,
              },
              { role: "user", content: repairPrompt },
            ],
            tools: [isMiniCheck ? MINICHECK_TOOL : CONTENT_TOOL] as any,
            tool_choice: { type: "function", function: { name: isMiniCheck ? "create_mini_check" : "create_lesson_content" } },
            max_tokens: isMiniCheck ? 4096 : 8192,
          },
        );

        // Parse response
        let content: any;
        if (result.toolCalls?.length) {
          content = JSON.parse(result.toolCalls[0].function.arguments);
        } else if (result.content) {
          try { content = JSON.parse(result.content); } catch { /* */ }
        }

        if (!content || (!content.html && !content.questions)) {
          throw new Error("No parseable tool response");
        }

        // Validate non-minicheck content
        if (!isMiniCheck && (!content.html || content.html.length < 400)) {
          throw new Error(`Content too short: ${content.html?.length || 0} chars`);
        }

        // P0-A: Sanitize double-serialized html before persist
        if (!isMiniCheck && content.html && typeof content.html === "string") {
          const trimmed = content.html.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
            const cleaned = trimmed.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
            try { const inner = JSON.parse(cleaned); if (inner.html) { content.html = inner.html; content.objectives = content.objectives || inner.objectives || []; } } catch { /* not JSON */ }
          }
        }

        const finalContent = isMiniCheck
          ? { type: "mini_check", questions: content.questions, objectives: content.objectives, generated_at: new Date().toISOString(), version: 3, healed: true }
          : { type: "text", html: content.html, objectives: content.objectives, generated_at: new Date().toISOString(), version: 3, healed: true };

        // Write content version
        const { data: newVersion, error: vErr } = await sb.from("content_versions").insert({
          course_id: courseId,
          lesson_id: lesson.id,
          step_key: canonicalStepKey(lesson.step),
          content_json: finalContent,
          created_by_agent: "heal-poison-lessons",
          status: "under_review",
          council_round: 1,
          entity_type: isMiniCheck ? "minicheck" : "lesson_step",
        }).select("id").single();

        if (vErr) throw vErr;

        // NO direct lesson write — content reaches lessons.content ONLY via publish_approved_version()
        // Council proposal message
        try {
          await sb.from("council_messages").insert({
            content_version_id: newVersion!.id,
            agent_name: "heal-poison-lessons",
            message_type: "proposal",
            message_json: { source: "heal-poison", reason: "poison_pill_repair" },
          });
        } catch { /* best-effort */ }

        await logLLMCostEvent(sb, {
          job_type: "heal_poison_lesson",
          provider: result.provider,
          model: result.model,
          tokens_in: result.usage?.input_tokens || 0,
          tokens_out: result.usage?.output_tokens || 0,
          package_id: packageId,
          course_id: courseId,
          estimatedUsage: result.estimatedUsage,
        });

        healed++;
        details.push({ id: lesson.id, title: lesson.title, status: "healed", model: result.model });

      } catch (e) {
        stillFailed++;
        const errMsg = (e as Error).message || String(e);
        console.error(`[heal-poison] Failed to heal lesson ${lesson.id}: ${errMsg}`);
        details.push({ id: lesson.id, title: lesson.title, status: "failed", error: errMsg });
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    // If any lessons still failed → escalate to manual review
    if (stillFailed > 0) {
      console.warn(`[heal-poison] ${stillFailed}/${lessons.length} lessons still failing → flagging for manual review`);

      // Mark failed lessons with _needs_manual_review (via RPC — guard-safe)
      for (const d of details.filter(d => d.status === "failed")) {
        const { error: rpcErr } = await sb.rpc("pipeline_write_lesson_content_v2" as any, {
          p_lesson_id: d.id,
          p_content: { _placeholder: true, _needs_manual_review: true, _heal_failed_at: new Date().toISOString() },
          p_source: 'heal-poison-lessons',
        });
        if (rpcErr) console.error(`[heal-poison] RPC write failed for ${d.id}: ${rpcErr.message}`);
      }

      // Create admin notification
      try {
        await sb.from("admin_notifications").insert({
          title: `⚠️ ${stillFailed} Lektionen benötigen manuelle Nachbearbeitung`,
          body: `Paket ${packageId.slice(0, 8)}: Auto-Heal konnte ${stillFailed} Lektionen nicht reparieren. Bitte manuell unter Quality → Nachbearbeitung prüfen.`,
          category: "quality",
          severity: "warning",
          entity_type: "course_package",
          entity_id: packageId,
        });
      } catch { /* best-effort */ }
    }

    const allHealed = stillFailed === 0;

    return json({
      ok: true,
      batch_complete: true,
      healed,
      still_failed: stillFailed,
      all_healed: allHealed,
      details,
      message: allHealed
        ? `✅ Alle ${healed} Poison-Pill-Lektionen erfolgreich geheilt.`
        : `⚠️ ${healed} geheilt, ${stillFailed} benötigen manuelle Nachbearbeitung.`,
    });

  } catch (e) {
    console.error("[heal-poison] Fatal:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
