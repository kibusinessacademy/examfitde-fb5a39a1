import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { curriculum_id, mode = "single" } = body;

    // Determine curricula to process
    let curriculumIds: string[] = [];

    if (mode === "batch") {
      // Get all P1 curricula
      const { data: packages } = await sb
        .from("course_packages")
        .select("curriculum_id")
        .in("build_status", ["published", "building"])
        .not("curriculum_id", "is", null);
      curriculumIds = [...new Set((packages || []).map((p: any) => p.curriculum_id))];
    } else if (curriculum_id) {
      curriculumIds = [curriculum_id];
    } else {
      return new Response(JSON.stringify({ error: "curriculum_id required for single mode" }), { status: 400, headers });
    }

    const results: any[] = [];

    for (const cid of curriculumIds) {
      // 1. Pick question via RPC
      const { data: pickResult, error: pickError } = await sb.rpc("fn_pick_daily_question", {
        p_curriculum_id: cid,
      });

      if (pickError) {
        results.push({ curriculum_id: cid, error: pickError.message });
        continue;
      }

      if (pickResult?.already_picked) {
        results.push({ curriculum_id: cid, status: "already_picked", pick_id: pickResult.pick_id });
        continue;
      }

      if (pickResult?.error) {
        results.push({ curriculum_id: cid, error: pickResult.error });
        continue;
      }

      const pickId = pickResult.pick_id;
      const questionId = pickResult.question_id;

      // 2. Load question + curriculum context
      const { data: question } = await sb
        .from("exam_questions")
        .select("question_text, options, correct_answer, explanation, difficulty, trap_tags, cognitive_level")
        .eq("id", questionId)
        .single();

      const { data: curriculum } = await sb
        .from("curricula")
        .select("title, slug")
        .eq("id", cid)
        .single();

      if (!question || !curriculum) {
        results.push({ curriculum_id: cid, error: "question or curriculum not found" });
        continue;
      }

      // 3. Generate hook + explanation + social captions via LLM
      const prompt = `
Du bist der Content-Redakteur für ExamFit, ein Prüfungstrainings-System.
Erstelle für die "Frage des Tages" folgende Inhalte:

BERUF: ${curriculum.title}
FRAGE: ${question.question_text}
OPTIONEN: ${JSON.stringify(question.options)}
RICHTIGE ANTWORT: ${question.correct_answer}
ERKLÄRUNG: ${question.explanation || "Keine Erklärung vorhanden"}
SCHWIERIGKEIT: ${question.difficulty}
TYPISCHE FALLE: ${(question.trap_tags || []).join(", ")}

Erstelle:
1. hook: Ein 1-Satz-Teaser der neugierig macht (max 120 Zeichen)
2. explanation_md: Ausführliche Erklärung (Markdown, 200-400 Wörter) mit:
   - Warum die richtige Antwort richtig ist
   - Warum die Fallen-Antworten verlockend aber falsch sind
   - Praxisbezug
3. social_linkedin: LinkedIn-Post (max 300 Zeichen, professionell)
4. social_instagram: Instagram-Caption (max 200 Zeichen, mit Emojis)
5. social_tiktok: TikTok-Hook (max 100 Zeichen, provokant)
`;

      const llmResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          temperature: 0.7,
          messages: [
            { role: "system", content: "Du erzeugst streng strukturierten Content. Gib NUR valides JSON zurück." },
            { role: "user", content: prompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "return_daily_question_content",
              description: "Return the generated daily question content",
              parameters: {
                type: "object",
                properties: {
                  hook: { type: "string" },
                  explanation_md: { type: "string" },
                  social_linkedin: { type: "string" },
                  social_instagram: { type: "string" },
                  social_tiktok: { type: "string" },
                },
                required: ["hook", "explanation_md", "social_linkedin", "social_instagram", "social_tiktok"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "return_daily_question_content" } },
        }),
      });

      if (!llmResp.ok) {
        const errText = await llmResp.text();
        results.push({ curriculum_id: cid, error: `LLM error: ${llmResp.status} ${errText}` });
        continue;
      }

      const llmData = await llmResp.json();
      const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
      let content: any;
      if (toolCall?.function?.arguments) {
        content = JSON.parse(toolCall.function.arguments);
      } else {
        const raw = llmData.choices?.[0]?.message?.content;
        content = raw ? JSON.parse(raw) : null;
      }

      if (!content) {
        results.push({ curriculum_id: cid, error: "No LLM content returned" });
        continue;
      }

      // 4. Update pick with generated content
      await sb.from("daily_question_picks").update({
        hook: content.hook,
        explanation_md: content.explanation_md,
        social_captions: {
          linkedin: content.social_linkedin,
          instagram: content.social_instagram,
          tiktok: content.social_tiktok,
        },
        status: "published",
      }).eq("id", pickId);

      // 5. Enqueue to growth_content_queue
      const platforms = ["linkedin", "instagram", "tiktok"];
      for (const platform of platforms) {
        await sb.from("growth_content_queue").insert({
          channel: "question_of_day",
          source_type: "daily_question_pick",
          source_id: pickId,
          platform,
          status: "ready",
          scheduled_at: new Date().toISOString(),
          content_json: {
            hook: content.hook,
            caption: content[`social_${platform}`],
            question: question.question_text,
            curriculum: curriculum.title,
            slug: pickResult.slug,
          },
        });
      }

      results.push({
        curriculum_id: cid,
        status: "generated",
        pick_id: pickId,
        slug: pickResult.slug,
      });

      // Rate limit between curricula
      if (curriculumIds.length > 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    return new Response(JSON.stringify({ success: true, results }), { status: 200, headers });
  } catch (error) {
    console.error("[generate-daily-question] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});
