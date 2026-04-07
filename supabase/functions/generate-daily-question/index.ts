import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const GARBAGE_STRINGS = ["undefined", "null", "none", "n/a", "keine", "placeholder", "todo", "tbd"];

function validateContent(content: any, correctAnswer: string): { valid: boolean; reason?: string } {
  if (!content) return { valid: false, reason: "No content returned" };

  // Check required fields exist and meet minimum lengths
  if (!content.hook || content.hook.length < 20) return { valid: false, reason: "Hook too short or missing" };
  if (!content.explanation_md || content.explanation_md.length < 100) return { valid: false, reason: "Explanation too short" };
  if (!content.social_linkedin || content.social_linkedin.length < 30) return { valid: false, reason: "LinkedIn caption missing/short" };
  if (!content.social_instagram || content.social_instagram.length < 20) return { valid: false, reason: "Instagram caption missing/short" };
  if (!content.social_tiktok || content.social_tiktok.length < 10) return { valid: false, reason: "TikTok hook missing/short" };

  // Hook must not be identical to any caption
  if (content.hook === content.social_linkedin || content.hook === content.social_instagram) {
    return { valid: false, reason: "Hook identical to social caption" };
  }

  // Explanation must reference the correct answer
  const explanationLower = content.explanation_md.toLowerCase();
  const answerLower = (correctAnswer || "").toLowerCase();
  if (answerLower && !explanationLower.includes(answerLower)) {
    return { valid: false, reason: "Explanation does not reference correct answer" };
  }

  // Garbage string detection
  for (const field of ["hook", "explanation_md", "social_linkedin", "social_instagram", "social_tiktok"]) {
    const val = (content[field] || "").trim().toLowerCase();
    if (GARBAGE_STRINGS.includes(val)) {
      return { valid: false, reason: `Field '${field}' contains garbage value: ${val}` };
    }
  }

  return { valid: true };
}

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
      // Only published packages for growth content
      const { data: packages } = await sb
        .from("course_packages")
        .select("curriculum_id")
        .eq("status", "published")
        .not("curriculum_id", "is", null);
      curriculumIds = [...new Set((packages || []).map((p: any) => p.curriculum_id))];
    } else if (curriculum_id) {
      curriculumIds = [curriculum_id];
    } else {
      return new Response(JSON.stringify({ error: "curriculum_id required for single mode" }), { status: 400, headers });
    }

    const results: any[] = [];

    for (const cid of curriculumIds) {
      try {
        // 1. Pick question via RPC (MC/SC filter is now in SQL, returns draft)
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
          .select("question_text, options, correct_answer, explanation, difficulty, trap_tags, cognitive_level, question_type")
          .eq("id", questionId)
          .single();

        const { data: curriculum } = await sb
          .from("curricula")
          .select("title, slug")
          .eq("id", cid)
          .single();

        if (!question || !curriculum) {
          // Mark pick as failed
          await sb.from("daily_question_picks").update({
            status: "failed_generation",
            skip_reason: "question or curriculum not found",
          }).eq("id", pickId);
          results.push({ curriculum_id: cid, error: "question or curriculum not found", pick_id: pickId });
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
ERKLÄRUNG: ${question.explanation || "Keine vorhanden"}
SCHWIERIGKEIT: ${question.difficulty}
TYPISCHE FALLE: ${(question.trap_tags || []).join(", ")}

Erstelle:
1. hook: Ein 1-Satz-Teaser der neugierig macht (max 120 Zeichen)
2. explanation_md: Ausführliche Erklärung (Markdown, 200-400 Wörter) mit:
   - Warum die richtige Antwort "${question.correct_answer}" richtig ist
   - Warum die Fallen-Antworten verlockend aber falsch sind
   - Praxisbezug
3. social_linkedin: LinkedIn-Post (max 300 Zeichen, professionell)
4. social_instagram: Instagram-Caption (max 200 Zeichen, mit Emojis)
5. social_tiktok: TikTok-Hook (max 100 Zeichen, provokant)

WICHTIG: Die Erklärung MUSS die richtige Antwort "${question.correct_answer}" korrekt referenzieren und erklären.
Der Hook darf NICHT identisch mit einer Social-Caption sein.
Verwende KEINE Platzhalter.
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
          await sb.from("daily_question_picks").update({
            status: "failed_generation",
            skip_reason: `LLM error: ${llmResp.status}`,
          }).eq("id", pickId);
          results.push({ curriculum_id: cid, error: `LLM error: ${llmResp.status} ${errText}`, pick_id: pickId });
          continue;
        }

        const llmData = await llmResp.json();
        const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
        let content: any;
        if (toolCall?.function?.arguments) {
          try {
            content = JSON.parse(toolCall.function.arguments);
          } catch {
            await sb.from("daily_question_picks").update({
              status: "failed_generation",
              skip_reason: "Failed to parse LLM tool call arguments",
            }).eq("id", pickId);
            results.push({ curriculum_id: cid, error: "Failed to parse LLM tool call arguments", pick_id: pickId });
            continue;
          }
        } else {
          const raw = llmData.choices?.[0]?.message?.content;
          try {
            content = raw ? JSON.parse(raw) : null;
          } catch {
            await sb.from("daily_question_picks").update({
              status: "failed_generation",
              skip_reason: "Failed to parse LLM raw response",
            }).eq("id", pickId);
            results.push({ curriculum_id: cid, error: "Failed to parse LLM raw response", pick_id: pickId });
            continue;
          }
        }

        // 4. Quality Gate
        const validation = validateContent(content, question.correct_answer);
        const publishStatus = validation.valid ? "published" : "draft";

        // 5. Update pick with generated content
        await sb.from("daily_question_picks").update({
          hook: content?.hook || "",
          explanation_md: content?.explanation_md || "",
          social_captions: {
            linkedin: content?.social_linkedin || "",
            instagram: content?.social_instagram || "",
            tiktok: content?.social_tiktok || "",
          },
          status: publishStatus,
          skip_reason: validation.valid ? null : validation.reason,
        }).eq("id", pickId);

        // 6. Only enqueue if quality passed (idempotent via unique constraint)
        if (validation.valid) {
          const platforms = ["linkedin", "instagram", "tiktok"];
          for (const platform of platforms) {
            await sb.from("growth_content_queue").upsert({
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
                content_fingerprint: pickId,
              },
            }, { onConflict: "source_type,source_id,platform,channel" });
          }
        }

        results.push({
          curriculum_id: cid,
          status: publishStatus === "published" ? "generated" : "draft_quality_gate",
          quality_issue: validation.valid ? null : validation.reason,
          pick_id: pickId,
          slug: pickResult.slug,
        });
      } catch (innerError) {
        results.push({ curriculum_id: cid, error: innerError instanceof Error ? innerError.message : "Unknown inner error" });
      }

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
