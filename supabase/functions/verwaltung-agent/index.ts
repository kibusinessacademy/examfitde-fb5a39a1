/**
 * VerwaltungsAgentOS v1 — Strict-RAG Runtime
 *
 * Beantwortet operative Verwaltungsfragen ausschließlich auf Basis der
 * SSOT-Workflows in `verwaltung_agent_workflows` für einen Fachbereich.
 *
 * Vertrag:
 *  - Nutzer muss authentifiziert sein.
 *  - Antwort MUSS einen [SOURCES]-Block tragen, jede Quelle = workflow_key.
 *  - Keine Quelle gefunden → deterministische Refusal-Phrase.
 *  - Keine generative Beratung außerhalb der gelisteten Workflows
 *    (kein "ich würde empfehlen", kein "üblicherweise"…).
 *  - Audit-Pflicht: jeder Run → auto_heal_log (action_type=verwaltung_agent_run).
 *
 * KEIN Chat-Tool. Das ist eine operative Workflow-Intelligenz.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REFUSAL =
  "Für diese Frage liegt im aktuellen VerwaltungsAgentOS-SSOT (Fachbereich + Workflows) keine belastbare Quelle vor. Bitte den Fachbereich um Klärung ersuchen oder die Frage präzisieren.";

interface ReqBody {
  department_key: string;
  question: string;
  workflow_category?: "process" | "communication" | "governance" | "fachverfahren" | "document" | "executive";
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: ReqBody;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" }}); }

  const department_key = (body.department_key ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!department_key || !question || question.length < 4) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1) Retrieve SSOT context (DNA + workflows) via service-role.
  const [{ data: dna }, { data: workflows }] = await Promise.all([
    svc.from("verwaltung_department_dna")
      .select("department_key, department_name, category, processes, kpis, risks")
      .eq("department_key", department_key).maybeSingle(),
    svc.from("verwaltung_agent_workflows")
      .select("workflow_key, workflow_name, category, summary, process_steps, kpi_targets, doc_outputs, escalation_triggers, governance_notes")
      .eq("department_key", department_key).eq("is_active", true)
      .order("category", { ascending: true }),
  ]);

  if (!dna || !workflows || workflows.length === 0) {
    return new Response(JSON.stringify({
      answer: REFUSAL,
      sources: [],
      department_key,
      reason: "no_ssot",
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" }});
  }

  const filtered = body.workflow_category
    ? workflows.filter((w) => w.category === body.workflow_category)
    : workflows;
  const ctx = (filtered.length ? filtered : workflows).slice(0, 8);

  const sourceCatalog = ctx.map((w) => ({
    workflow_key: w.workflow_key,
    workflow_name: w.workflow_name,
    category: w.category,
    summary: w.summary,
    process_steps: (w.process_steps as { step: string }[] | null)?.map((s) => s.step) ?? [],
    governance_notes: w.governance_notes,
  }));

  const question_hash = await sha256Hex(`${department_key}:${question}`);

  // 2) LLM Strict-RAG call
  let answer = REFUSAL;
  let cited: string[] = [];
  let llm_error: string | null = null;

  if (LOVABLE_API_KEY) {
    const systemPrompt = `Du bist VerwaltungsAgentOS für den Fachbereich "${dna.department_name}".
Du beantwortest operative Verwaltungsfragen AUSSCHLIESSLICH auf Basis der untenstehenden Workflow-Quellen (SSOT).
Halte dich strikt an:
- Keine Spekulation, keine generische Beratung, keine Rechtsberatung.
- Nutze ausschließlich Inhalte aus den SOURCES. Keine externen Annahmen.
- Antwort-Struktur: 1) Kernantwort (max 6 Sätze, sachlich, kommunal). 2) Operative Schritte als nummerierte Liste mit Bezug auf SOURCES. 3) Risiken & Eskalationspfade. 4) Fachverfahrens-/Rechtsbezug aus governance_notes.
- Wenn die Frage nicht durch die SOURCES gedeckt ist, antworte WÖRTLICH: "${REFUSAL}"
- Schließe IMMER mit einer Zeile: [SOURCES] gefolgt von kommagetrennten workflow_key-Werten der tatsächlich genutzten Quellen.

SOURCES (verbindlich, nicht erfinden):
${JSON.stringify(sourceCatalog, null, 2)}`;

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
          ],
          temperature: 0.2,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        llm_error = `gateway_${resp.status}`;
        console.error("[verwaltung-agent] gateway error", resp.status, t.slice(0, 400));
      } else {
        const j = await resp.json();
        const txt: string = j?.choices?.[0]?.message?.content ?? "";
        if (txt.trim().length > 0) {
          answer = txt.trim();
          const m = answer.match(/\[SOURCES\]\s*(.+)$/i);
          if (m) {
            cited = m[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
              .filter((k) => ctx.some((c) => c.workflow_key === k));
          }
          // Strict gate: Wenn keine echte Quelle zitiert → Refusal
          if (cited.length === 0 && !answer.includes(REFUSAL)) {
            answer = REFUSAL;
          }
        }
      }
    } catch (e) {
      llm_error = String(e);
      console.error("[verwaltung-agent] llm exception", e);
    }
  } else {
    llm_error = "no_llm_key";
  }

  // 3) Audit log
  try {
    await svc.rpc("fn_emit_audit", {
      _action_type: "verwaltung_agent_run",
      _target_type: "verwaltung_department",
      _target_id: null,
      _payload: {
        department_key,
        workflow_keys: cited,
        question_hash,
        sources_count: cited.length,
        llm_error,
        user_id: userData.user.id,
      },
      _result_status: cited.length > 0 ? "ok" : "refused",
    });
  } catch (e) {
    // Audit-Fail soll Antwort nicht blocken, aber log
    console.error("[verwaltung-agent] audit emit failed", e);
  }

  return new Response(JSON.stringify({
    answer,
    sources: cited,
    department_key,
    department_name: dna.department_name,
    workflows_available: workflows.length,
    workflows_considered: ctx.length,
    question_hash,
    llm_error,
  }), { status: 200, headers: { ...cors, "Content-Type": "application/json" }});
});
