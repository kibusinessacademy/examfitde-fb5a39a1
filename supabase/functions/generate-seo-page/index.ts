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
      temperature: 0.5,
      messages: [
        { role: "system", content: "Du erzeugst SEO-Seiten für ExamFit. Gib NUR valides JSON zurück." },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_seo_page",
            description: "Return the generated SEO page content",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string" },
                meta_description: { type: "string" },
                content_md: { type: "string" },
                faq_json: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { q: { type: "string" }, a: { type: "string" } },
                    required: ["q", "a"],
                  },
                },
              },
              required: ["title", "meta_description", "content_md", "faq_json"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_seo_page" } },
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
  const content = data.choices?.[0]?.message?.content;
  if (content) return JSON.parse(content);
  throw new Error("No LLM content returned");
}

// ── Persona-specific prompt instructions ──────────────────────

function personaInstructions(personaType: string, pageType: string): string {
  const base = pageTypeInstructions(pageType);

  switch (personaType) {
    case "azubi":
      return `${base}

PERSONA: AZUBI (Auszubildende)
TONALITÄT: Motivierend, verständlich, praxisnah
FOKUS:
- Abschlussprüfung bestehen als zentrales Ziel
- Typische Prüfungsfehler und wie man sie vermeidet
- Konkrete Lernstrategien für Azubis
- Sicherheit und Selbstvertrauen aufbauen
- MiniChecks und Lernkurs als Differenzierungsmerkmal erwähnen
KEYWORDS: abschlussprüfung, ihk prüfung, prüfungsvorbereitung, bestehen
VERMEIDE: Zu akademische Sprache, abstrakte Theorie`;

    case "sachkunde":
      return `${base}

PERSONA: SACHKUNDE (§34-Prüfungsteilnehmer)
TONALITÄT: Direkt, prüfungsorientiert, sachlich
FOKUS:
- Schnell und sicher bestehen
- §-Referenzen und Gesetzesgrundlagen einbauen
- Typische Fallen und Trickfragen
- Keine unnötige Theorie – nur Prüfungsrelevantes
- Zeitdruck und effizientes Lernen betonen
KEYWORDS: sachkundeprüfung, §34, prüfungsfragen, bestehen
VERMEIDE: Lange Erklärungen, didaktische Breite`;

    case "fachwirt":
      return `${base}

PERSONA: FACHWIRT (IHK-Fortbildung)
TONALITÄT: Strukturiert, professionell, praxisorientiert
FOKUS:
- Handlungsorientierte Prüfungsvorbereitung
- Fallbeispiele und Transferaufgaben
- Prüfungsstruktur der IHK-Fortbildungsprüfung erklären
- Karrierevorteil und Aufstiegschancen
- Prüfungshandbuch als Strukturhilfe erwähnen
KEYWORDS: fachwirt prüfung, ihk fortbildung, handlungsbereiche, bestehen
VERMEIDE: Zu einfache Sprache, Azubi-Tonalität`;

    case "studium":
      return `${base}

PERSONA: STUDIUM (Studierende)
TONALITÄT: Analytisch, akademisch, transferorientiert
FOKUS:
- Klausurvorbereitung und Modulprüfungen
- Verständnis statt Auswendiglernen
- Modellvergleiche und empirische Bezüge
- Transferaufgaben und Anwendung
- Lernkurs und strukturierte Wissensvermittlung
KEYWORDS: klausur vorbereitung, modulprüfung, zusammenfassung, verstehen
VERMEIDE: IHK-/Kammer-Sprache, Berufsausbildungs-Kontext`;

    default:
      return base;
  }
}

function pageTypeInstructions(pageType: string): string {
  switch (pageType) {
    case "landing_azubis":
      return "Schreibe für Azubis. Fokus: Abschlussprüfung bestehen, Sicherheit, typische Prüfungsfehler, konkrete CTA.";
    case "landing_sachkunde":
      return "Schreibe für Sachkundeprüfungs-Teilnehmer. Fokus: schnell bestehen, §-Referenzen, typische Fallen.";
    case "landing_fachwirt":
      return "Schreibe für Fachwirt-Teilnehmer. Fokus: strukturiert bestehen, Handlungskompetenz, Fallbeispiele.";
    case "landing_studium":
      return "Schreibe für Studierende. Fokus: Klausur verstehen, Transferaufgaben, analytische Tiefe.";
    case "landing_betriebe":
      return "Schreibe für Ausbildungsbetriebe. Fokus: Bestehensquote, Transparenz, Ausbildungsqualität, objektive Daten.";
    case "landing_institutionen":
      return "Schreibe für Berufsschulen/Institutionen. Fokus: Ergänzung, Neutralität, curriculum-orientiert.";
    case "faq":
      return "Erzeuge kompakte FAQ-Inhalte mit suchstarken Fragen.";
    case "blog":
      return "Erzeuge einen SEO-optimierten Blogartikel mit klarer Struktur.";
    default:
      return "Schreibe eine SEO-optimierte Produktseite.";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const pageId = body.page_id as string | undefined;

    let query = sb
      .from("seo_content_pages")
      .select("*")
      .eq("status", "draft")
      .order("created_at", { ascending: true })
      .limit(1);

    if (pageId) {
      query = sb.from("seo_content_pages").select("*").eq("id", pageId).limit(1);
    }

    const { data: pages, error } = await query;
    if (error) throw error;
    if (!pages || pages.length === 0) {
      return jsonResponse({ ok: true, processed: 0, message: "No draft SEO pages." });
    }

    const page = pages[0];
    await sb.from("seo_content_pages").update({ status: "processing" }).eq("id", page.id);

    const { data: curriculum } = await sb
      .from("curricula")
      .select("title")
      .eq("id", page.curriculum_id)
      .single();

    const { data: learningFields } = await sb
      .from("learning_fields")
      .select("title, description")
      .eq("curriculum_id", page.curriculum_id)
      .order("sort_order", { ascending: true })
      .limit(10);

    const personaType = page.persona_type ?? "azubi";

    const prompt = `
AUFGABE: Erzeuge eine SEO-Seite für ExamFit.
SEITENTYP: ${page.page_type}
PERSONA: ${personaType.toUpperCase()}
ZIELGRUPPE: ${page.target_audience ?? "allgemein"}
SLUG: ${page.slug}
CURRICULUM: ${curriculum?.title ?? "Berufsausbildung"}

LERNFELDER:
${(learningFields ?? []).map((lf: any) => `- ${lf.title}`).join("\n")}

REGELN:
- Kein Duplicate Content
- Prüfungsnah
- Klare H1 / Struktur
- Keine erfundenen Testimonials
- ExamFit als intelligentes Prüfungstrainings-System
- SEO Title unter 60 Zeichen
- Meta Description unter 160 Zeichen
- Mindestens 5 FAQ-Einträge

${personaInstructions(personaType, page.page_type)}
`;

    const result = await callLLM(prompt);

    await sb
      .from("seo_content_pages")
      .update({
        title: result.title ?? page.title,
        meta_description: result.meta_description ?? null,
        content_md: result.content_md ?? "",
        faq_json: result.faq_json ?? [],
        status: "done",
      })
      .eq("id", page.id);

    return jsonResponse({ ok: true, processed: 1, page_id: page.id, persona: personaType });
  } catch (error) {
    console.error("[generate-seo-page] error:", error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});
