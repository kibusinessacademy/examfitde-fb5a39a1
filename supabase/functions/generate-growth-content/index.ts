import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callLLM(prompt: string) {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "Du erzeugst streng strukturierte Marketing-Inhalte für ExamFit. Gib NUR valides JSON zurück, kein Markdown, keine Erklärungen.",
        },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_growth_content",
            description: "Return the generated growth content as structured JSON",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string" },
                hook: { type: "string" },
                caption: { type: "string" },
                cta: { type: "string" },
                hashtags: { type: "array", items: { type: "string" } },
                beats: { type: "array", items: { type: "string" } },
                slides: { type: "array", items: { type: "string" } },
                questions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { q: { type: "string" }, a: { type: "string" } },
                    required: ["q", "a"],
                  },
                },
                outline: { type: "array", items: { type: "string" } },
                keywords: { type: "array", items: { type: "string" } },
              },
              required: ["title", "hook", "cta"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_growth_content" } },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`LLM error: ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    return JSON.parse(toolCall.function.arguments);
  }
  // Fallback to content parsing
  const content = data.choices?.[0]?.message?.content;
  if (content) return JSON.parse(content);
  throw new Error("No LLM content returned");
}

function audienceInstructions(audience: string) {
  switch (audience) {
    case "azubis":
      return "ZIELGRUPPE: Azubis. TONALITÄT: direkt, motivierend, prüfungsnah. NUTZEN: Prüfung bestehen, Lücken erkennen.";
    case "betriebe":
      return "ZIELGRUPPE: Ausbildungsbetriebe. TONALITÄT: sachlich, wirtschaftlich. NUTZEN: Bestehensquote, Transparenz.";
    case "institutionen":
      return "ZIELGRUPPE: Berufsschulen. TONALITÄT: neutral, curriculum-orientiert. NUTZEN: Ergänzung zum Unterricht.";
    default:
      return "";
  }
}

function contentTypeFields(contentType: string) {
  switch (contentType) {
    case "short_video_script":
      return 'Erzeuge: title, hook, beats (string[]), cta, caption, hashtags (string[])';
    case "carousel_post":
      return 'Erzeuge: title, hook, slides (string[]), cta, caption, hashtags (string[])';
    case "social_caption":
      return 'Erzeuge: title, hook, caption, cta, hashtags (string[])';
    case "faq_snippet":
      return 'Erzeuge: title, hook, questions ([{q, a}]), cta';
    case "blog_outline":
      return 'Erzeuge: title, hook, outline (string[]), cta, keywords (string[])';
    default:
      return 'Erzeuge: title, hook, caption, cta';
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const jobId = body.job_id as string | undefined;

    let query = sb
      .from("growth_content_jobs")
      .select("id, package_id, curriculum_id, content_type, audience, platform, status, payload")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (jobId) {
      query = sb
        .from("growth_content_jobs")
        .select("id, package_id, curriculum_id, content_type, audience, platform, status, payload")
        .eq("id", jobId)
        .limit(1);
    }

    const { data: jobs, error: jobsError } = await query;
    if (jobsError) throw jobsError;
    if (!jobs || jobs.length === 0) {
      return jsonResponse({ ok: true, processed: 0, message: "No pending growth jobs." });
    }

    const job = jobs[0];

    await sb.from("growth_content_jobs").update({ status: "processing" }).eq("id", job.id);

    // Load SSOT context
    const { data: pkg } = await sb
      .from("course_packages")
      .select("title, curriculum_id")
      .eq("id", job.package_id)
      .single();

    const cid = job.curriculum_id ?? pkg?.curriculum_id;

    const { data: curriculum } = await sb
      .from("curricula")
      .select("title")
      .eq("id", cid)
      .single();

    const { data: learningFields } = await sb
      .from("learning_fields")
      .select("title, description")
      .eq("curriculum_id", cid)
      .order("sort_order", { ascending: true })
      .limit(8);

    const { data: competencies } = await sb
      .from("competencies")
      .select("title, description")
      .eq("curriculum_id", cid)
      .limit(12);

    const prompt = `
AUFGABE: Erzeuge ExamFit Growth Content.
BERUF: ${curriculum?.title ?? "Berufsausbildung"}
KURS: ${pkg?.title ?? "ExamFit Kurs"}
PLATTFORM: ${job.platform}
CONTENT_TYPE: ${job.content_type}

${audienceInstructions(job.audience)}

LERNFELDER:
${(learningFields ?? []).map((lf: any) => `- ${lf.title}`).join("\n")}

KOMPETENZEN:
${(competencies ?? []).map((c: any) => `- ${c.title}`).join("\n")}

REGELN:
- Kein generischer Motivationsspam
- Prüfungsnah und konkret
- ExamFit als intelligentes Prüfungstrainings-System positionieren
- Keine HTML-Ausgabe

${contentTypeFields(job.content_type)}
`;

    const result = await callLLM(prompt);

    await sb
      .from("growth_content_jobs")
      .update({
        status: "done",
        result,
        payload: {
          ...(job.payload ?? {}),
          package_title: pkg?.title,
          curriculum_title: curriculum?.title,
        },
      })
      .eq("id", job.id);

    return jsonResponse({ ok: true, processed: 1, job_id: job.id, result });
  } catch (error) {
    console.error("[generate-growth-content] error:", error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});
