/**
 * VerwaltungsOS Oral Bridge v1 — Persona Pressure Engine
 *
 * Actions:
 *   - start    : Erzeugt Session (RPC) + erste Persona-Eröffnung
 *   - turn     : Nutzer antwortet → Persona reagiert dynamisch, Eskalation + Governance-Eval
 *   - debrief  : Schließt Session, berechnet Scorecards + Debrief-Intelligence
 *
 * SSOT: verwaltung_department_dna (Szenario, Konflikt, Rolle, Komm-Muster).
 * AI:   Lovable AI Gateway (google/gemini-2.5-flash), JSON-only.
 * Keine generierten DNA-Daten — nur Simulations-Output.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const MODEL = "google/gemini-2.5-flash";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// ───────────────────────── helpers ─────────────────────────
type Json = Record<string, unknown>;

function err(status: number, code: string, extra: Json = {}) {
  return new Response(JSON.stringify({ error: code, ...extra }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function ok(body: Json) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function callAI(messages: Array<{ role: string; content: string }>): Promise<Json> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY_MISSING");
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
    }),
  });
  if (res.status === 429) throw new Error("AI_RATE_LIMITED");
  if (res.status === 402) throw new Error("AI_CREDITS_EXHAUSTED");
  if (!res.ok) throw new Error(`AI_ERROR_${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI_EMPTY");
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("AI_BAD_JSON");
  }
}

// ───────────────────── persona prompt builder ─────────────────────
function buildPersonaSystem(scenario: Json, persona: string, conflict: string, escalation: number, deptName: string): string {
  const oral = (scenario?.oral_case ?? {}) as Json;
  return `Du simulierst eine REALE Verwaltungssituation in einem deutschen Amt.

FACHBEREICH: ${deptName}
SZENARIO: ${oral.scenario_title ?? "Bürgergespräch"}
ROLLE-GEGENÜBER (du): ${oral.role_counterpart ?? "Bürger:in"}
PERSONA-MODUS: ${persona}
KONFLIKT-AUSGANGSLAGE: ${conflict}
AKTUELLE ESKALATIONSSTUFE (0=ruhig, 5=eskaliert): ${escalation}
KOMMUNIKATIONSZIEL DER SIMULATION (nicht offenlegen): ${oral.communication_goal ?? "–"}
RECHTLICHE KOMPLEXITÄT: ${oral.legal_complexity ?? "–"}

VERHALTENSREGELN:
- Du bist NICHT der Verwaltungsmitarbeiter. Du bist das Gegenüber (Bürger/Presse/Gemeinderat/…).
- Reagiere realistisch deutsch, kurz (1–3 Sätze), emotional passend zum Eskalationslevel.
- Eskalationsdynamik:
   * Wenn der Nutzer bürokratisch, ausweichend, unklar antwortet → erhöhe Eskalation.
   * Wenn der Nutzer empathisch, klar, lösungsorientiert antwortet → senke Eskalation.
- Spiele NICHT die "richtige Lösung" vor, lehre nicht, gib keine Tipps.
- Keine Meta-Kommentare, keine Anführungszeichen, kein "Als Persona ...".

AUSGABEFORMAT (strikt JSON, kein Markdown):
{
  "persona_utterance": "string — was die Person als Nächstes sagt",
  "persona_emotion": "ruhig|gereizt|wütend|ängstlich|verzweifelt|frustriert|empathisch",
  "escalation_delta": -2 bis +2,
  "trigger_observed": "kurze Notiz, was den Delta ausgelöst hat (DE)"
}`;
}

function buildEvalSystem(scenario: Json, deptName: string): string {
  const oral = (scenario?.oral_case ?? {}) as Json;
  return `Du bist ein nüchterner Governance-Evaluator für Verwaltungs-Kommunikation in Deutschland.
Bewerte die LETZTE Nutzer-Antwort innerhalb des laufenden Verwaltungs-Dialogs.

FACHBEREICH: ${deptName}
SZENARIO: ${oral.scenario_title ?? "Bürgergespräch"}
TRAININGS-FOKUS: ${oral.training_focus ?? "–"}

BEWERTUNGSDIMENSIONEN (0–100, ganzzahlig):
- buergerverstaendlichkeit (Klarheit, kein Verwaltungsdeutsch)
- deeskalation             (Tonalität, emotionale Anerkennung)
- fachlichkeit             (sachlich korrekt, prozesssicher)
- struktur                 (logischer Aufbau)
- empathie                 (Anerkennung der Lage)
- governance_sicherheit    (rechts-/verfahrenssicher, keine unhaltbaren Zusagen)

AUSGABEFORMAT (strikt JSON):
{
  "scores": { "buergerverstaendlichkeit": int, "deeskalation": int, "fachlichkeit": int, "struktur": int, "empathie": int, "governance_sicherheit": int },
  "kurz_feedback": "1–2 Sätze, DE",
  "risiken":    ["…"],
  "stärken":    ["…"],
  "alternative_formulierung": "konkreter Vorschlag, DE"
}`;
}

function buildDebriefSystem(scenario: Json, deptName: string): string {
  const oral = (scenario?.oral_case ?? {}) as Json;
  return `Du erstellst das Abschluss-Debrief einer Verwaltungs-Simulation.

FACHBEREICH: ${deptName}
SZENARIO: ${oral.scenario_title ?? ""}
KOMMUNIKATIONSZIEL: ${oral.communication_goal ?? "–"}
TRAININGS-FOKUS: ${oral.training_focus ?? "–"}

Du bekommst den vollständigen Gesprächsverlauf (turns) + die pro-Turn Evaluations.
Liefere ein verdichtetes, ehrliches Verwaltungs-Debrief — kein Coaching-Talk.

AUSGABEFORMAT (strikt JSON):
{
  "overall_outcome": "erfolgreich|teilweise|verfehlt",
  "key_strengths":     ["…"],
  "key_risks":         ["…"],
  "typische_fehler":   ["…"],
  "eskalationsmomente":["Turn N: …"],
  "alternative_formulierungen": ["…"],
  "buergerwirkung":   "1–2 Sätze",
  "governance_wirkung":"1–2 Sätze",
  "next_focus":        "ein konkreter Trainingsfokus für die nächste Runde"
}`;
}

// ─────────────────────── score aggregation ───────────────────────
const SCORE_WEIGHTS_BY_CATEGORY: Record<string, Record<string, number>> = {
  // KGSt-Cluster → Gewichtung
  "Service":            { buergerverstaendlichkeit: 0.30, deeskalation: 0.20, empathie: 0.20, fachlichkeit: 0.15, struktur: 0.10, governance_sicherheit: 0.05 },
  "Soziales/Jugend":    { empathie: 0.30, deeskalation: 0.25, buergerverstaendlichkeit: 0.15, struktur: 0.15, fachlichkeit: 0.10, governance_sicherheit: 0.05 },
  "Soziales/Bürger":    { empathie: 0.25, deeskalation: 0.20, buergerverstaendlichkeit: 0.20, fachlichkeit: 0.15, struktur: 0.10, governance_sicherheit: 0.10 },
  "Schule/Kultur":      { buergerverstaendlichkeit: 0.25, empathie: 0.20, struktur: 0.15, fachlichkeit: 0.20, deeskalation: 0.15, governance_sicherheit: 0.05 },
  "Bauen/Umwelt":       { fachlichkeit: 0.30, governance_sicherheit: 0.25, struktur: 0.20, buergerverstaendlichkeit: 0.15, deeskalation: 0.05, empathie: 0.05 },
  "Wirtschaft":         { fachlichkeit: 0.25, struktur: 0.20, governance_sicherheit: 0.20, buergerverstaendlichkeit: 0.20, deeskalation: 0.10, empathie: 0.05 },
  "Sicherheit/Ordnung": { governance_sicherheit: 0.30, deeskalation: 0.25, struktur: 0.15, fachlichkeit: 0.15, buergerverstaendlichkeit: 0.10, empathie: 0.05 },
  "Steuerung/Service":  { governance_sicherheit: 0.30, struktur: 0.20, fachlichkeit: 0.20, deeskalation: 0.15, buergerverstaendlichkeit: 0.10, empathie: 0.05 },
};
const DEFAULT_WEIGHTS = SCORE_WEIGHTS_BY_CATEGORY["Service"];

function aggregateScorecard(evals: Json[], category: string): Json {
  const dims = ["buergerverstaendlichkeit", "deeskalation", "fachlichkeit", "struktur", "empathie", "governance_sicherheit"] as const;
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const e of evals) {
    const s = (e?.scores ?? {}) as Record<string, unknown>;
    for (const d of dims) {
      const v = Number(s[d]);
      if (Number.isFinite(v)) {
        sums[d] = (sums[d] ?? 0) + v;
        counts[d] = (counts[d] ?? 0) + 1;
      }
    }
  }
  const per_dim: Record<string, number> = {};
  for (const d of dims) per_dim[d] = counts[d] ? Math.round(sums[d] / counts[d]) : 0;

  const w = SCORE_WEIGHTS_BY_CATEGORY[category] ?? DEFAULT_WEIGHTS;
  let overall = 0;
  for (const d of dims) overall += (per_dim[d] ?? 0) * (w[d] ?? 0);
  return { per_dim, overall: Math.round(overall), weights_used: w, category };
}

// ────────────────────────── handler ──────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")   return err(405, "METHOD_NOT_ALLOWED");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return err(401, "AUTH_REQUIRED");

  let body: Json;
  try { body = await req.json(); } catch { return err(400, "BAD_JSON"); }
  const action = String(body.action ?? "");

  // user-client (RLS) and service-client (writes turns inside RLS-scoped session)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } });

  const { data: u } = await userClient.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return err(401, "AUTH_REQUIRED");

  try {
    if (action === "start") {
      const department_key = String(body.department_key ?? "");
      const oral_case_key  = String(body.oral_case_key ?? "");
      const persona        = String(body.persona ?? "buerger_neutral");
      if (!department_key || !oral_case_key) return err(400, "MISSING_KEYS");

      const { data: sid, error } = await userClient.rpc("start_verwaltung_oral_session", {
        _department_key: department_key,
        _oral_case_key: oral_case_key,
        _persona: persona,
      });
      if (error) return err(400, "START_FAILED", { detail: error.message });

      // Load session for scenario_snapshot
      const { data: sess } = await svc.rpc("get_verwaltung_oral_session", { _session_id: sid });
      const snap = (sess as Json)?.scenario_snapshot as Json ?? {};
      const deptName = String(snap?.department_name ?? "");
      const conflict = String((sess as Json)?.conflict_level ?? "medium");

      // Opening persona utterance
      const sys = buildPersonaSystem(snap, persona, conflict, 0, deptName);
      const ai = await callAI([
        { role: "system", content: sys },
        { role: "user", content: "Eröffne das Gespräch jetzt mit deiner ersten Aussage. Antworte als die Person, nicht als KI." },
      ]);

      const utterance   = String(ai.persona_utterance ?? "");
      const emotion     = String(ai.persona_emotion ?? "ruhig");

      await svc.from("verwaltung_oral_turns").insert({
        session_id: sid,
        turn_index: 0,
        role: "persona",
        content: utterance,
        persona_emotion: emotion,
        escalation_delta: 0,
        evaluation: { trigger_observed: ai.trigger_observed ?? null },
      });

      return ok({
        session_id: sid,
        persona_utterance: utterance,
        persona_emotion: emotion,
        escalation_state: 0,
        scenario: snap,
      });
    }

    if (action === "turn") {
      const session_id   = String(body.session_id ?? "");
      const user_message = String(body.user_message ?? "").trim();
      if (!session_id || !user_message) return err(400, "MISSING_FIELDS");

      const { data: sessJson, error: sErr } = await userClient.rpc("get_verwaltung_oral_session", { _session_id: session_id });
      if (sErr || !sessJson || (sessJson as Json).error) return err(404, "SESSION_NOT_FOUND");
      const sess = sessJson as Json;
      if (sess.status !== "active") return err(409, "SESSION_NOT_ACTIVE");

      const snap = sess.scenario_snapshot as Json ?? {};
      const deptName = String(snap?.department_name ?? "");
      const persona  = String(sess.persona ?? "buerger_neutral");
      const conflict = String(sess.conflict_level ?? "medium");
      const escalation = Number(sess.escalation_state ?? 0);
      const turns = Array.isArray(sess.turns) ? (sess.turns as Json[]) : [];
      const nextIdx = turns.length;

      // 1) Insert user turn
      await svc.from("verwaltung_oral_turns").insert({
        session_id, turn_index: nextIdx, role: "user", content: user_message,
      });

      // 2) Persona reaction + 3) Governance eval in parallel
      const history = turns
        .map((t) => `${t.role === "persona" ? "PERSONA" : t.role === "user" ? "NUTZER" : "SYSTEM"}: ${t.content}`)
        .concat(`NUTZER: ${user_message}`)
        .join("\n");

      const personaSys = buildPersonaSystem(snap, persona, conflict, escalation, deptName);
      const evalSys    = buildEvalSystem(snap, deptName);

      const [personaAI, evalAI] = await Promise.all([
        callAI([
          { role: "system", content: personaSys },
          { role: "user", content: `Bisheriger Verlauf:\n${history}\n\nReagiere jetzt als die Persona auf die letzte NUTZER-Antwort.` },
        ]),
        callAI([
          { role: "system", content: evalSys },
          { role: "user", content: `Verlauf:\n${history}\n\nBewerte ausschließlich die LETZTE Nutzer-Antwort.` },
        ]),
      ]);

      const utterance = String(personaAI.persona_utterance ?? "");
      const emotion   = String(personaAI.persona_emotion ?? "ruhig");
      let delta       = Number(personaAI.escalation_delta ?? 0);
      if (!Number.isFinite(delta)) delta = 0;
      delta = Math.max(-2, Math.min(2, Math.round(delta)));

      const newEsc = Math.max(0, Math.min(5, escalation + delta));

      // 4) Attach eval to the user turn
      await svc.from("verwaltung_oral_turns")
        .update({ evaluation: evalAI })
        .eq("session_id", session_id).eq("turn_index", nextIdx);

      // 5) Persona turn
      await svc.from("verwaltung_oral_turns").insert({
        session_id,
        turn_index: nextIdx + 1,
        role: "persona",
        content: utterance,
        persona_emotion: emotion,
        escalation_delta: delta,
        evaluation: { trigger_observed: personaAI.trigger_observed ?? null },
      });

      // 6) Update escalation_state
      await svc.from("verwaltung_oral_sessions")
        .update({ escalation_state: newEsc })
        .eq("id", session_id);

      return ok({
        persona_utterance: utterance,
        persona_emotion: emotion,
        escalation_delta: delta,
        escalation_state: newEsc,
        evaluation: evalAI,
      });
    }

    if (action === "debrief") {
      const session_id = String(body.session_id ?? "");
      if (!session_id) return err(400, "MISSING_FIELDS");

      const { data: sessJson, error } = await userClient.rpc("get_verwaltung_oral_session", { _session_id: session_id });
      if (error || !sessJson || (sessJson as Json).error) return err(404, "SESSION_NOT_FOUND");
      const sess = sessJson as Json;
      const snap = sess.scenario_snapshot as Json ?? {};
      const deptName = String(snap?.department_name ?? "");
      const category = String(snap?.category ?? "Service");
      const turns = Array.isArray(sess.turns) ? (sess.turns as Json[]) : [];
      const evals = turns.filter((t) => t.role === "user" && t.evaluation && typeof t.evaluation === "object").map((t) => t.evaluation as Json);

      const scorecard = aggregateScorecard(evals, category);

      const transcript = turns
        .map((t, i) => `[${i}] ${t.role}: ${t.content}${t.role === "user" && t.evaluation ? ` -- eval=${JSON.stringify((t.evaluation as Json).scores ?? {})}` : ""}`)
        .join("\n");

      const debriefAI = await callAI([
        { role: "system", content: buildDebriefSystem(snap, deptName) },
        { role: "user", content: `Vollständiger Verlauf:\n${transcript}\n\nFinale Eskalationsstufe: ${sess.escalation_state ?? 0}` },
      ]);

      const debrief = { ...debriefAI, scorecard };

      const { error: finErr } = await userClient.rpc("finalize_verwaltung_oral_session", {
        _session_id: session_id,
        _scores: scorecard,
        _debrief: debrief,
      });
      if (finErr) return err(500, "FINALIZE_FAILED", { detail: finErr.message });

      return ok({ session_id, scorecard, debrief });
    }

    return err(400, "UNKNOWN_ACTION", { action });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[verwaltung-oral-bridge]", msg);
    return err(500, "INTERNAL", { detail: msg });
  }
});
