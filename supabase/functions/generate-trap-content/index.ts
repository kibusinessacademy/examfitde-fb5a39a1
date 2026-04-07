import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const GARBAGE_STRINGS = ["undefined", "null", "none", "n/a", "keine", "placeholder", "todo", "tbd"];

function validateTrapContent(content: any): { valid: boolean; reason?: string } {
  if (!content) return { valid: false, reason: "No content returned" };
  if (!content.title || content.title.length < 10) return { valid: false, reason: "Title too short" };
  if (!content.content_md || content.content_md.length < 200) return { valid: false, reason: "Content too short (min 200 chars)" };
  if (!content.hook || content.hook.length < 15) return { valid: false, reason: "Hook too short" };
  if (!content.meta_description || content.meta_description.length < 30) return { valid: false, reason: "Meta description too short" };

  // Garbage string detection
  for (const field of ["title", "hook", "content_md", "meta_description"]) {
    const val = (content[field] || "").trim().toLowerCase();
    if (GARBAGE_STRINGS.includes(val)) {
      return { valid: false, reason: `Field '${field}' contains garbage value` };
    }
  }

  // Title must not be identical to hook
  if (content.title.trim() === content.hook.trim()) {
    return { valid: false, reason: "Title identical to hook" };
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
    const { curriculum_id, limit = 5 } = body;

    if (!curriculum_id) {
      return new Response(JSON.stringify({ error: "curriculum_id required" }), { status: 400, headers });
    }

    // Get curriculum info
    const { data: curriculum } = await sb
      .from("curricula")
      .select("title, slug")
      .eq("id", curriculum_id)
      .single();

    if (!curriculum) {
      return new Response(JSON.stringify({ error: "Curriculum not found" }), { status: 400, headers });
    }

    // Direct query for unique trap_tags from approved MC/SC questions
    let trapTypes: { trap_type: string; count: number; competency_id: string | null }[] = [];

    const { data: rawTraps } = await sb
      .from("exam_questions")
      .select("trap_tags, competency_id, question_type")
      .eq("curriculum_id", curriculum_id)
      .eq("status", "approved")
      .not("trap_tags", "is", null);

    if (rawTraps) {
      const trapMap = new Map<string, { count: number; competency_id: string | null }>();
      for (const q of rawTraps) {
        // Only count MC/SC questions
        const qType = (q as any).question_type || "multiple_choice";
        if (!["multiple_choice", "single_choice"].includes(qType)) continue;
        for (const tag of ((q as any).trap_tags || [])) {
          const existing = trapMap.get(tag) || { count: 0, competency_id: (q as any).competency_id };
          existing.count++;
          trapMap.set(tag, existing);
        }
      }
      trapTypes = Array.from(trapMap.entries())
        .map(([trap_type, info]) => ({ trap_type, ...info }))
        .filter(t => t.count >= 3)
        .sort((a, b) => b.count - a.count);
    }

    // Filter out already-created trap pages (unique constraint protects too)
    const { data: existingPages } = await sb
      .from("trap_content_pages")
      .select("trap_type")
      .eq("curriculum_id", curriculum_id);

    const existingSet = new Set((existingPages || []).map(p => p.trap_type));
    const newTraps = trapTypes.filter(t => !existingSet.has(t.trap_type)).slice(0, limit);

    if (newTraps.length === 0) {
      return new Response(JSON.stringify({ message: "All trap types covered", total: trapTypes.length }), { status: 200, headers });
    }

    const results: any[] = [];

    for (const trap of newTraps) {
      try {
        // Get MC-only example questions
        const { data: examples } = await sb
          .from("exam_questions")
          .select("question_text, options, correct_answer, explanation, difficulty, question_type")
          .eq("curriculum_id", curriculum_id)
          .eq("status", "approved")
          .contains("trap_tags", [trap.trap_type])
          .limit(5);

        const mcExamples = (examples || []).filter(
          (e: any) => !e.question_type || ["multiple_choice", "single_choice"].includes(e.question_type)
        ).slice(0, 3);

        // Block if no MC examples available
        if (mcExamples.length === 0) {
          results.push({ trap_type: trap.trap_type, status: "skipped", reason: "No MC/SC examples available" });
          continue;
        }

        const slug = `${curriculum.slug}-${trap.trap_type.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}`;

        const prompt = `
Du bist SEO-Content-Redakteur für ExamFit, ein Prüfungstrainings-System.
Erstelle eine Seite über einen typischen Prüfungsfehler.

BERUF: ${curriculum.title}
FEHLERTYP: ${trap.trap_type}
HÄUFIGKEIT: ${trap.count} Fragen mit diesem Fehlertyp

BEISPIELFRAGEN:
${mcExamples.map((e: any, i: number) => `${i + 1}. ${e.question_text}\n   Richtig: ${e.correct_answer}\n   Erklärung: ${e.explanation || '-'}`).join('\n\n')}

Erstelle:
1. title: SEO-optimierter Titel (max 60 Zeichen), z.B. "Häufiger IHK-Fehler: ${trap.trap_type}"
2. hook: Provokanter 1-Satz-Teaser (max 150 Zeichen)
3. content_md: Markdown-Artikel (500-800 Wörter) mit:
   - Warum dieser Fehler so häufig ist
   - Wie man ihn erkennt
   - Wie man ihn vermeidet
   - Praxisbeispiel
   - CTA zu ExamFit
4. meta_description: SEO Meta-Description (max 155 Zeichen)
5. social_linkedin: LinkedIn-Post (max 300 Zeichen)
6. social_instagram: Instagram-Caption (max 200 Zeichen)

WICHTIG: Referenziere die Beispielfragen korrekt. Vermeide faktische Fehler. Verwende KEINE Platzhalter.
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
              { role: "system", content: "Du erzeugst streng strukturierten SEO-Content. Gib NUR valides JSON zurück." },
              { role: "user", content: prompt },
            ],
            tools: [{
              type: "function",
              function: {
                name: "return_trap_content",
                description: "Return the generated trap content page",
                parameters: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    hook: { type: "string" },
                    content_md: { type: "string" },
                    meta_description: { type: "string" },
                    social_linkedin: { type: "string" },
                    social_instagram: { type: "string" },
                  },
                  required: ["title", "hook", "content_md", "meta_description"],
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "return_trap_content" } },
          }),
        });

        if (!llmResp.ok) {
          results.push({ trap_type: trap.trap_type, error: `LLM error: ${llmResp.status}` });
          continue;
        }

        const llmData = await llmResp.json();
        const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
        let content: any;
        if (toolCall?.function?.arguments) {
          try {
            content = JSON.parse(toolCall.function.arguments);
          } catch {
            results.push({ trap_type: trap.trap_type, error: "Failed to parse LLM arguments" });
            continue;
          }
        } else {
          const raw = llmData.choices?.[0]?.message?.content;
          try {
            content = raw ? JSON.parse(raw) : null;
          } catch {
            results.push({ trap_type: trap.trap_type, error: "Failed to parse LLM response" });
            continue;
          }
        }

        // Quality Gate
        const validation = validateTrapContent(content);
        const publishStatus = validation.valid ? "published" : "draft";

        // Insert page (unique constraint on curriculum_id, trap_type prevents duplicates)
        const { data: page, error: insertError } = await sb.from("trap_content_pages").upsert({
          curriculum_id,
          competency_id: trap.competency_id,
          trap_type: trap.trap_type,
          slug,
          title: content?.title || `Prüfungsfehler: ${trap.trap_type}`,
          hook: content?.hook || "",
          content_md: content?.content_md || "",
          examples_json: mcExamples,
          social_captions: {
            linkedin: content?.social_linkedin || "",
            instagram: content?.social_instagram || "",
          },
          seo_meta: {
            meta_description: content?.meta_description || "",
          },
          status: publishStatus,
        }, { onConflict: "curriculum_id,trap_type" }).select("id").single();

        if (insertError) {
          results.push({ trap_type: trap.trap_type, error: insertError.message });
        } else {
          results.push({
            trap_type: trap.trap_type,
            status: publishStatus === "published" ? "created" : "draft_quality_gate",
            quality_issue: validation.valid ? null : validation.reason,
            page_id: page?.id,
            slug,
          });
        }
      } catch (innerError) {
        results.push({ trap_type: trap.trap_type, error: innerError instanceof Error ? innerError.message : "Unknown error" });
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    return new Response(JSON.stringify({ success: true, results }), { status: 200, headers });
  } catch (error) {
    console.error("[generate-trap-content] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});
