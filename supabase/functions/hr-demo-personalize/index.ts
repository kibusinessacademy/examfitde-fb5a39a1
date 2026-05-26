/**
 * hr-demo-personalize — Cut 6.1 Phase 2
 *
 * Hybrid HR-Demo: kuratiertes Matching (RPC) + AI-Personalisierungs-Layer
 * (Lovable AI Gateway, SSE-Stream). Anon-callable, rate-limited per IP-Hash.
 *
 * Inputs:  { painpoint_key, anonymous_id?, session_id?, role?, company_size? }
 * Output:  Server-Sent Events (data: {...delta} / data: [DONE])
 *
 * Architectural Continuity:
 *  - NO_PARALLEL_SYSTEMS  → nutzt existierende RPCs (public_match_packages_for_painpoint,
 *    public_get_demo_competency_summary, fn_demo_rate_limit_check, record_activation_signal)
 *  - AUDITABLE_MUTATIONS  → 3 Audit-Contracts: invoked / rate_limited / completed
 *  - SECURITY_INHERITS    → service-role auf rate-limit + signal-write
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const MODEL = "google/gemini-3-flash-preview";

async function hashIp(ip: string): Promise<string> {
  const buf = new TextEncoder().encode(`hr-demo:${ip}`);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  const painpoint_key = String(body?.painpoint_key ?? "").trim();
  const anonymous_id = body?.anonymous_id ? String(body.anonymous_id) : null;
  const session_id = body?.session_id ? String(body.session_id) : null;
  const role = body?.role ? String(body.role).slice(0, 80) : null;
  const company_size = body?.company_size ? String(body.company_size).slice(0, 40) : null;

  if (!painpoint_key || painpoint_key.length > 80) {
    return jsonResponse(400, { error: "painpoint_key_required" });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ip_hash = await hashIp(ip);
  const source_page = req.headers.get("referer") ?? null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // 1) Rate-Limit-Gate
  const { data: rlData, error: rlErr } = await admin.rpc(
    "fn_demo_rate_limit_check" as any,
    {
      _persona: "hr",
      _ip_hash: ip_hash,
      _anonymous_id: anonymous_id,
      _window_minutes: 60,
      _max_calls: 5,
    },
  );
  if (rlErr) {
    console.error("rate_limit_check_failed", rlErr);
    return jsonResponse(500, { error: "rate_limit_internal" });
  }
  const rl = Array.isArray(rlData) ? rlData[0] : rlData;
  if (rl && rl.allowed === false) {
    await admin.rpc("record_activation_signal" as any, {
      _persona: "hr",
      _signal_type: "demo_personalize_rate_limited",
      _anonymous_id: anonymous_id,
      _session_id: session_id,
      _painpoint_key: painpoint_key,
      _source_page: source_page,
      _ip_hash: ip_hash,
      _metadata: { used: rl.used, remaining: 0, reset_at: rl.reset_at },
    });
    return jsonResponse(429, {
      error: "rate_limited",
      message: "Maximal 5 Personalisierungen pro Stunde. Bitte später erneut versuchen.",
      reset_at: rl.reset_at,
    });
  }

  // 2) Kuratiertes Matching — RPC liefert ein jsonb-Objekt { matches:[...], painpoint_label }
  const { data: matchPayload, error: matchErr } = await admin.rpc(
    "public_match_packages_for_painpoint" as any,
    { _painpoint_key: painpoint_key, _limit: 3 },
  );
  if (matchErr) {
    console.error("match_rpc_failed", matchErr);
    return jsonResponse(500, { error: "match_failed" });
  }

  const matches = Array.isArray((matchPayload as any)?.matches)
    ? ((matchPayload as any).matches as any[])
    : [];
  const painpoint_label =
    (matchPayload as any)?.painpoint_label ?? painpoint_key;
  const topMatch = matches[0] ?? null;
  if (!topMatch) {
    return jsonResponse(404, {
      error: "no_match",
      message: "Für diesen Painpoint ist noch kein passendes Paket veröffentlicht.",
    });
  }

  const package_id = topMatch.package_id;

  // 3) Competency-Summary (Inhaltskontext für AI, nur Titel + Counts)
  const { data: summary } = await admin.rpc(
    "public_get_demo_competency_summary" as any,
    { _package_id: package_id },
  );

  // 4) Audit: invoked
  await admin.rpc("record_activation_signal" as any, {
    _persona: "hr",
    _signal_type: "demo_personalize_invoked",
    _anonymous_id: anonymous_id,
    _session_id: session_id,
    _package_id: package_id,
    _painpoint_key: painpoint_key,
    _source_page: source_page,
    _ip_hash: ip_hash,
    _metadata: {
      role,
      company_size,
      match_score: topMatch.match_score ?? topMatch.score ?? null,
      match_count: matches.length,
    },
  });

  if (!LOVABLE_API_KEY) {
    return jsonResponse(500, { error: "ai_gateway_not_configured" });
  }

  // 5) AI-Personalisierung via Lovable AI Gateway (Streaming)
  const systemPrompt = `Du bist BerufOS-Beratungs-AI für HR-/Ausbildungsleiter:innen im deutschsprachigen Raum.
Sprache: Deutsch. Ton: präzise, beratend, nicht werblich.
Aufgabe: Übersetze einen konkreten HR-Painpoint in einen 3-Schritte-Aktivierungsplan auf Basis eines real existierenden BerufOS-Lernpakets.
Format (Markdown, kompakt):
1. **Worum es geht** — 1 Satz, der den Painpoint im HR-Kontext zuspitzt.
2. **Was BerufOS dafür liefert** — 2–3 Bullet-Points, je 1 Zeile. Konkret aus der Paket-Struktur.
3. **3-Schritte-Aktivierungsplan** — nummeriert, je 1 Zeile, jeweils mit Zeit/Umfang (z. B. "5 Min · 1 Kompetenz").
Maximal 180 Wörter. Keine Preise nennen. Keine Versprechen über Ergebnisse.`;

  const userPrompt = `Painpoint: ${painpoint_label}
${role ? `Rolle: ${role}` : ""}
${company_size ? `Unternehmensgröße: ${company_size}` : ""}

Passendes BerufOS-Paket: ${topMatch.package_title}
Track: ${topMatch.track ?? "unbekannt"}
Kompetenz-Struktur (kuratiert):
${
  summary && (summary as any).learning_fields
    ? (summary as any).learning_fields
        .slice(0, 4)
        .map(
          (lf: any) =>
            `- ${lf.title} (${lf.competencies?.length ?? 0} Kompetenzen)`,
        )
        .join("\n")
    : "Keine Detail-Struktur verfügbar."
}

Erstelle den Aktivierungsplan.`;

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!aiResp.ok) {
    if (aiResp.status === 429) {
      return jsonResponse(429, { error: "ai_rate_limited", message: "AI-Gateway ist überlastet, bitte später erneut." });
    }
    if (aiResp.status === 402) {
      return jsonResponse(402, { error: "ai_credits_exhausted", message: "AI-Kontingent erschöpft. Workspace-Admin wurde informiert." });
    }
    const t = await aiResp.text();
    console.error("ai_gateway_error", aiResp.status, t.slice(0, 300));
    return jsonResponse(502, { error: "ai_gateway_error" });
  }

  // 6) Pass-through Stream + tail-audit
  const meta = {
    package_id,
    package_title: topMatch.package_title,
    package_key: topMatch.package_key,
    track: topMatch.track,
    matches: matches.slice(0, 3),
    summary: summary ?? null,
  };

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let tokens = 0;

  (async () => {
    // 6a) Erst Meta-Event (Frontend kann Match-Card sofort rendern)
    await writer.write(encoder.encode(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`));

    const reader = aiResp.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data: ")) {
            // forward keep-alives etc. untouched
            if (line) await writer.write(encoder.encode(line + "\n"));
            continue;
          }
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            await writer.write(encoder.encode("data: [DONE]\n\n"));
            continue;
          }
          try {
            const j = JSON.parse(payload);
            const delta = j?.choices?.[0]?.delta?.content;
            if (delta) tokens += String(delta).length;
          } catch { /* partial */ }
          await writer.write(encoder.encode(`data: ${payload}\n\n`));
        }
      }
    } catch (e) {
      console.error("stream_error", e);
    } finally {
      try {
        await admin.rpc("record_activation_signal" as any, {
          _persona: "hr",
          _signal_type: "demo_personalize_completed",
          _anonymous_id: anonymous_id,
          _session_id: session_id,
          _package_id: package_id,
          _painpoint_key: painpoint_key,
          _source_page: source_page,
          _ip_hash: ip_hash,
          _metadata: { tokens_streamed: tokens, role, company_size },
        });
      } catch (e) {
        console.error("tail_audit_failed", e);
      }
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
