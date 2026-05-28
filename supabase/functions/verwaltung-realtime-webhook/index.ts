/**
 * VerwaltungsOS Voice-Session Webhook (VibeOS Native) — Cut B3
 *
 * Generischer Webhook-Endpoint für post-session Debrief & Scorecard.
 * Akzeptiert ein provider-neutrales Payload (z. B. vom VibeOS Native Voice
 * Agent im Browser oder von einem eigenen Cron/n8n-Trigger).
 *
 * Auth: Public (no JWT) — verifiziert per HMAC-SHA256 + VIBEOS_WEBHOOK_SECRET.
 * Signatur-Header: `vibeos-signature: t=<unix>,v0=<hex>` (kompatibles Format).
 *
 * Erwartetes Payload (alle Felder generisch — kein Provider-Lock-in):
 *   {
 *     "session_id":      "<uuid>",                  // Bridge-Session (Pflicht)
 *     "external_id":     "<string>",                // optional, Trace-ID des Triggers
 *     "transcript": [                               // Pflicht
 *       { "role": "user|persona|agent", "content": "..." }
 *     ],
 *     "metadata": { ... }                           // optional
 *   }
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, vibeos-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("VIBEOS_WEBHOOK_SECRET") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const MODEL  = "google/gemini-3-flash-preview";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Json = Record<string, unknown>;

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---- HMAC-SHA256: header format `t=<unix>,v0=<hex>` ----
async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(p => {
    const i = p.indexOf("=");
    return i < 0 ? [p, ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const ts = parts["t"];
  const sig = parts["v0"];
  if (!ts || !sig) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 1800) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${rawBody}`));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function callAI(messages: Array<{ role: string; content: string }>): Promise<Json> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY_MISSING");
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, response_format: { type: "json_object" } }),
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

function normalizeTranscript(payload: Json): { turns: Array<{ role: string; content: string }>; text: string; sessionId: string | null; externalId: string | null } {
  const sessionId  = (payload?.session_id as string) ?? null;
  const externalId = (payload?.external_id as string) ?? null;
  const rawTurns   = (payload?.transcript as Json[]) ?? (payload?.messages as Json[]) ?? [];
  const turns = rawTurns.map(t => {
    const role = String(t?.role ?? "agent");
    const normRole = role === "user" ? "user" : "persona";
    return {
      role: normRole,
      content: String(t?.message ?? t?.content ?? t?.text ?? "").trim(),
    };
  }).filter(t => t.content.length > 0);
  const text = turns.map((t, i) => `[${i}] ${t.role}: ${t.content}`).join("\n");
  return { turns, text, sessionId, externalId };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")    return json(405, { error: "method_not_allowed" });

  if (!WEBHOOK_SECRET) return json(503, { error: "webhook_not_configured" });

  const rawBody = await req.text();
  const sigHeader = req.headers.get("vibeos-signature") ?? req.headers.get("VibeOS-Signature");
  const valid = await verifySignature(rawBody, sigHeader, WEBHOOK_SECRET);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (!valid) {
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

  const { turns, text, sessionId, externalId } = normalizeTranscript(payload);
  if (!sessionId) return json(400, { error: "missing_session_id" });

  // Audit accepted before processing — convai_session_id slot now holds external_id || session_id for trace
  await admin.rpc("fn_emit_audit", {
    _action_type: "verwaltung_realtime_webhook_received",
    _target_type: "system", _payload: {
      convai_session_id: externalId ?? sessionId,
      session_id: sessionId,
      outcome: "accepted",
      caller_role: "service_role",
    },
  });

  const { data: sess } = await admin
    .from("verwaltung_oral_sessions")
    .select("id, scenario_snapshot, scores, debrief")
    .eq("id", sessionId)
    .maybeSingle();

  if (!sess) {
    await admin.rpc("verwaltung_finalize_realtime_session", {
      _convai_session_id: externalId ?? sessionId,
      _transcript: { turns, raw: payload },
      _scores: null,
      _debrief: null,
    });
    return json(200, { ok: false, reason: "session_not_found" });
  }
  const scoresFilled  = sess.scores  && typeof sess.scores  === "object" && Object.keys(sess.scores  as Json).length > 0;
  const debriefFilled = sess.debrief && typeof sess.debrief === "object" && Object.keys(sess.debrief as Json).length > 0;
  if (scoresFilled && debriefFilled) {
    return json(200, { ok: true, idempotent: true });
  }

  // Ensure the session carries a realtime_convai_session_id so the finalize RPC
  // (which looks sessions up by that column) can find it. In the VibeOS flow we
  // use external_id || session_id as the canonical correlation key.
  const correlationId = externalId ?? sessionId;
  await admin
    .from("verwaltung_oral_sessions")
    .update({ realtime_convai_session_id: correlationId, realtime_started_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("realtime_convai_session_id", null);



  const category = String((sess.scenario_snapshot as Json)?.category ?? "Service");

  let debriefAI: Json = {};
  try {
    debriefAI = await callAI([
      { role: "system", content: debriefSystem(category) },
      { role: "user",   content: `Transkript:\n${text || "(leer)"}` },
    ]);
  } catch (e) {
    console.error("[vibeos-webhook] AI fail", e);
    await admin.rpc("verwaltung_finalize_realtime_session", {
      _convai_session_id: externalId ?? sessionId,
      _transcript: { turns, raw: payload },
      _scores: { per_dim: {}, overall: 0, weights_used: {}, category, ai_error: String(e) },
      _debrief: { overall_outcome: "verfehlt", ai_error: String(e) },
    });
    return json(200, { ok: false, reason: "ai_failed" });
  }

  const scorecard = buildScorecard((debriefAI?.scores ?? {}) as Json, category);
  const debrief   = { ...debriefAI, scorecard, source: "vibeos_webhook" };

  const { data: finRes, error: finErr } = await admin.rpc("verwaltung_finalize_realtime_session", {
    _convai_session_id: externalId ?? sessionId,
    _transcript: { turns, raw: payload },
    _scores: scorecard,
    _debrief: debrief,
  });
  if (finErr) {
    console.error("[vibeos-webhook] finalize fail", finErr);
    return json(500, { error: "finalize_failed", detail: finErr.message });
  }

  return json(200, { ok: true, finalize: finRes });
});
