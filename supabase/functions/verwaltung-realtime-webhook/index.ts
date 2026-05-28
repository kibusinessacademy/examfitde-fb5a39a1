/**
 * VerwaltungsOS Realtime Webhook — Cut B3
 *
 * ElevenLabs post-call webhook receiver. Validates HMAC signature, extracts
 * the Convai transcript, generates a Verwaltungs-Debrief via the Lovable AI
 * Gateway, and persists scorecard + debrief on verwaltung_oral_sessions via
 * verwaltung_finalize_realtime_session (service-role, idempotent).
 *
 * Auth: Public (no JWT) — verified by ELEVENLABS_WEBHOOK_SECRET HMAC-SHA256.
 *
 * ElevenLabs Webhook-Konfiguration in der Web-Konsole:
 *   URL:     <PROJECT_URL>/functions/v1/verwaltung-realtime-webhook
 *   Events:  post_call_transcription
 *   Secret:  ELEVENLABS_WEBHOOK_SECRET
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, elevenlabs-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const MODEL = "google/gemini-2.5-flash";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Json = Record<string, unknown>;

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---- HMAC verification (ElevenLabs format: t=<ts>,v0=<hex>) ----
async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(p => {
    const i = p.indexOf("=");
    return i < 0 ? [p, ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const ts = parts["t"];
  const sig = parts["v0"];
  if (!ts || !sig) return false;
  // 30-min tolerance
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 1800) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${rawBody}`));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  // timing-safe compare
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---- AI Debrief ----
async function callAI(messages: Array<{ role: string; content: string }>): Promise<Json> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY_MISSING");
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI_ERROR_${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI_EMPTY");
  return JSON.parse(content);
}

const SCORE_WEIGHTS: Record<string, Record<string, number>> = {
  "Service":            { buergerverstaendlichkeit: 0.30, deeskalation: 0.20, empathie: 0.20, fachlichkeit: 0.15, struktur: 0.10, governance_sicherheit: 0.05 },
  "Soziales/Jugend":    { empathie: 0.30, deeskalation: 0.25, buergerverstaendlichkeit: 0.15, struktur: 0.15, fachlichkeit: 0.10, governance_sicherheit: 0.05 },
  "Soziales/Bürger":    { empathie: 0.25, deeskalation: 0.20, buergerverstaendlichkeit: 0.20, fachlichkeit: 0.15, struktur: 0.10, governance_sicherheit: 0.10 },
  "Schule/Kultur":      { buergerverstaendlichkeit: 0.25, empathie: 0.20, struktur: 0.15, fachlichkeit: 0.20, deeskalation: 0.15, governance_sicherheit: 0.05 },
  "Bauen/Umwelt":       { fachlichkeit: 0.30, governance_sicherheit: 0.25, struktur: 0.20, buergerverstaendlichkeit: 0.15, deeskalation: 0.05, empathie: 0.05 },
  "Wirtschaft":         { fachlichkeit: 0.25, struktur: 0.20, governance_sicherheit: 0.20, buergerverstaendlichkeit: 0.20, deeskalation: 0.10, empathie: 0.05 },
  "Sicherheit/Ordnung": { governance_sicherheit: 0.30, deeskalation: 0.25, struktur: 0.15, fachlichkeit: 0.15, buergerverstaendlichkeit: 0.10, empathie: 0.05 },
  "Steuerung/Service":  { governance_sicherheit: 0.30, struktur: 0.20, fachlichkeit: 0.20, deeskalation: 0.15, buergerverstaendlichkeit: 0.10, empathie: 0.05 },
};
const DIMS = ["buergerverstaendlichkeit","deeskalation","fachlichkeit","struktur","empathie","governance_sicherheit"] as const;

function buildScorecard(globalScores: Json, category: string) {
  const per_dim: Record<string, number> = {};
  for (const d of DIMS) {
    const v = Number((globalScores?.[d] ?? 0));
    per_dim[d] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
  }
  const w = SCORE_WEIGHTS[category] ?? SCORE_WEIGHTS["Service"];
  let overall = 0;
  for (const d of DIMS) overall += per_dim[d] * (w[d] ?? 0);
  return { per_dim, overall: Math.round(overall), weights_used: w, category };
}

// Normalize Convai transcript → role/content turns + plain transcript text
function normalizeTranscript(payload: Json): { turns: Array<{ role: string; content: string }>; text: string; convaiId: string | null } {
  // ElevenLabs post_call_transcription payload shape:
  //   { type: "post_call_transcription", data: { conversation_id, transcript: [ { role: "user"|"agent", message } ] } }
  const data = (payload?.data ?? payload) as Json;
  const convaiId = (data?.conversation_id as string) ?? (data?.conversation?.["id"] as string) ?? null;
  const rawTurns = (data?.transcript as Json[]) ?? (data?.messages as Json[]) ?? [];
  const turns = rawTurns.map(t => ({
    role: String(t?.role ?? "agent") === "user" ? "user" : "persona",
    content: String(t?.message ?? t?.content ?? t?.text ?? "").trim(),
  })).filter(t => t.content.length > 0);
  const text = turns.map((t, i) => `[${i}] ${t.role}: ${t.content}`).join("\n");
  return { turns, text, convaiId };
}

function debriefSystem(category: string): string {
  return `Du bewertest eine REALE Verwaltungs-Simulation in Deutschland (Cluster: ${category}).
Du bekommst den vollständigen Sprachdialog (Nutzer = Verwaltungsmitarbeiter, persona = Bürger/Gegenüber).

Liefere strikt JSON:
{
  "scores": {
    "buergerverstaendlichkeit": int 0-100,
    "deeskalation":             int 0-100,
    "fachlichkeit":             int 0-100,
    "struktur":                 int 0-100,
    "empathie":                 int 0-100,
    "governance_sicherheit":    int 0-100
  },
  "overall_outcome":            "erfolgreich|teilweise|verfehlt",
  "key_strengths":              ["…"],
  "key_risks":                  ["…"],
  "typische_fehler":            ["…"],
  "eskalationsmomente":         ["Turn N: …"],
  "alternative_formulierungen": ["…"],
  "buergerwirkung":             "1-2 Sätze",
  "governance_wirkung":         "1-2 Sätze",
  "next_focus":                 "ein konkreter Trainingsfokus"
}`;
}

// ---- handler ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")    return json(405, { error: "method_not_allowed" });

  if (!WEBHOOK_SECRET) return json(503, { error: "webhook_not_configured" });

  const rawBody = await req.text();
  const sigHeader = req.headers.get("elevenlabs-signature") ?? req.headers.get("ElevenLabs-Signature");
  const valid = await verifySignature(rawBody, sigHeader, WEBHOOK_SECRET);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (!valid) {
    // Audit attempt with stub session_id to satisfy contract
    await admin.rpc("fn_emit_audit", {
      _action_type: "verwaltung_realtime_webhook_received",
      _target_type: "system", _payload: {
        convai_session_id: "unknown",
        session_id: null,
        outcome: "signature_invalid",
        caller_role: "service_role",
      },
    });
    return json(401, { error: "invalid_signature" });
  }

  let payload: Json;
  try { payload = JSON.parse(rawBody); } catch {
    await admin.rpc("fn_emit_audit", {
      _action_type: "verwaltung_realtime_webhook_received",
      _target_type: "system", _payload: { convai_session_id: "unknown", session_id: null, outcome: "parse_error", caller_role: "service_role" },
    });
    return json(400, { error: "invalid_json" });
  }

  const { turns, text, convaiId } = normalizeTranscript(payload);
  if (!convaiId) return json(400, { error: "missing_conversation_id" });

  // Audit accepted before processing
  await admin.rpc("fn_emit_audit", {
    _action_type: "verwaltung_realtime_webhook_received",
    _target_type: "system", _payload: {
      convai_session_id: convaiId,
      session_id: null,
      outcome: "accepted",
      caller_role: "service_role",
    },
  });

  // Resolve session (only to get category for weight selection)
  const { data: sess } = await admin
    .from("verwaltung_oral_sessions")
    .select("id, scenario_snapshot, scores, debrief")
    .eq("realtime_convai_session_id", convaiId)
    .order("realtime_started_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!sess) {
    // Persist via RPC to log session_not_found audit — RPC handles missing path
    await admin.rpc("verwaltung_finalize_realtime_session", {
      _convai_session_id: convaiId,
      _transcript: { turns, raw: payload },
      _scores: null,
      _debrief: null,
    });
    return json(200, { ok: false, reason: "session_not_found" });
  }
  if (sess.scores && sess.debrief) {
    return json(200, { ok: true, idempotent: true });
  }

  const category = String((sess.scenario_snapshot as Json)?.category ?? "Service");

  let debriefAI: Json = {};
  try {
    debriefAI = await callAI([
      { role: "system", content: debriefSystem(category) },
      { role: "user", content: `Transkript:\n${text || "(leer)"}` },
    ]);
  } catch (e) {
    console.error("[verwaltung-realtime-webhook] AI fail", e);
    // Persist transcript-only finalize so re-runs don't try forever
    await admin.rpc("verwaltung_finalize_realtime_session", {
      _convai_session_id: convaiId,
      _transcript: { turns, raw: payload },
      _scores: { per_dim: {}, overall: 0, weights_used: {}, category, ai_error: String(e) },
      _debrief: { overall_outcome: "verfehlt", ai_error: String(e) },
    });
    return json(200, { ok: false, reason: "ai_failed" });
  }

  const scorecard = buildScorecard((debriefAI?.scores ?? {}) as Json, category);
  const debrief = { ...debriefAI, scorecard, source: "convai_webhook" };

  const { data: finRes, error: finErr } = await admin.rpc("verwaltung_finalize_realtime_session", {
    _convai_session_id: convaiId,
    _transcript: { turns, raw: payload },
    _scores: scorecard,
    _debrief: debrief,
  });
  if (finErr) {
    console.error("[verwaltung-realtime-webhook] finalize fail", finErr);
    return json(500, { error: "finalize_failed", detail: finErr.message });
  }

  return json(200, { ok: true, finalize: finRes });
});
