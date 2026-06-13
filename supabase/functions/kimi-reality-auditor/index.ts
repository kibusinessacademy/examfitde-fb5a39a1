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

type AuditMode = "reality" | "ux_text" | "next_action" | "qfaf" | "journey";

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
    "Beantworte verbindlich vier Fragen, JEDE mit ja/nein + kurzer Begründung aus dem Snapshot:",
    "  Q1 ORIENTATION: Wo bin ich? Ist Seitentitel/Headline so klar, dass der Azubi sie in einem Satz beschreiben könnte?",
    "  Q2 STAKES: Was bedeutet diese Seite für meine Prüfung? Ist der Bezug zum Prüfungsziel sichtbar?",
    "  Q3 ACTION: Was ist der nächste sinnvolle Schritt? Gibt es EINEN klar erkennbaren Primary CTA?",
    "  Q4 OUTCOME: Was passiert nach dem Klick? Ist die Folge angedeutet (Mikrotext, Hinweis, Stepper)?",
    "",
    "STRENGE NICHT-FAIL-REGELN (KIMI.2.2):",
    "  • Q1: Wenn Title, eine H1/H2 ODER ein RouteIdentityBlock die Seite eindeutig benennt UND deine Begründung positive Marker enthält ('klar', 'eindeutig', 'in einem Satz beschreiben'), MUSST du Q1='ja' setzen. Tu das nicht, kommt der Consistency-Gate.",
    "  • Q3: Wenn EIN CTA-Label Marker wie 'Empfohlen', 'nächster Schritt', '— jetzt starten' enthält ODER ein data-testid mit '-primary-cta' / 'primary-cta' existiert ODER genau ein Primary-CTA klar dominanter ist als die anderen → Q3='ja'. Secondary-/Tertiary-CTAs (Link-style, 'zurück', 'mehr erfahren') zählen NICHT gleichwertig gegen den Primary.",
    "  • Q4: Ein Outcome-Hint unter dem Primary CTA reicht. Es ist NICHT erforderlich, dass jeder Secondary-CTA seine eigene Outcome-Microcopy hat.",
    "",
    "Severity-Regel (NEU, hart):",
    "  - Q3='nein' → P0 NUR wenn cta_count===0 (echte Sackgasse). Wenn ein Primary CTA existiert, maximal P1.",
    "  - Q1='nein' → P1.",
    "  - Q2='nein' → P2.",
    "  - Q4='nein' → P2.",
    "  - P0 ist Azubi-kann-Kernschritt-nicht-ausführen. Visuelle Mehrdeutigkeit allein ist NIE P0.",
    "",
    "Erzeuge ein Finding NUR für jede Frage mit 'nein'. Verwende kind=qfaf_q1_orientation | qfaf_q2_stakes | qfaf_q3_action | qfaf_q4_outcome.",
    "Wenn alle 4 Fragen 'ja' → leere findings.",
    "evidence MUSS konkret zitieren (Headline-Wortlaut, CTA-Label, Marker-Wort).",
    "fix_recommendation MUSS textuell und minimal-invasiv sein.",
    FINDING_CONTRACT,
  ].join("\n\n"),
  journey: [
    "Du bist ein READ-ONLY Learner-Journey-Auditor (KIMI.3) für Azubis auf ExamFit/BerufOS.",
    "Persona: Authentifizierter Lernender. Ziel: Prüfung bestehen.",
    "Du erhältst NICHT eine einzelne Seite, sondern eine SEQUENZ aus N Schritten (Route + Snapshot je Schritt). Bewertet werden NICHT die Einzelseiten (das macht QFAF), sondern die ÜBERGÄNGE zwischen den Schritten und die Geschlossenheit der Journey insgesamt.",
    "",
    "Prüfe für JEDEN Übergang Schritt N → Schritt N+1 vier Dimensionen:",
    "  T1 HANDOFF:        Macht der Primary CTA von Schritt N inhaltlich oder per Wortlaut/Route klar, dass er zu Schritt N+1 führt?",
    "  T2 ORIENTATION:    Erkennt der Nutzer auf Schritt N+1, dass er von Schritt N kommt (Bezug, Stepper, Breadcrumb, Wiederaufnahme, Kontext-Hinweis)?",
    "  T3 DEAD_END:       Hat Schritt N überhaupt einen sichtbaren Weg nach vorne (mind. ein CTA, das in die Journey weiterführt — NICHT nur 'zurück', 'mehr erfahren', 'Hilfe')?",
    "  T4 LOOP_CLOSURE:   Bietet der LETZTE Schritt nach Abschluss eine klare nächste Empfehlung (z.B. nächste Schwäche trainieren, MiniCheck wiederholen, neuen Lernpfad)? Ohne Recommendation = Journey endet im Nichts.",
    "",
    "Severity-Regeln:",
    "  - T3 verletzt (echte Sackgasse, cta_count=0 oder nur Rückkehr-CTAs) → P0 'journey_dead_end'.",
    "  - T1 verletzt (Übergang existiert, aber CTA-Wortlaut führt erkennbar woanders hin) → P1 'journey_handoff_mismatch'.",
    "  - T2 verletzt (kein Kontextbezug auf Folgeseite) → P2 'journey_orientation_loss'.",
    "  - T4 verletzt (letzter Schritt ohne Recommendation) → P1 'journey_no_recommendation'.",
    "  - Wenn alles in Ordnung → leere findings.",
    "",
    "Strenge Nicht-FAIL-Regeln:",
    "  • Wenn der Primary CTA von Schritt N eine Route enthält, die zu Schritt N+1 passt (z.B. '/app/tutor' und Folgeschritt ist '/app/tutor') → T1='ja'.",
    "  • Wenn auf Folgeseite ein 'Weiter mit', 'Fortsetzen', 'Du kommst von', Stepper/Breadcrumb oder ein State-Hint auf Schritt N referenziert → T2='ja'.",
    "  • Wenn der letzte Schritt mind. EINEN forward-CTA (nicht 'zurück'/'beenden') zeigt → T4='ja'.",
    "",
    "evidence MUSS konkret aus den Snapshots zitieren: 'Schritt N CTA: \"…\" → Schritt N+1 Title: \"…\"'.",
    "file_hint: betroffene Route(n) als Liste.",
    "kind = journey_handoff_mismatch | journey_orientation_loss | journey_dead_end | journey_no_recommendation.",
    "Erzeuge ein Finding NUR pro tatsächlich verletzter Dimension. Vermeide doppelte Befunde.",
    FINDING_CONTRACT,
  ].join("\n\n"),
};



function buildUserPrompt(input: {
  audit_mode: AuditMode;
  route: string;
  snapshot: any;
  context?: any;
}) {
  const s = input.snapshot ?? {};
  const ctx = input.context ?? {};

  // Journey mode: snapshot.steps is an array of {route, title, headings, cta_labels, testids, visible_text}.
  if (input.audit_mode === "journey" && Array.isArray(s.steps)) {
    const lines: string[] = [];
    lines.push(`Journey: ${input.route}`);
    if (ctx.journey_name) lines.push(`Name: ${ctx.journey_name}`);
    if (ctx.persona) lines.push(`Persona: ${ctx.persona}`);
    if (ctx.goal) lines.push(`Nutzerziel: ${ctx.goal}`);
    lines.push(`Schritte (N=${s.steps.length}): ${s.steps.map((x: any) => x?.route).join(' → ')}`);
    s.steps.forEach((step: any, i: number) => {
      const idx = i + 1;
      lines.push('');
      lines.push(`--- SCHRITT ${idx}/${s.steps.length} · Route: ${step?.route ?? '?'} ---`);
      if (step?.title) lines.push(`Title: ${step.title}`);
      if (Array.isArray(step?.headings) && step.headings.length) {
        lines.push(`Headings: ${JSON.stringify(step.headings).slice(0, 600)}`);
      }
      const cc = Number(step?.cta_count ?? (Array.isArray(step?.cta_labels) ? step.cta_labels.length : 0));
      lines.push(`CTA-Metrik: cta_count=${cc}`);
      if (Array.isArray(step?.cta_labels) && step.cta_labels.length) {
        lines.push(`CTA-Labels: ${JSON.stringify(step.cta_labels).slice(0, 1500)}`);
      }
      if (Array.isArray(step?.ctas) && step.ctas.length) {
        lines.push(`CTA-Details (label/href/testid): ${JSON.stringify(step.ctas).slice(0, 1800)}`);
      }
      if (Array.isArray(step?.testids) && step.testids.length) {
        lines.push(`Test-IDs: ${JSON.stringify(step.testids).slice(0, 800)}`);
      }
      const txt = String(step?.visible_text ?? "").slice(0, 2500);
      lines.push(`VISIBLE TEXT (truncated 2.5k):\n${txt}`);
    });
    lines.push('');
    lines.push(`Audit-Mode: journey. Bewerte ausschließlich die Übergänge und die Geschlossenheit. Antworte nur als JSON gemäß Vertrag.`);
    return lines.join('\n');
  }

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
    verdict: "fail" as "fail" | "inconsistent" | "pass",
    inconsistency_reason: "" as string,
    override_reason: "" as string,
  };
}

/**
 * KIMI.2.1 — Auditor-Consistency-Gate.
 *
 * Re-scores any finding whose evidence/impact text contradicts the implicit
 * NEIN-verdict. If the auditor wrote "klar", "keine Änderung notwendig",
 * "genau EINEN Primary CTA", "in einem Satz" etc. AND simultaneously emitted
 * a finding (= NEIN), the verdict is structurally invalid and gets demoted
 * from `fail` → `inconsistent` so the QFAF totals stop drowning in noise.
 *
 * We DO NOT silently drop the finding — we keep it visible under a separate
 * status so KIMI's own reliability is measurable over time.
 *
 * Pure text heuristic, deterministic, no second LLM call.
 */
const POSITIVE_PATTERNS: RegExp[] = [
  /\bkeine\s+(?:änderung|aenderung)\s+notwendig\b/i,
  /\bnicht\s+notwendig\b/i,
  /\bist\s+klar\b/i,
  /\bist\s+eindeutig\b/i,
  /\bklar\s+und\s+(?:beschreibt|benennt|eindeutig)\b/i,
  /\bklar\s+erkennbar/i,
  /\bbeschreibt\s+die\s+seite\b/i,
  /\bin\s+einem\s+satz\s+beschreiben\b/i,
  /\bgenau\s+einen?\s+(?:primary\s+)?cta\b/i,
  /\bdas\s+ziel\s+benennt\b/i,
  /\bdirekt\s+erkennen\b/i,
  /\bsofort\s+(?:erkennen|verständlich)\b/i,
  /\bklarer\s+und\s+eindeutiger?\s+(?:primary\s+)?cta\b/i,
  /\bgibt\s+einen\s+hinweis\b/i,
  /\b(?:einen|der)\s+primary\s+cta\b/i,
  /\bals\s+n[äa]chster\s+schritt\s+markiert\b/i,
  /\bweist\s+auf\s+das\s+ergebnis\b/i,
  /\boutcome[- ]hint\b/i,
  /\bbenennt\s+die\s+(?:seite|route)\b/i,
  /\bist\s+sichtbar\b/i,
];
const SOFT_NEGATIVE_PATTERNS: RegExp[] = [
  /\bnicht\b/i, /\bkein(?:e|en|er)?\b/i, /\bunklar\b/i, /\bfehlt\b/i,
  /\bverloren\b/i, /\bverwirr/i, /\bzu\s+viele\b/i, /\bunsicher\b/i,
  /\bmehrere\b/i, /\bambig/i, /\baber\b/i, /\bjedoch\b/i, /\bnur\s+/i,
  /\bkönnte\s+nicht\b/i, /\bnicht\s+klar\b/i,
];
function isInconsistent(f: ReturnType<typeof normalizeFinding>): string | null {
  const text = `${f.evidence}\n${f.user_impact}\n${f.fix_recommendation}`;
  const positiveHits = POSITIVE_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
  if (positiveHits.length === 0) return null;
  // Count negative cues — if evidence ALSO contains real concerns, treat as fail.
  const negativeHits = SOFT_NEGATIVE_PATTERNS.filter((p) => p.test(text)).length;
  // High-confidence positive language with no offsetting concerns → inconsistent.
  if (f.confidence >= 0.8 && negativeHits <= 1) {
    return `Evidence enthält Positiv-Marker (${positiveHits.slice(0, 2).join(", ")}) bei Verdict=NEIN (confidence=${f.confidence}).`;
  }
  return null;
}
function applyConsistencyGate(findings: ReturnType<typeof normalizeFinding>[]) {
  let downgraded = 0;
  for (const f of findings) {
    const reason = isInconsistent(f);
    if (reason) {
      f.verdict = "inconsistent";
      f.inconsistency_reason = reason;
      downgraded++;
    }
  }
  return { downgraded };
}

/**
 * KIMI.2.4 — Structural Gate-Override.
 *
 * Doctrine: a structurally satisfied gate + positive evidence is a PASS,
 * not an INCONS. INCONS is reserved for the residual case (gate satisfied,
 * evidence neutral). A real FAIL requires gate violation AND negative evidence.
 *
 * Rules:
 *   1. Gate satisfied + positive evidence  → verdict = "pass"      (suppress, count as PASS)
 *   2. Gate satisfied + neutral evidence   → verdict = "inconsistent"
 *   3. Gate violated  + negative evidence  → verdict = "fail" (kept)
 *   4. Gate violated  + neutral evidence   → verdict = "inconsistent"
 *   5. fix_recommendation contains "Kein Fix notwendig" → verdict = "pass"
 *   6. P0 only on real blockade: gate violated AND (cta_count===0 for Q3,
 *      title empty for Q1, no outcome AND violating context for Q4).
 */
const PRIMARY_LABEL_MARKERS = /(empfohlen|n[äa]chster\s+schritt|jetzt\s+starten|jetzt\s+(beginnen|loslegen))/i;
const PRIMARY_TESTID_MARKER = /primary-cta/i;
const OUTCOME_MARKERS = /(nach\s+dem\s+start|nach\s+auswahl|du\s+erh[äa]ltst\s+danach|danach\s+(siehst|kannst|wirst)|als\s+n[äa]chstes\b)/i;
const OUTCOME_TESTID_MARKER = /route-outcome-hint/i;
const NO_FIX_NEEDED = /\bkein(?:er|en)?\s+fix\s+(?:notwendig|n[öo]tig|erforderlich)\b/i;

function capSeverity(f: ReturnType<typeof normalizeFinding>, max: "P1" | "P2") {
  const rank = { P0: 0, P1: 1, P2: 2 } as Record<string, number>;
  if (rank[f.severity] < rank[max]) {
    f.severity = max;
  }
}

function hasPositiveEvidence(f: ReturnType<typeof normalizeFinding>): string | null {
  const text = `${f.evidence}\n${f.user_impact}\n${f.fix_recommendation}`;
  for (const p of POSITIVE_PATTERNS) {
    if (p.test(text)) return p.source;
  }
  return null;
}
function hasNegativeEvidence(f: ReturnType<typeof normalizeFinding>): boolean {
  const text = `${f.evidence}\n${f.user_impact}`;
  const hits = SOFT_NEGATIVE_PATTERNS.filter((p) => p.test(text)).length;
  return hits >= 2;
}

function applyStructuralQGate(
  findings: ReturnType<typeof normalizeFinding>[],
  snapshot: any,
) {
  const stats = {
    q1_passed: 0, q3_passed: 0, q4_passed: 0, q2_passed: 0,
    q1_demoted: 0, q3_demoted: 0, q4_demoted: 0,
    severity_capped: 0, no_fix_passed: 0, p0_capped: 0,
  };
  const title = String(snapshot?.title ?? "").trim();
  const headings: string[] = Array.isArray(snapshot?.headings) ? snapshot.headings : [];
  const ctaLabels: string[] = Array.isArray(snapshot?.cta_labels) ? snapshot.cta_labels : [];
  const testids: string[] = Array.isArray(snapshot?.testids) ? snapshot.testids : [];
  const ctaCount = Number(snapshot?.cta_count ?? 0);
  const visibleText = String(snapshot?.visible_text ?? "");

  const q1Gate = title.length > 0 && headings.some((h) => h && h.length >= 2);
  const hasPrimaryLabel = ctaLabels.some((l) => PRIMARY_LABEL_MARKERS.test(String(l)));
  const hasPrimaryTestid = testids.some((t) => PRIMARY_TESTID_MARKER.test(String(t)));
  const q3Gate = hasPrimaryLabel || hasPrimaryTestid || ctaCount === 1;
  const q4Gate = testids.some((t) => OUTCOME_TESTID_MARKER.test(String(t))) || OUTCOME_MARKERS.test(visibleText);
  const q2Gate = visibleText.length > 200; // page has substantive content → stakes can be inferred

  for (const f of findings) {
    // KIMI.2.4: process both "fail" AND "inconsistent" — the older KIMI.2.1
    // text-bias gate may have already demoted, but structural gate can still
    // promote those to PASS when DOM proof is present.
    if (f.verdict === "pass") continue;

    // Rule 5: "Kein Fix notwendig" → auto-pass.
    if (NO_FIX_NEEDED.test(f.fix_recommendation)) {
      f.verdict = "pass";
      f.override_reason = `Gate-Override: Fix-Hinweis ist "Kein Fix notwendig" — kein Produktfehler.`;
      stats.no_fix_passed++;
      continue;
    }

    let gate = false;
    let gateName = "";
    let p0Allowed = false;
    if (f.kind === "qfaf_q1_orientation") {
      gate = q1Gate; gateName = "Q1";
      capSeverity(f, "P1"); stats.severity_capped++;
      p0Allowed = false;
    } else if (f.kind === "qfaf_q3_action") {
      gate = q3Gate; gateName = "Q3";
      if (ctaCount > 0) { capSeverity(f, "P1"); stats.severity_capped++; }
      p0Allowed = ctaCount === 0;
    } else if (f.kind === "qfaf_q4_outcome") {
      gate = q4Gate; gateName = "Q4";
      capSeverity(f, "P2"); stats.severity_capped++;
      p0Allowed = false;
    } else if (f.kind === "qfaf_q2_stakes") {
      gate = q2Gate; gateName = "Q2";
      capSeverity(f, "P2"); stats.severity_capped++;
      p0Allowed = false;
    } else {
      continue;
    }

    // Rule 6: P0 nur bei echter Blockade.
    if (f.severity === "P0" && !p0Allowed) {
      f.severity = "P1";
      stats.p0_capped++;
    }

    const posMarker = hasPositiveEvidence(f);
    const negMarker = hasNegativeEvidence(f);

    if (gate) {
      // Rule 1 (expanded): gate satisfied + (positive evidence OR no clear
      // negative critique) → PASS. The DOM proves the user-visible truth; if
      // the auditor cannot produce a substantive negative critique, the NEIN
      // is auditor noise, not a product fact.
      if (posMarker || !negMarker) {
        f.verdict = "pass";
        f.override_reason = posMarker
          ? `${gateName}-Gate erfüllt (DOM-Beweis) + positive Evidence-Marker (${posMarker.slice(0, 40)}) → PASS.`
          : `${gateName}-Gate erfüllt (DOM-Beweis) + keine substantielle Negativ-Evidence → PASS.`;
        if (f.kind === "qfaf_q1_orientation") stats.q1_passed++;
        else if (f.kind === "qfaf_q3_action") stats.q3_passed++;
        else if (f.kind === "qfaf_q4_outcome") stats.q4_passed++;
        else if (f.kind === "qfaf_q2_stakes") stats.q2_passed++;
      } else {
        // Rule 2: gate satisfied + substantive negative evidence → INCONS
        // (DOM says ok, auditor says concrete concern — keep visible).
        f.verdict = "inconsistent";
        f.inconsistency_reason = `${gateName}-Gate strukturell erfüllt, aber Evidence enthält substantielle Negativ-Marker — Auditor-Diskrepanz.`;
        if (f.kind === "qfaf_q1_orientation") stats.q1_demoted++;
        else if (f.kind === "qfaf_q3_action") stats.q3_demoted++;
        else if (f.kind === "qfaf_q4_outcome") stats.q4_demoted++;
      }
    } else {
      // Gate violated.
      if (!negMarker) {
        // Rule 4: gate violated + no clear negative evidence → INCONS
        f.verdict = "inconsistent";
        f.inconsistency_reason = `${gateName}-Gate verletzt, aber Evidence nicht eindeutig negativ — als INCONS klassifiziert.`;
      }
      // else: Rule 3 — keep as fail.
    }
  }
  return stats;
}

/**
 * KIMI.3 — Structural Journey Gate.
 *
 * Operates on `mode='journey'` findings. Uses snapshot.steps[] (route, cta_labels, ctas, headings)
 * to verify what the auditor claimed about transitions. Doctrine identical to KIMI.2.4:
 *
 *   - Structural gate satisfied + positive evidence  → verdict = "pass"
 *   - Structural gate satisfied + neutral evidence   → "inconsistent"
 *   - Structural gate violated  + negative evidence  → keep as "fail"
 *   - Structural gate violated  + neutral evidence   → "inconsistent"
 *
 * Gate definitions per kind:
 *   journey_handoff_mismatch:
 *     gate(N→N+1) = step[N] has a CTA whose href contains step[N+1].route segment
 *                   OR a CTA label semantically referencing the next step name.
 *   journey_dead_end:
 *     gate(N) = step[N].cta_count > 0 AND at least one CTA is forward-leading
 *               (not pure return: 'zurück', 'beenden', 'hilfe', 'mehr erfahren').
 *   journey_orientation_loss:
 *     gate(N+1) = title/headings/visible_text references prior step (Stepper/Breadcrumb/"Du kommst von"/Fortsetzen).
 *   journey_no_recommendation:
 *     gate = LAST step has at least one forward-leading CTA (see dead_end gate).
 */
const RETURN_ONLY_PATTERNS = /^(zurück|zurueck|abbrechen|beenden|schließen|schliessen|hilfe|mehr\s+erfahren|kontakt|impressum|datenschutz|agb|logout|abmelden)$/i;
const ORIENTATION_REF_PATTERNS = /(fortsetzen|weiter\s+mit|du\s+kommst\s+von|zurück\s+zu|schritt\s+\d+\s+von\s+\d+|stepper|breadcrumb)/i;

function stepForwardCtas(step: any): string[] {
  const labels: string[] = Array.isArray(step?.cta_labels) ? step.cta_labels : [];
  return labels.filter((l) => l && !RETURN_ONLY_PATTERNS.test(String(l).trim()));
}

function ctaMatchesNextRoute(step: any, nextRoute: string): boolean {
  if (!nextRoute) return false;
  // Take last meaningful segment of next route, e.g. /app/tutor → 'tutor'.
  const seg = nextRoute.split('/').filter(Boolean).pop() || '';
  if (!seg) return false;
  const segRe = new RegExp(seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const ctas: any[] = Array.isArray(step?.ctas) ? step.ctas : [];
  for (const c of ctas) {
    const href = String(c?.href ?? '');
    const label = String(c?.label ?? '');
    if (href && href.includes(seg)) return true;
    if (label && segRe.test(label)) return true;
  }
  const labels: string[] = Array.isArray(step?.cta_labels) ? step.cta_labels : [];
  return labels.some((l) => segRe.test(String(l)));
}

function applyStructuralJourneyGate(
  findings: ReturnType<typeof normalizeFinding>[],
  snapshot: any,
) {
  const stats = {
    handoff_passed: 0, deadend_passed: 0,
    loop_passed: 0, orientation_passed: 0,
  };
  const steps: any[] = Array.isArray(snapshot?.steps) ? snapshot.steps : [];
  if (steps.length < 2) return stats;
  const lastStep = steps[steps.length - 1];

  for (const f of findings) {
    if (f.verdict === "pass") continue;
    if (NO_FIX_NEEDED.test(f.fix_recommendation)) {
      f.verdict = "pass";
      f.override_reason = `Gate-Override: "Kein Fix notwendig" → kein Journey-Defekt.`;
      continue;
    }

    // Identify step index from file_hint / evidence if possible.
    const evidenceText = `${f.evidence}\n${(Array.isArray(f.file_hint) ? f.file_hint.join(' ') : '')}`;
    let stepIdx = -1;
    steps.forEach((s, i) => {
      if (s?.route && evidenceText.includes(String(s.route))) {
        stepIdx = i;
      }
    });

    let gate = false;
    let gateName = "";

    if (f.kind === "journey_dead_end") {
      gateName = "DEAD_END";
      const candidates = stepIdx >= 0 ? [steps[stepIdx]] : steps;
      gate = candidates.every((s) => stepForwardCtas(s).length > 0);
      // P0 only if a real cul-de-sac exists.
      if (f.severity === "P0" && gate) {
        f.severity = "P1";
      }
      if (gate) stats.deadend_passed++;
    } else if (f.kind === "journey_handoff_mismatch") {
      gateName = "HANDOFF";
      if (stepIdx >= 0 && stepIdx < steps.length - 1) {
        gate = ctaMatchesNextRoute(steps[stepIdx], steps[stepIdx + 1]?.route);
      } else {
        // Unknown transition — verify any consecutive pair matches.
        gate = steps.slice(0, -1).some((s, i) => ctaMatchesNextRoute(s, steps[i + 1]?.route));
      }
      if (gate) stats.handoff_passed++;
    } else if (f.kind === "journey_orientation_loss") {
      gateName = "ORIENTATION";
      const candidates = stepIdx >= 0 ? [steps[stepIdx]] : steps.slice(1);
      gate = candidates.some((s) =>
        ORIENTATION_REF_PATTERNS.test(String(s?.visible_text ?? '')) ||
        ORIENTATION_REF_PATTERNS.test(String(s?.title ?? '')) ||
        (Array.isArray(s?.headings) && s.headings.some((h: any) => ORIENTATION_REF_PATTERNS.test(String(h))))
      );
      if (f.severity === "P0") f.severity = "P2";
      if (gate) stats.orientation_passed++;
    } else if (f.kind === "journey_no_recommendation") {
      gateName = "LOOP";
      gate = stepForwardCtas(lastStep).length > 0;
      if (f.severity === "P0") f.severity = "P1";
      if (gate) stats.loop_passed++;
    } else {
      continue;
    }

    const posMarker = hasPositiveEvidence(f);
    const negMarker = hasNegativeEvidence(f);

    if (gate) {
      if (posMarker || !negMarker) {
        f.verdict = "pass";
        f.override_reason = `${gateName}-Gate erfüllt (DOM/Route-Beweis) → PASS.`;
      } else {
        f.verdict = "inconsistent";
        f.inconsistency_reason = `${gateName}-Gate strukturell erfüllt, aber Evidence enthält substantielle Negativ-Marker.`;
      }
    } else {
      if (!negMarker) {
        f.verdict = "inconsistent";
        f.inconsistency_reason = `${gateName}-Gate verletzt, aber Evidence nicht eindeutig negativ.`;
      }
      // else: keep as fail.
    }
  }
  return stats;
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
  if (!["reality", "ux_text", "next_action", "qfaf", "journey"].includes(mode)) {
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
  if (mode === "journey") {
    if (!Array.isArray(body?.snapshot?.steps) || body.snapshot.steps.length < 2) {
      return new Response(JSON.stringify({ error: "snapshot.steps[] (>=2) required for journey mode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else if (!body?.snapshot?.visible_text) {
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

  // KIMI.2.1 — text-bias Consistency-Gate (positive prose vs. NEIN verdict).
  // KIMI.2.2 — structural Q-Gate (DOM signals: title/headings/CTAs/testids/outcome).
  // KIMI.3   — structural Journey-Gate (CTA-route handoff, dead-end, loop-closure).
  const consistency = mode === "qfaf" ? applyConsistencyGate(findings) : { downgraded: 0 };
  const structural = mode === "qfaf"
    ? applyStructuralQGate(findings, body.snapshot)
    : { q1_demoted: 0, q3_demoted: 0, q4_demoted: 0, severity_capped: 0 };
  const journey = mode === "journey"
    ? applyStructuralJourneyGate(findings, body.snapshot)
    : { handoff_passed: 0, deadend_passed: 0, loop_passed: 0, orientation_passed: 0 };
  const realFails = findings.filter((f) => f.verdict === "fail");
  const inconsistent = findings.filter((f) => f.verdict === "inconsistent");
  const passes = findings.filter((f) => f.verdict === "pass");

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
        const action =
          f.verdict === "pass" ? "kimi_reality_finding_pass_override"
          : f.verdict === "inconsistent" ? "kimi_reality_finding_inconsistent"
          : "kimi_reality_finding";
        await sb.rpc("fn_emit_audit", {
          _action_type: action,
          _payload: { ...f, ms, model_in: `kimi/${kimiModel}` },
        });
      }
    }
  } catch { /* ignore audit failures */ }

  return new Response(JSON.stringify({
    findings,                  // back-compat: all findings (verdict-tagged)
    real_findings: realFails,  // fail-only, what UI should count
    inconsistencies: inconsistent,
    passes,                    // KIMI.2.4: gate-overridden findings (count as PASS)
    meta: {
      route, audit_mode: mode, ms,
      model_in: `kimi/${kimiModel}`,
      fallback_model: fallbackModel,
      raw_parse_ok: parsed.length > 0 || /"findings"\s*:\s*\[\s*\]/.test(assistantText),
      consistency_gate: {
        applied: mode === "qfaf",
        emitted: findings.length,
        fails: realFails.length,
        inconsistent: inconsistent.length,
        passes: passes.length,
        downgraded: consistency.downgraded,
        structural,
        journey,
      },
    },
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
