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

    // Find trap types with enough questions that don't have pages yet
    const { data: trapData } = await sb.rpc("get_trap_coverage_for_curriculum" as any, {
      p_curriculum_id: curriculum_id,
    }).catch(() => ({ data: null }));

    // Fallback: direct query for unique trap_tags
    let trapTypes: { trap_type: string; count: number; competency_id: string | null }[] = [];

    const { data: rawTraps } = await sb
      .from("exam_questions")
      .select("trap_tags, competency_id")
      .eq("curriculum_id", curriculum_id)
      .eq("status", "approved")
      .not("trap_tags", "is", null);

    if (rawTraps) {
      const trapMap = new Map<string, { count: number; competency_id: string | null }>();
      for (const q of rawTraps) {
        for (const tag of (q.trap_tags || [])) {
          const existing = trapMap.get(tag) || { count: 0, competency_id: q.competency_id };
          existing.count++;
          trapMap.set(tag, existing);
        }
      }
      trapTypes = Array.from(trapMap.entries())
        .map(([trap_type, info]) => ({ trap_type, ...info }))
        .filter(t => t.count >= 3)
        .sort((a, b) => b.count - a.count);
    }

    // Filter out already-created trap pages
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
      // Get example questions for this trap
      const { data: examples } = await sb
        .from("exam_questions")
        .select("question_text, options, correct_answer, explanation, difficulty")
        .eq("curriculum_id", curriculum_id)
        .eq("status", "approved")
        .contains("trap_tags", [trap.trap_type])
        .limit(3);

      const slug = `${curriculum.slug}-${trap.trap_type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').slice(0, 50)}`;

      const prompt = `
Du bist SEO-Content-Redakteur für ExamFit, ein Prüfungstrainings-System.
Erstelle eine Seite über einen typischen Prüfungsfehler.

BERUF: ${curriculum.title}
FEHLERTYP: ${trap.trap_type}
HÄUFIGKEIT: ${trap.count} Fragen mit diesem Fehlertyp

BEISPIELFRAGEN:
${(examples || []).map((e, i) => `${i + 1}. ${e.question_text}\n   Richtig: ${e.correct_answer}\n   Erklärung: ${e.explanation || '-'}`).join('\n\n')}

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
        content = JSON.parse(toolCall.function.arguments);
      } else {
        const raw = llmData.choices?.[0]?.message?.content;
        content = raw ? JSON.parse(raw) : null;
      }

      if (!content) {
        results.push({ trap_type: trap.trap_type, error: "No LLM content" });
        continue;
      }

      // Insert page
      const { data: page, error: insertError } = await sb.from("trap_content_pages").insert({
        curriculum_id,
        competency_id: trap.competency_id,
        trap_type: trap.trap_type,
        slug,
        title: content.title,
        hook: content.hook,
        content_md: content.content_md,
        examples_json: examples || [],
        social_captions: {
          linkedin: content.social_linkedin || "",
          instagram: content.social_instagram || "",
        },
        seo_meta: {
          meta_description: content.meta_description,
        },
        status: "published",
      }).select("id").single();

      if (insertError) {
        results.push({ trap_type: trap.trap_type, error: insertError.message });
      } else {
        results.push({ trap_type: trap.trap_type, status: "created", page_id: page?.id, slug });
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
