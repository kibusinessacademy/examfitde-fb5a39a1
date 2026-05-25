// Berufs-KI Dokumenten-Agent — Edge Runner
// Auth-gated. Loads template + branding profile, validates required inputs,
// renders document via Lovable AI Gateway, performs heuristic compliance checks,
// persists run with audit trail. Profession-Guard wenn organization_id gesetzt.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DocRunRequest {
  template_slug: string;
  inputs: Record<string, string>;
  profile_id?: string | null;
  organization_id?: string | null;
  profession_id?: string | null;
}

interface FieldDef { key: string; label?: string; required?: boolean }

const NEVER_PROMISE_PATTERNS: Array<{ re: RegExp; warn: string }> = [
  { re: /rechtssicher/i, warn: "Begriff 'rechtssicher' vermeiden — Dokument ist reviewfähig, nicht garantiert rechtssicher." },
  { re: /garantier/i, warn: "Garantie-Begriffe vermeiden — keine rechtsverbindlichen Zusagen." },
  { re: /haftbar|haftung[s]?übernahme/i, warn: "Haftungs-Formulierungen erkannt — juristische Prüfung erforderlich." },
];

function renderTemplate(tpl: string, ctx: Record<string, string | undefined>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => ctx[k] ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = u.user.id;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = (await req.json()) as DocRunRequest;
    if (!body?.template_slug) {
      return new Response(JSON.stringify({ error: "template_slug required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Template laden
    const { data: tpl, error: tplErr } = await admin
      .from("document_agent_templates")
      .select("*")
      .eq("slug", body.template_slug)
      .eq("is_active", true)
      .maybeSingle();
    if (tplErr || !tpl) {
      return new Response(JSON.stringify({ error: "template_not_found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Profession Guard (optional)
    if (body.organization_id) {
      const { data: guard } = await admin.rpc("check_profession_agent_access", {
        _organization_id: body.organization_id,
        _agent_slug: "document_agent",
        _workflow_slug: body.template_slug,
        _profession_id: body.profession_id ?? null,
        _required_tier: tpl.tier_required === "free" ? "standard" : tpl.tier_required === "pro" ? "pro" : "enterprise",
      });
      const g = guard as { allowed: boolean; reason?: string } | null;
      if (g && g.allowed === false) {
        return new Response(JSON.stringify({ error: "profession_guard_denied", reason: g.reason ?? "unknown" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Required Inputs prüfen
    const required = (tpl.required_inputs ?? []) as FieldDef[];
    const inputs = body.inputs ?? {};
    const missing = required.filter((f) => f.required !== false && !inputs[f.key]?.toString().trim());
    if (missing.length > 0) {
      return new Response(JSON.stringify({
        error: "missing_inputs",
        missing: missing.map((f) => ({ key: f.key, label: f.label ?? f.key })),
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Profile laden (optional)
    let profile: Record<string, unknown> = {};
    if (body.profile_id) {
      const { data: p } = await admin
        .from("document_agent_profiles").select("*").eq("id", body.profile_id).maybeSingle();
      if (p) profile = p;
    }

    // ── Run-Row anlegen
    const t0 = Date.now();
    const { data: run, error: runErr } = await admin
      .from("document_agent_runs")
      .insert({
        user_id: userId,
        organization_id: body.organization_id ?? null,
        template_id: tpl.id,
        profile_id: body.profile_id ?? null,
        input_payload: inputs,
        status: "generating",
        review_required: tpl.review_required || tpl.risk_level === "high",
      }).select("id").single();
    if (runErr || !run) throw new Error(runErr?.message ?? "could not create run");

    // ── Prompt rendern
    const ctx: Record<string, string> = {
      ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v ?? "")])),
      company_name: String(profile.company_name ?? ""),
      legal_name: String(profile.legal_name ?? ""),
      address: String(profile.address ?? ""),
      contact_email: String(profile.contact_email ?? ""),
      phone: String(profile.phone ?? ""),
      website: String(profile.website ?? ""),
      default_sender_name: String(profile.default_sender_name ?? ""),
      default_sender_role: String(profile.default_sender_role ?? ""),
      default_signature: String(profile.default_signature ?? ""),
      tone_of_voice: String(profile.tone_of_voice ?? "professionell"),
    };
    const userPrompt = renderTemplate(tpl.user_prompt_template, ctx);
    const systemPrompt = `${tpl.system_prompt}\n\nWICHTIG: Dieses Dokument ist berufsbezogen, strukturiert und reviewfähig — niemals als "rechtssicher" oder "garantiert" bezeichnen. Bei rechtlich verbindlicher Nutzung ist eine fachliche/juristische Prüfung erforderlich. Strukturiere die Ausgabe nach diesen Sektionen: ${(tpl.output_sections as string[]).join(", ")}.`;
    const model = tpl.model_recommendation ?? "google/gemini-2.5-flash";

    // ── AI-Call
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!aiResp.ok) {
      const txt = await aiResp.text();
      await admin.from("document_agent_runs").update({
        status: "failed", error_message: txt, duration_ms: Date.now() - t0,
      }).eq("id", run.id);
      const status = aiResp.status === 429 || aiResp.status === 402 ? aiResp.status : 500;
      return new Response(JSON.stringify({ error: "ai_gateway_error", detail: txt }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const aiJson = await aiResp.json();
    const text: string = aiJson?.choices?.[0]?.message?.content ?? "";

    // ── Compliance Heuristics
    const warnings: Array<{ code: string; message: string }> = [];
    for (const p of NEVER_PROMISE_PATTERNS) {
      if (p.re.test(text)) warnings.push({ code: "never_promise", message: p.warn });
    }
    if ((tpl.compliance_rules as Record<string, unknown>)?.check_pii) {
      if (/\b\d{3,}\s?\d{3,}\b/.test(text)) {
        warnings.push({ code: "pii_phone_suspect", message: "Mögliche Telefonnummer/PII erkannt — vor Versand prüfen." });
      }
    }
    if (tpl.risk_level === "high") {
      warnings.push({ code: "high_risk", message: "Dokumenttyp mit hohem Risiko — menschliche Freigabe Pflicht." });
    }

    const quality = Math.max(0.4, Math.min(0.98, text.length / 2500 + (warnings.length === 0 ? 0.3 : 0.1)));
    const reviewRequired = tpl.review_required || tpl.risk_level === "high" || warnings.length > 0;
    const finalStatus = reviewRequired ? "needs_review" : "generated";

    await admin.from("document_agent_runs").update({
      generated_document: text,
      structured_sections: { sections: tpl.output_sections },
      compliance_warnings: warnings,
      quality_score: Number(quality.toFixed(3)),
      status: finalStatus,
      review_required: reviewRequired,
      model_used: model,
      duration_ms: Date.now() - t0,
      audit_trail: [{ event: "generated", at: new Date().toISOString(), model, warnings: warnings.length }],
    }).eq("id", run.id);

    return new Response(JSON.stringify({
      run_id: run.id,
      status: finalStatus,
      review_required: reviewRequired,
      generated_document: text,
      sections: tpl.output_sections,
      compliance_warnings: warnings,
      quality_score: Number(quality.toFixed(3)),
      model_used: model,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("document-run error:", msg);
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
