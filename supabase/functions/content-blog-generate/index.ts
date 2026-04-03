import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const count = Math.min(body.count || 10, 20);
    const programType = body.program_type || "higher_education";

    // Get random approved questions not yet used for blog articles
    const { data: questions, error: qErr } = await supabase
      .from("exam_questions")
      .select("id, question_text, correct_answer, explanation, options, difficulty, cognitive_level, curriculum_id")
      .eq("status", "approved")
      .not("question_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (qErr) throw qErr;
    if (!questions || questions.length === 0) {
      return new Response(JSON.stringify({ generated: 0, reason: "no_questions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check which questions already have blog articles
    const questionIds = questions.map((q: any) => q.id);
    const { data: existing } = await supabase
      .from("blog_articles")
      .select("source_question_id")
      .in("source_question_id", questionIds);

    const usedIds = new Set((existing || []).map((e: any) => e.source_question_id));
    const available = questions.filter((q: any) => !usedIds.has(q.id));

    if (available.length === 0) {
      return new Response(JSON.stringify({ generated: 0, reason: "all_used" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Shuffle and take `count`
    const selected = available.sort(() => Math.random() - 0.5).slice(0, count);
    const results: any[] = [];

    for (const question of selected) {
      try {
        const prompt = buildBlogPrompt(question, programType);

        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: BLOG_SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            tools: [{
              type: "function",
              function: {
                name: "create_blog_article",
                description: "Create a structured SEO blog article",
                parameters: {
                  type: "object",
                  properties: {
                    title: { type: "string", description: "SEO title, max 60 chars" },
                    slug: { type: "string", description: "URL slug, lowercase, hyphens only" },
                    meta_description: { type: "string", description: "Meta description, max 155 chars" },
                    keywords: { type: "array", items: { type: "string" }, description: "5-8 SEO keywords" },
                    content_md: { type: "string", description: "Full article in Markdown, 800-1200 words" },
                  },
                  required: ["title", "slug", "meta_description", "keywords", "content_md"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "create_blog_article" } },
          }),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          console.error(`AI error for question ${question.id}: ${aiResp.status} ${errText}`);
          if (aiResp.status === 429 || aiResp.status === 402) break;
          continue;
        }

        const aiData = await aiResp.json();
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) { console.error("No tool call in response"); continue; }

        const article = JSON.parse(toolCall.function.arguments);

        // Calculate word count and reading time
        const wordCount = article.content_md.split(/\s+/).length;
        const readingTime = Math.max(1, Math.ceil(wordCount / 200));

        // Ensure unique slug
        const uniqueSlug = `${article.slug}-${Date.now().toString(36)}`;

        const { error: insertErr } = await supabase.from("blog_articles").insert({
          slug: uniqueSlug,
          title: article.title,
          meta_description: article.meta_description,
          keywords: article.keywords,
          content_md: article.content_md,
          source_question_id: question.id,
          source_curriculum_id: question.curriculum_id,
          status: "published",
          published_at: new Date().toISOString(),
          word_count: wordCount,
          reading_time_min: readingTime,
        });

        if (insertErr) {
          console.error(`Insert error: ${insertErr.message}`);
          continue;
        }

        results.push({ slug: uniqueSlug, title: article.title, questionId: question.id });
      } catch (e) {
        console.error(`Error processing question ${question.id}:`, e);
      }
    }

    return new Response(JSON.stringify({ generated: results.length, articles: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("content-blog-generate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

const BLOG_SYSTEM_PROMPT = `Du bist ein SEO-Content-Experte für ExamFit, eine Plattform für Klausurtraining im Studium.

WICHTIG:
- Schreibe auf Deutsch
- Zielgruppe: Studierende (Bachelor/Master) die Klausuren bestehen wollen
- Positionierung: "Klausurtraining, nicht Wissensvermittlung"
- Killer-USP: "Du lernst nicht mehr. Du trainierst, zu bestehen."
- Nutze akademische Terminologie (Klausur, Modulprüfung, Semester)
- Jeder Artikel muss einen klaren Mehrwert für Studierende bieten
- Integriere natürlich CTAs zu ExamFit (nicht zu aggressiv)
- SEO-optimiert: H2/H3 Struktur, interne Verlinkung, Featured-Snippet-freundlich
- Schreibe 800-1200 Wörter
- Slug: nur Kleinbuchstaben, Bindestriche, keine Umlaute (ae/oe/ue statt ä/ö/ü)`;

function buildBlogPrompt(question: any, programType: string): string {
  const optionsText = question.options
    ? Object.entries(question.options as Record<string, string>)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  return `Erstelle einen SEO-optimierten Blogartikel basierend auf dieser Prüfungsfrage:

**Frage:** ${question.question_text}

**Antwortoptionen:**
${optionsText}

**Richtige Antwort:** ${question.correct_answer}

**Erklärung:** ${question.explanation || "Keine Erklärung verfügbar"}

**Schwierigkeit:** ${question.difficulty || "mittel"}
**Kognitive Stufe:** ${question.cognitive_level || "apply"}

Der Artikel soll:
1. Mit einem Problem-Hook starten (z.B. "Warum scheitern Studierende an dieser Aufgabe?")
2. Die Prüfungsfrage als Beispiel nutzen (aber umformuliert, nicht 1:1 kopiert)
3. Den typischen Denkfehler erklären
4. Transferwissen vermitteln (nicht nur diese Frage, sondern das Prinzip)
5. Mit einem CTA zu ExamFit enden ("Trainiere echte Prüfungsfragen auf ExamFit")
6. SEO-Keywords natürlich einbauen (Klausur, Prüfung, bestehen, Studium, Training)

Programmtyp: ${programType === "higher_education" ? "Studium (Bachelor/Master)" : "Ausbildung (IHK)"}`;
}
