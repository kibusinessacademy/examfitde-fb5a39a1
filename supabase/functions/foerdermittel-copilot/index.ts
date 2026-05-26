// FördermittelOS CoPilot — grounded gateway adapter (Lovable AI Gateway)
// Receives a strictly typed, sanitised context payload from the client.
// Never accepts raw PDFs, free-text profiles, or program data not in our registry.
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

interface RequestPayload {
  intent: string;
  message?: string;
  context: {
    program: {
      slug: string;
      name: string;
      authority: string;
      region: string;
      status: string;
      topics: string[];
      kind: string;
      shortDescription: string;
      decisionWeeks?: number;
      deadline?: string | null;
      funding: Record<string, unknown>;
      requirements: { key: string; label: string; hard: boolean }[];
      documentsNeeded: string[];
      sources: { url: string; label: string; lastVerifiedAt?: string; official?: boolean }[];
    };
    freshness: {
      status: string;
      statusLabel: string;
      changeRisk: string;
      changeRiskLabel: string;
      lastVerifiedAt?: string;
      nextReviewAt?: string;
      sourceUrl?: string;
    };
    match?: {
      fit: number;
      probability: number;
      reasons: string[];
      warnings: string[];
      disqualifiers: string[];
    };
    readiness?: {
      score: number;
      verdict: string;
      verdictLabel: string;
      missingCriticalDocs: number;
      unmetHardRequirements: number;
    };
    risks: { key: string; label: string; severity: string; hint: string }[];
    nextActions: { key: string; label: string; priority: string; reason: string }[];
    profile?: { region: string; size: string; topics: string[] };
  };
  grounding: string;
}

const ALLOWED_INTENTS = new Set([
  "explain_program_fit",
  "explain_freshness_risk",
  "explain_application_readiness",
  "explain_missing_documents",
  "compare_programs",
  "suggest_next_step",
  "prepare_application_outline",
  "ask_clarifying_question",
  "unknown",
]);

Deno.serve(async (req) => {
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;
  const cors = getCorsHeaders(req.headers.get("Origin"));

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "ai_gateway_not_configured" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Validate
  if (!payload?.intent || !ALLOWED_INTENTS.has(payload.intent)) {
    return new Response(JSON.stringify({ error: "invalid_intent" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!payload?.context?.program?.slug || !payload?.context?.program?.name) {
    return new Response(JSON.stringify({ error: "missing_program_context" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!payload?.grounding || payload.grounding.length < 80) {
    return new Response(JSON.stringify({ error: "missing_grounding" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Hard guard against PII smuggling
  const ctxStr = JSON.stringify(payload.context);
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(ctxStr)) {
    return new Response(JSON.stringify({ error: "pii_detected" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const userMessage = (payload.message ?? "").slice(0, 800);
  const intentInstruction = intentDirective(payload.intent);

  const messages = [
    { role: "system", content: payload.grounding },
    {
      role: "system",
      content:
        "GROUNDED CONTEXT (JSON, single source of truth — keine externe Information verwenden):\n```json\n" +
        JSON.stringify(payload.context, null, 2) +
        "\n```",
    },
    { role: "system", content: intentInstruction },
    {
      role: "user",
      content:
        userMessage ||
        `Aktion ausgewählt: ${payload.intent}. Beantworte gemäß Aktion und Grounding.`,
    },
  ];

  let upstream: Response;
  try {
    upstream = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        temperature: 0.2,
      }),
    });
  } catch (e) {
    console.error("foerdermittel-copilot gateway fetch failed", e);
    return new Response(JSON.stringify({ error: "model_unavailable" }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (upstream.status === 429) {
    return new Response(
      JSON.stringify({ error: "rate_limited", message: "Bitte gleich erneut versuchen." }),
      { status: 429, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  if (upstream.status === 402) {
    return new Response(
      JSON.stringify({ error: "payment_required", message: "AI-Guthaben aufgebraucht." }),
      { status: 402, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("foerdermittel-copilot gateway error", upstream.status, text);
    return new Response(JSON.stringify({ error: "gateway_error" }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const data = await upstream.json();
  const answer: string = data?.choices?.[0]?.message?.content ?? "";

  return new Response(
    JSON.stringify({
      intent: payload.intent,
      answer,
      model: data?.model ?? DEFAULT_MODEL,
      freshness: payload.context.freshness,
      sources: payload.context.program.sources,
    }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});

function intentDirective(intent: string): string {
  switch (intent) {
    case "explain_program_fit":
      return "Erkläre Fit-Score und Wahrscheinlichkeit. Nutze match.reasons, warnings, disqualifiers. Wenn match fehlt, frage nach Profil.";
    case "explain_missing_documents":
      return "Liste fehlende Pflicht- und optionale Dokumente nur aus documentsNeeded + readiness.missingCriticalDocs. Keine erfundenen Anlagen.";
    case "explain_freshness_risk":
      return "Erkläre Aktualität, Änderungsrisiko, Topf-Auslastung, Fristen aus freshness + risks. Bei stale/unknown explizit manuelle Quellenprüfung empfehlen.";
    case "explain_application_readiness":
      return "Erkläre den Readiness-Score, Verdict und die Lücken. Nutze readiness + risks + nextActions. Keine Spekulation jenseits dieser Felder.";
    case "compare_programs":
      return "Vergleich nur möglich, wenn combinableWith im Kontext genannt ist. Sonst: erkläre warum kein Vergleich erfolgt.";
    case "suggest_next_step":
      return "Priorisiere die nextActions nach Priorität (now > soon > later) und erkläre den ersten Schritt konkret.";
    case "prepare_application_outline":
      return "Erstelle einen klar als ENTWURF gekennzeichneten Antrags-Outline mit den Sections: Projektbeschreibung, Zielsetzung, Maßnahmenplan, Kostenplan, Voraussetzungen, Anlagen. Nur auf Basis des Kontexts. Keine Geldbeträge ohne Bezug auf funding.";
    case "ask_clarifying_question":
      return "Stelle eine präzise Rückfrage, um den Kontext zu schärfen. Keine Antwortspekulation.";
    default:
      return "Frage liegt außerhalb der vordefinierten Aktionen. Bitte um Präzisierung oder Auswahl einer Action.";
  }
}
