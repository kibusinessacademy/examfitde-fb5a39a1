import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const { packageId, store } = body; // store: "apple" | "google"

  if (!packageId || !store) return json({ error: "packageId and store required" }, 400);

  try {
    // Fetch package + course data
    const { data: pkg } = await sb.from("v_admin_packages_ssot" as any).select("*").eq("package_id", packageId).maybeSingle();
    if (!pkg) return json({ error: "Package not found" }, 404);

    const title = (pkg as any).canonical_title || (pkg as any).title || "Kurs";
    const courseId = (pkg as any).course_id;

    // Fetch curriculum for context
    let curriculumTitle = "";
    let competencies: string[] = [];
    if ((pkg as any).curriculum_id) {
      const { data: curr } = await sb.from("curricula").select("title, beruf").eq("id", (pkg as any).curriculum_id).maybeSingle();
      if (curr) curriculumTitle = (curr as any).title || "";

      const { data: comps } = await sb.from("competencies").select("title").eq("curriculum_id", (pkg as any).curriculum_id).limit(20);
      competencies = (comps || []).map((c: any) => c.title);
    }

    // Count content
    let lessonCount = 0;
    let questionCount = 0;
    if (courseId) {
      const { data: mods } = await sb.from("modules").select("id").eq("course_id", courseId);
      const modIds = (mods || []).map((m: any) => m.id);
      if (modIds.length > 0) {
        const { count: lc } = await sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", modIds).eq("status", "published");
        lessonCount = lc || 0;
      }
      const { count: qc } = await sb.from("questions").select("id", { count: "exact", head: true }).eq("course_id", courseId).eq("qc_status", "approved");
      questionCount = qc || 0;
    }

    const storeType = store === "apple" ? "Apple App Store" : "Google Play Store";
    const maxShort = store === "apple" ? 30 : 80;
    const maxLong = store === "apple" ? 4000 : 4000;

    const currentYear = new Date().getFullYear();
    const copyrightNotice = `© ${currentYear} ExamFit – Alle Rechte vorbehalten.`;

    const systemPrompt = `Du bist ein Senior App Store Optimization (ASO) Spezialist und erfahrener App-Marketing-Experte für den deutschen Bildungsmarkt.

Erstelle ein vollständiges, sofort verwendbares ${storeType} Listing für eine Lern-App.

WICHTIG:
- Alle Texte auf DEUTSCH
- ASO-optimiert mit relevanten Keywords
- Conversion-optimiert (hohe Download-Rate)
- Compliance mit ${store === "apple" ? "Apple App Store Review Guidelines" : "Google Play Store Policies"}
- Realistische Feature-Beschreibungen basierend auf den echten Inhalten
- COPYRIGHT-HINWEIS: Füge "${copyrightNotice}" in die long_description ein (am Ende)
- RECHTEHINWEIS: Erwähne in der Beschreibung, dass alle Inhalte urheberrechtlich geschützt sind`;

    const prompt = `Erstelle ein komplettes ${storeType} Listing für folgende Lern-App:

**App-Name:** ExamFit – ${title}
**Beruf/Zertifizierung:** ${curriculumTitle || title}
**Inhalte:** ${lessonCount} Lektionen, ${questionCount}+ Prüfungsfragen
**Kompetenzen:** ${competencies.slice(0, 10).join(", ")}
**Copyright:** ${copyrightNotice}

Erstelle folgende Felder als JSON mit diesen Keys:

1. "app_name" – App-Name (max 30 Zeichen)
2. "subtitle" – Untertitel (max ${maxShort} Zeichen)
3. "short_description" – Kurzbeschreibung (max ${maxShort} Zeichen, nur Google Play)
4. "long_description" – Ausführliche Beschreibung (max ${maxLong} Zeichen, mit Emojis und Formatierung). MUSS am Ende "${copyrightNotice}" enthalten.
5. "keywords" – Komma-getrennte Keywords (max 100 Zeichen, nur Apple)
6. "category" – Empfohlene Kategorie
7. "content_rating" – Altersfreigabe-Empfehlung
8. "whats_new" – Release Notes für v1.0
9. "privacy_policy_points" – Array mit 5-8 Datenschutz-Kernpunkten (DSGVO + ${store === "apple" ? "App Tracking Transparency" : "Google Play Data Safety"})
10. "screenshot_texts" – Array mit 5-6 Screenshot-Overlay-Texten (kurz, conversion-optimiert)
11. "dsa_info" – DSA-Händlerinformationen Template
12. "technical_requirements" – Object mit min_os_version, devices, permissions[]
13. "checklist" – Array mit allen Schritten zur Store-Veröffentlichung (inklusive Copyright-Registrierung)
14. "aso_tips" – Array mit 3-5 ASO-Optimierungstipps
15. "copyright_notice" – Vollständiger Copyright-Text: "${copyrightNotice} Alle Inhalte, Texte, Grafiken und Software sind Eigentum von ExamFit. Jede Vervielfältigung bedarf der schriftlichen Genehmigung."
16. "legal_footer" – Rechtshinweis für Store-Seite`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "store_listing",
            description: "Complete app store listing metadata",
            parameters: {
              type: "object",
              properties: {
                app_name: { type: "string" },
                subtitle: { type: "string" },
                short_description: { type: "string" },
                long_description: { type: "string" },
                keywords: { type: "string" },
                category: { type: "string" },
                content_rating: { type: "string" },
                whats_new: { type: "string" },
                privacy_policy_points: { type: "array", items: { type: "string" } },
                screenshot_texts: { type: "array", items: { type: "string" } },
                dsa_info: { type: "string" },
                technical_requirements: {
                  type: "object",
                  properties: {
                    min_os_version: { type: "string" },
                    devices: { type: "string" },
                    permissions: { type: "array", items: { type: "string" } },
                  },
                },
                checklist: { type: "array", items: { type: "string" } },
                aso_tips: { type: "array", items: { type: "string" } },
                copyright_notice: { type: "string" },
                legal_footer: { type: "string" },
              },
              required: ["app_name", "long_description", "category", "checklist", "copyright_notice"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "store_listing" } },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI error:", aiRes.status, errText);
      if (aiRes.status === 429) return json({ error: "Rate limit – bitte kurz warten" }, 429);
      if (aiRes.status === 402) return json({ error: "AI-Credits erschöpft" }, 402);
      return json({ error: "AI generation failed" }, 500);
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let listing: any = {};
    if (toolCall?.function?.arguments) {
      listing = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    }

    return json({
      ok: true,
      store,
      package_id: packageId,
      title,
      content_stats: { lessons: lessonCount, questions: questionCount, competencies: competencies.length },
      listing,
      capacitor_config: {
        appId: "app.lovable.ad51e8f96cff41cf9723b4e49dbcd9db",
        appName: "ExamFit.de",
        platform: store === "apple" ? "ios" : "android",
      },
    });
  } catch (err) {
    console.error("generate-store-listing error:", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
});
