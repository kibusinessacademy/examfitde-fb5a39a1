/**
 * KIMI_REALITY_AUDITOR — Read-only P0-Reality-Findings via Kimi K2 Code-Lane.
 *
 * Drei Audit-Modi (in einer Function, lane=debug_agent, NO MUTATIONS):
 *   - reality       : tote CTAs, Whitescreens, Routing, leere States, Hydration-Drift
 *   - ux_text       : Versteht ein Azubi in 5s, was zu tun ist?
 *   - next_action   : Frage beantwortet? Nächste Aktion sichtbar?
 *
 * Eingabe (POST):
 *   {
 *     "audit_mode": "reality" | "ux_text" | "next_action",
 *     "route": "/dashboard",
 *     "snapshot": {
 *        "title"?: string,
 *        "url"?: string,
 *        "visible_text": string,        // body innerText (truncated by caller)
 *        "buttons"?: string[],          // labels
 *        "links"?: { text: string; href: string }[],
 *        "console_errors"?: string[],
 *        "screenshot_b64"?: string      // optional, kept short; image input not required
 *     },
 *     "context"?: { persona?: "azubi"|"betrieb"|"institution"; goal?: string },
 *     "model"?: string,                 // default kimi-k2-0905-preview
 *     "fallback_model"?: string         // default openai/gpt-4o-mini
 *   }
 *
 * Ausgabe: { findings: Finding[], meta: {...} }
 *   Finding = {
 *     route, severity (P0|P1|P2), kind, evidence,
 *     user_impact, reproduction_steps[], file_hint[],
 *     fix_recommendation, confidence (0..1)
 *   }
 *
 * Persistenz: Audit-Event 'kimi_reality_finding' pro Finding via fn_emit_audit.
 * Keine Auto-Fix, kein Patch, kein Merge. Mensch entscheidet.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";

type AuditMode = "reality" | "ux_text" | "next_action" | "qfaf";

const FINDING_CONTRACT = `
Antworte AUSSCHLIESSLICH als JSON-Objekt der Form:
{
  "findings": [
    {
      "route": "string",
      "severity": "P0" | "P1" | "P2",
      "kind": "string (z.B. dead_cta, white_screen, hydration_drift, empty_state, missing_next_action, unclear_ux_text, broken_route, console_error)",
      "evidence": "string — was im Snapshot belegt das Finding (Zitat oder Beobachtung)",
      "user_impact": "string — was kann der Nutzer dadurch NICHT tun?",
      "reproduction_steps": ["string", "..."],
      "file_hint": ["string — vermutete Datei/Route/Component"],
      "fix_recommendation": "string — konkret und minimal-invasiv",
      "confidence": 0.0
    }
  ]
}

Regeln:
- Severity P0 nur wenn eine fachliche Kernaufgabe unmöglich wird (siehe Beispiele: Login möglich, aber Lernen unmöglich; CTA klickbar, aber kein Folgeschritt; globaler Security-Hard-Gate; Whitescreen).
- Bei Unsicherheit: niedrigere Confidence, kein Severity-Upgrade.
- KEINE generischen Aussagen wie "wirkt unklar". Immer mit Evidence aus dem Snapshot.
- KEINE Codeänderungen vorschlagen — nur fix_recommendation als Text.
- Wenn nichts gefunden: { "findings": [] }.
`.trim();

const SYSTEM_BY_MODE: Record<AuditMode, string> = {
  reality: [
    "Du bist ein READ-ONLY Reality-Auditor für die Lovable-App ExamFit/BerufOS.",
    "Aufgabe: Finde P0/P1/P2-Blocker in einer einzelnen Route anhand eines DOM/Text-Snapshots.",
    "Suche gezielt nach: toten CTAs, Whitescreens, Routingfehlern, leeren States, fehlenden Next Actions, Hydration-Drift, UI-Inkonsistenzen, Console-Errors.",
    "Nutze nur Beweise aus dem Snapshot, keine Annahmen über nicht sichtbare Inhalte.",
    FINDING_CONTRACT,
  ].join("\n\n"),
  ux_text: [
    "Du bist ein READ-ONLY UX-Text-Auditor für Azubis (Persona: 16–25 Jahre, technisch nicht versiert).",
    "Aufgabe: Prüfe Headlines, Buttons, Empty States, Hinweise, Dialoge.",
    "Kernfrage: Versteht ein Azubi in 5 Sekunden, was er jetzt tun soll?",
    "Befund nur, wenn ein Textproblem die Handlung verzögert oder verhindert.",
    "kind sollte 'unclear_ux_text' oder 'missing_cta_label' o.ä. sein.",
    FINDING_CONTRACT,
  ].join("\n\n"),
  next_action: [
    "Du bist ein READ-ONLY Next-Action-Auditor. Regel (QFAF): Jede Seite muss eine Frage beantworten UND die nächste Aktion sichtbar machen.",
    "Du erhältst strukturierte CTA-Felder: buttons_count, links_count, cta_count, cta_labels[], testids[].",
    "CTAs umfassen <button>, [role=button] UND <a href>-Links mit sichtbarem Label — Links zählen als Aktion.",
    "Regeln:",
    "  - cta_count === 0  →  P0 'missing_next_action' (echte Sackgasse).",
    "  - cta_count > 0 aber KEIN cta_label passt semantisch zum Nutzerziel (z.B. weiter lernen / Prüfung starten / Beruf auswählen / Lernpfad / Tutor starten) → P1 'unclear_next_action' (Aktion vorhanden, aber semantisch nicht offensichtlich).",
    "  - cta_count > 0 UND mindestens ein semantisch passender Label/Testid vorhanden → KEIN Finding zurückgeben.",
    "  - Mehrere identische CTAs (z.B. 5x 'Prüfung starten') → P1 'ambiguous_primary_cta', NICHT P0.",
    "Wenn orientation_clear=nein aber Aktion da → P1 'unclear_orientation'.",
    "Bestätige im evidence-Feld immer die cta_count UND nenne die geprüften cta_labels.",
    FINDING_CONTRACT,
  ].join("\n\n"),
  qfaf: [
    "Du bist ein READ-ONLY Question-First + Action-First (QFAF) Comprehension-Auditor für Azubis (16–25, technisch nicht versiert).",
    "Persona: Authentifizierter Lernender, Ziel: Prüfung bestehen. Stell dir vor, er landet zum ERSTEN MAL auf dieser Seite und hat 5 Sekunden Zeit zum Verstehen.",
    "",
    "Beantworte für die Seite verbindlich vier Fragen, JEDE mit ja/nein + kurzer Begründung aus dem Snapshot:",
    "  Q1 ORIENTATION: Wo bin ich? Ist Seitentitel/Headline so klar, dass der Azubi ihn in einem Satz beschreiben könnte?",
    "  Q2 STAKES: Was bedeutet diese Seite für meine Prüfung? Ist der Bezug zum Prüfungsziel sichtbar (auch implizit über Kontext-Text/Badges)?",
    "  Q3 ACTION: Was ist der nächste sinnvolle Schritt? Gibt es genau EINEN klar erkennbaren Primary CTA, dessen Label das Ziel benennt?",
    "  Q4 OUTCOME: Was passiert nach dem Klick? Ist die Folge des Klicks irgendwo angedeutet (Mikrotext, Hinweis, Sequenz-Stepper, 'Du erhältst danach …')?",
    "",
    "Erzeuge ein Finding NUR für jede Frage, die mit 'nein' beantwortet wird. Verwende kind=qfaf_q1_orientation | qfaf_q2_stakes | qfaf_q3_action | qfaf_q4_outcome.",
    "Severity-Regel:",
    "  - Q3 'nein' (kein klarer next step) → P0 wenn cta_count===0, sonst P1.",
    "  - Q1 'nein' → P1 (Orientierungsverlust).",
    "  - Q2 'nein' → P2 (Relevanz unklar, aber Aktion möglich).",
    "  - Q4 'nein' → P2 (Outcome unklar, aber Klick möglich).",
    "Mehrere identische CTAs → in Q3 als 'nein' werten (ambiguous_primary).",
    "Wenn alle 4 Fragen mit 'ja' beantwortet werden → leere findings.",
    "evidence MUSS für jedes Finding die konkrete Beobachtung aus dem Snapshot zitieren (Headline-Wortlaut, CTA-Label, fehlender Outcome-Hinweis).",
    "fix_recommendation MUSS textuell und minimal-invasiv sein (z.B. 'Headline H1 ergänzen', 'Primary CTA mit Empfehlungs-Badge versehen', 'Outcome-Mikrotext unter Button').",
    FINDING_CONTRACT,
  ].join("\n\n"),


function buildUserPrompt(input: {
  audit_mode: AuditMode;
  route: string;
  snapshot: any;
  context?: any;
}) {
  const s = input.snapshot ?? {};
  const ctx = input.context ?? {};
  const lines: string[] = [];
  lines.push(`Route: ${input.route}`);
  if (ctx.persona) lines.push(`Persona: ${ctx.persona}`);
  if (ctx.goal) lines.push(`Nutzerziel: ${ctx.goal}`);
  if (s.title) lines.push(`Title: ${s.title}`);
  if (s.url) lines.push(`URL: ${s.url}`);
  // Structured CTA model (so the model doesn't have to infer "is a link a CTA?")
  const ctaCount = Number(s.cta_count ?? (Array.isArray(s.ctas) ? s.ctas.length : 0));
  const buttonsCount = Number(s.buttons_count ?? (Array.isArray(s.buttons) ? s.buttons.length : 0));
  const linksCount = Number(s.links_count ?? (Array.isArray(s.links) ? s.links.length : 0));
  lines.push(`CTA-Metrik: cta_count=${ctaCount}  buttons_count=${buttonsCount}  links_count=${linksCount}`);
  if (Array.isArray(s.cta_labels) && s.cta_labels.length) {
    lines.push(`CTA-Labels (unified, button+link+role=button): ${JSON.stringify(s.cta_labels).slice(0, 2000)}`);
  }
  if (Array.isArray(s.ctas) && s.ctas.length) {
    lines.push(`CTA-Details: ${JSON.stringify(s.ctas).slice(0, 2500)}`);
  }
  if (Array.isArray(s.testids) && s.testids.length) {
    lines.push(`Test-IDs (data-testid im DOM): ${JSON.stringify(s.testids).slice(0, 1500)}`);
  }
  if (Array.isArray(s.buttons) && s.buttons.length) {
    lines.push(`Sichtbare Buttons: ${JSON.stringify(s.buttons).slice(0, 2000)}`);
  }
  if (Array.isArray(s.links) && s.links.length) {
    lines.push(`Sichtbare Links: ${JSON.stringify(s.links).slice(0, 2000)}`);
  }
  if (Array.isArray(s.console_errors) && s.console_errors.length) {
    lines.push(`Console-Errors: ${JSON.stringify(s.console_errors).slice(0, 2000)}`);
  }
  const text = String(s.visible_text ?? "").slice(0, 8000);
  lines.push(`--- VISIBLE TEXT (truncated 8k) ---\n${text}\n--- END ---`);
  lines.push(`Audit-Mode: ${input.audit_mode}. Antworte nur als JSON gemäß Vertrag.`);
  return lines.join("\n");
}

function tryParseFindings(raw: string): any[] {
  if (!raw) return [];
  // Try direct parse, then strip code fences.
  const candidates = [raw, raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()];
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (Array.isArray(obj?.findings)) return obj.findings;
    } catch { /* try next */ }
  }
  // Last resort: regex grab first {...findings...}
  const m = raw.match(/\{[\s\S]*"findings"[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      if (Array.isArray(obj?.findings)) return obj.findings;
    } catch { /* ignore */ }
  }
  return [];
}

function normalizeFinding(f: any, route: string, mode: AuditMode) {
  const sev = ["P0", "P1", "P2"].includes(f?.severity) ? f.severity : "P2";
  const conf = typeof f?.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.5;
  return {
    route: String(f?.route ?? route),
    severity: sev,
    kind: String(f?.kind ?? "unspecified"),
    evidence: String(f?.evidence ?? "").slice(0, 2000),
    user_impact: String(f?.user_impact ?? "").slice(0, 1000),
    reproduction_steps: Array.isArray(f?.reproduction_steps)
      ? f.reproduction_steps.slice(0, 10).map((s: any) => String(s).slice(0, 500))
      : [],
    file_hint: Array.isArray(f?.file_hint)
      ? f.file_hint.slice(0, 10).map((s: any) => String(s).slice(0, 300))
      : [],
    fix_recommendation: String(f?.fix_recommendation ?? "").slice(0, 1500),
    confidence: conf,
    audit_mode: mode,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const mode = String(body?.audit_mode ?? "reality") as AuditMode;
  if (!["reality", "ux_text", "next_action", "qfaf"].includes(mode)) {
    return new Response(JSON.stringify({ error: "invalid audit_mode" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const route = String(body?.route ?? "").trim();
  if (!route) {
    return new Response(JSON.stringify({ error: "route required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body?.snapshot?.visible_text) {
    return new Response(JSON.stringify({ error: "snapshot.visible_text required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const kimiModel = String(body?.model ?? "moonshot-v1-32k");
  const fallbackModel = String(body?.fallback_model ?? "openai/gpt-4o-mini");

  const gatewayUrl = `${env("SUPABASE_URL")}/functions/v1/vibeos-ai-gateway`;
  const gwKey = env("VIBEOS_AI_GATEWAY_KEY");
  if (!gwKey) {
    return new Response(JSON.stringify({ error: "VIBEOS_AI_GATEWAY_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userPrompt = buildUserPrompt({ audit_mode: mode, route, snapshot: body.snapshot, context: body.context });

  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "vibeos-gateway-key": gwKey,
        "x-vibeos-lane": "debug_agent",
        "x-vibeos-task-type": `reality_audit_${mode}`,
      },
      body: JSON.stringify({
        model: `kimi/${kimiModel}`,
        fallback_model: fallbackModel,
        messages: [
          { role: "system", content: SYSTEM_BY_MODE[mode] },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "gateway_unreachable", detail: String(e) }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const raw = await upstream.text();
  const ms = Date.now() - t0;

  if (!upstream.ok) {
    return new Response(JSON.stringify({
      error: "gateway_error", status: upstream.status, body: raw.slice(0, 2000),
    }), { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Gateway returns OpenAI-compatible shape; extract assistant text.
  let assistantText = "";
  try {
    const j = JSON.parse(raw);
    assistantText =
      j?.choices?.[0]?.message?.content ??
      j?.message?.content ??
      j?.content ??
      "";
    if (Array.isArray(assistantText)) {
      assistantText = assistantText.map((p: any) => p?.text ?? "").join("\n");
    }
  } catch {
    assistantText = raw;
  }

  const parsed = tryParseFindings(String(assistantText));
  const findings = parsed.map((f) => normalizeFinding(f, route, mode));

  // Audit per finding (best-effort, never blocks response).
  try {
    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    if (findings.length === 0) {
      await sb.rpc("fn_emit_audit", {
        _action_type: "kimi_reality_audit_clean",
        _payload: { route, audit_mode: mode, ms, model_in: `kimi/${kimiModel}` },
      });
    } else {
      for (const f of findings) {
        await sb.rpc("fn_emit_audit", {
          _action_type: "kimi_reality_finding",
          _payload: { ...f, ms, model_in: `kimi/${kimiModel}` },
        });
      }
    }
  } catch { /* ignore audit failures */ }

  return new Response(JSON.stringify({
    findings,
    meta: {
      route, audit_mode: mode, ms,
      model_in: `kimi/${kimiModel}`,
      fallback_model: fallbackModel,
      raw_parse_ok: parsed.length > 0 || /"findings"\s*:\s*\[\s*\]/.test(assistantText),
    },
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
