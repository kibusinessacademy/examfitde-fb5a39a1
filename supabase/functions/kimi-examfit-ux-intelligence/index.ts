/**
 * KIMI.EXAMFIT UX & PRODUCT INTELLIGENCE
 *
 * Experten-Council (Senior PM, UX Researcher, IHK-Prüfer, Ausbildungsleiter,
 * Azubi, Berufsschullehrer, B2B-Entscheider, Conversion-Experte, SaaS-Onboarding)
 * analysiert Route/Journey/Component/Feature/Product gegen das ExamFit-Ziel:
 *
 *   "Bringt die Plattform den Azubi schneller und sicherer zur bestandenen Prüfung?"
 *
 * Ergebnis: strukturierter Report mit Top-20-Listen, Scores, Council-Votes,
 * Roadmap. Persistiert in quality_intelligence_ux_reports.
 *
 * Read-only — keine Mutationen am Produkt.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `Du bist KIMI.EXAMFIT UX & PRODUCT INTELLIGENCE.

Du bist kein Designer, kein Entwickler. Du bist ein Expertengremium aus:
- Senior Product Manager
- UX Researcher
- Conversion Optimizer
- Ausbildungsleiter
- Berufsschullehrer
- IHK-Prüfer
- Azubi im 1. Lehrjahr
- Azubi kurz vor der Prüfung
- Ausbilder im Betrieb
- HR-Verantwortlicher
- B2B-Einkäufer
- Accessibility Spezialist
- Mobile UX Spezialist

PRODUKTKONTEXT:
ExamFit ist kein LMS. ExamFit ist ein Prüfungstrainingssystem.
Der Nutzer kauft keine Inhalte. Der Nutzer kauft Bestehenswahrscheinlichkeit,
Sicherheit, Orientierung und Prüfungserfolg. Jede UX-Entscheidung muss darauf
optimieren.

BerufOS ist die Vertical-Intelligence-Domain (Beruf-Hubs, B2B-Org-Console).

GRUNDREGEL:
Bewerte NIE Codequalität, Architektur, Datenmodell.
Bewerte AUSSCHLIESSLICH: Nutzerverständnis, Lernfluss, Motivation, Conversion,
Aktivierung, Prüfungserfolg, Vertrauen.

EXAMFIT-PRINZIPIEN (jede Oberfläche dagegen bewerten):
1. Prüfung starten
2. Prüfung simulieren
3. Schwächen erkennen
4. Schwächen beheben
5. Prüfungsreife steigern

Wenn ein Element nicht dazu beiträgt → "UNNÖTIGE KOGNITIVE LAST".

Berechne Cognitive-Load-Score (0–100, niedriger = besser).
0–30 hervorragend / 31–50 gut / 51–70 kritisch / 71–100 überladen.

Suche aktiv UX BRIDGE MISSING (Sackgassen wie MiniCheck bestanden → keine
Empfehlung; Schwäche erkannt → kein Lernpfad; Simulation abgeschlossen → keine
nächste Aktion).

Für die ONE-CLICK ENGINE: identifiziere jede Stelle, wo der Nutzer denken,
klicken, wählen oder suchen muss und gib Current-Flow → Optimized-Flow → Impact.

COUNCIL REVIEW: lass die 7 Rollen abstimmen
(azubi, ausbildungsleiter, berufsschullehrer, ihk_pruefer, ux_designer,
product_manager, conversion_spezialist) — jede Rolle vergibt Score 0–100 und
ein einsatziges Statement.

Antworte AUSSCHLIESSLICH als JSON-Objekt nach diesem Vertrag — keine Erklärungen,
keine Markdown-Code-Fences:

{
  "executive_summary": "string (max 600 Zeichen, was ist das Kernproblem/-potenzial)",
  "overall_grade": "A | A- | B+ | B | B- | C+ | C | C- | D | F",
  "scores": {
    "trust": 0, "conversion": 0, "activation": 0, "motivation": 0,
    "discoverability": 0, "workflow_efficiency": 0, "mobile_readiness": 0,
    "cognitive_load": 0
  },
  "top_ux_problems": [{"title":"","problem":"","persona_impact":"","severity":"P0|P1|P2"}],
  "quick_wins": [{"title":"","change":"","impact":"","effort":"S|M|L"}],
  "conversion_levers": [{"title":"","hypothesis":"","expected_uplift":"","priority":"P0|P1|P2"}],
  "motivation_levers": [{"title":"","intervention":"","expected_effect":""}],
  "one_click_opportunities": [{"location":"","current_flow":"","optimized_flow":"","impact":""}],
  "ux_bridges_missing": [{"from_state":"","to_state":"","why_critical":"","fix":""}],
  "cognitive_load_findings": [{"element":"","issue":"","recommendation":""}],
  "onboarding": {
    "time_to_first_exam": "string (geschätzt, z.B. '<2 Min' oder '>10 Klicks')",
    "rating": "ausgezeichnet | gut | kritisch | schlecht",
    "blockers": ["string"]
  },
  "feature_discoverability": {
    "score": 0,
    "not_found": ["pruefung_starten | pruefung_simulieren | schwaechenanalyse | tutor | lernfortschritt | pruefungsreife"]
  },
  "persona_simulation": {
    "azubi_neu": "string (1–2 Sätze)",
    "pruefungsangst": "string",
    "kurz_vor_pruefung": "string",
    "betrieb": "string",
    "institution": "string"
  },
  "council_votes": [
    {"role":"azubi","score":0,"statement":""},
    {"role":"ausbildungsleiter","score":0,"statement":""},
    {"role":"berufsschullehrer","score":0,"statement":""},
    {"role":"ihk_pruefer","score":0,"statement":""},
    {"role":"ux_designer","score":0,"statement":""},
    {"role":"product_manager","score":0,"statement":""},
    {"role":"conversion_spezialist","score":0,"statement":""}
  ],
  "roadmap": {
    "sofort": ["string"],
    "naechster_sprint": ["string"],
    "spaeter": ["string"]
  }
}

Maximal je 20 Einträge in den top_*-Listen. Wenn weniger relevant: weniger zurückgeben.
Sprache: Deutsch.`;

type Body = {
  scope_kind?: "route" | "journey" | "component" | "feature" | "product";
  scope_target?: string;
  persona?: string | null;
  product?: "examfit" | "berufos" | "shared";
  context?: string;         // freier Kontext (User-beschreibend, Snapshot, Notes)
  snapshot?: Record<string, unknown>; // optional: Route-Snapshot ähnlich reality-auditor
  model?: string;
};

function extractScore(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.min(100, Math.round(v)));
  }
  return null;
}

function buildUserPrompt(b: Body): string {
  const lines: string[] = [];
  lines.push(`Scope-Kind: ${b.scope_kind}`);
  lines.push(`Scope-Target: ${b.scope_target}`);
  lines.push(`Produkt: ${b.product ?? "examfit"}`);
  if (b.persona) lines.push(`Persona-Fokus: ${b.persona}`);
  if (b.context) {
    lines.push(`\n--- KONTEXT ---\n${String(b.context).slice(0, 8000)}\n--- END ---`);
  }
  if (b.snapshot && Object.keys(b.snapshot).length) {
    const s = JSON.stringify(b.snapshot).slice(0, 8000);
    lines.push(`\n--- SNAPSHOT ---\n${s}\n--- END ---`);
  }
  lines.push(`\nAufgabe: Erstelle den KIMI.EXAMFIT UX REPORT exakt nach Vertrag. Nur JSON.`);
  return lines.join("\n");
}

function tryParseJSON(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim(),
  ];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* ignore */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const body = (await req.json()) as Body;
    const scope_kind = body.scope_kind ?? "route";
    const scope_target = body.scope_target ?? "/";
    const product = body.product ?? "examfit";
    const model = body.model ?? "google/gemini-2.5-flash";

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // user (best effort)
    let created_by: string | null = null;
    try {
      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token) {
        const { data: u } = await supabase.auth.getUser(token);
        created_by = u?.user?.id ?? null;
      }
    } catch { /* ignore */ }

    const userPrompt = buildUserPrompt({ ...body, scope_kind, scope_target, product });

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      const status = aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 502;
      await supabase.from("quality_intelligence_ux_reports").insert({
        scope_kind, scope_target, persona: body.persona ?? null, product,
        model, duration_ms: Date.now() - t0,
        report: {}, status: "failed",
        error_text: `gateway_${aiRes.status}: ${errText.slice(0, 500)}`,
        created_by,
      });
      return new Response(JSON.stringify({ error: "ai_gateway_error", status: aiRes.status, detail: errText.slice(0, 500) }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const raw: string = aiData?.choices?.[0]?.message?.content ?? "";
    const parsed = tryParseJSON(raw);

    if (!parsed) {
      await supabase.from("quality_intelligence_ux_reports").insert({
        scope_kind, scope_target, persona: body.persona ?? null, product,
        model, duration_ms: Date.now() - t0,
        report: { raw: raw.slice(0, 4000) }, status: "failed",
        error_text: "json_parse_failed",
        created_by,
      });
      return new Response(JSON.stringify({ error: "json_parse_failed", raw_preview: raw.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const scores = (parsed.scores ?? {}) as Record<string, unknown>;

    const insertRow = {
      scope_kind, scope_target,
      persona: body.persona ?? null,
      product,
      model,
      duration_ms: Date.now() - t0,
      trust_score: extractScore(scores.trust),
      conversion_score: extractScore(scores.conversion),
      activation_score: extractScore(scores.activation),
      motivation_score: extractScore(scores.motivation),
      discoverability_score: extractScore(scores.discoverability),
      workflow_efficiency_score: extractScore(scores.workflow_efficiency),
      mobile_readiness_score: extractScore(scores.mobile_readiness),
      cognitive_load_score: extractScore(scores.cognitive_load),
      overall_grade: typeof parsed.overall_grade === "string" ? parsed.overall_grade.slice(0, 4) : null,
      report: parsed,
      status: "completed",
      created_by,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("quality_intelligence_ux_reports")
      .insert(insertRow)
      .select("id, created_at")
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: "persist_failed", detail: insErr.message, report: parsed }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      report_id: inserted!.id,
      created_at: inserted!.created_at,
      duration_ms: Date.now() - t0,
      report: parsed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: "unhandled", detail: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
