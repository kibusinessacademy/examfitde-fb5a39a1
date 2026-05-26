// FördermittelOS Cut 6 — Lead Capture edge function.
// Writes to existing SSOT tables (b2b_leads, conversion_events). No new tables.
// service_role bypass for b2b_leads insert (RLS allows only service_role).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LeadPayload {
  email: string;
  companyName?: string;
  companySize?: string;
  region?: string;
  industry?: string;
  goal?: string;
  consentMarketing: boolean;
  source: string;
  requestId: string;
  leadQualityScore?: number;
  leadTier?: string;
  reportContext?: {
    topProgramSlugs?: string[];
    averageFit?: number;
    averageProbability?: number;
    freshnessRiskCount?: number;
    readinessVerdict?: string;
  };
}

const FREE_EMAIL = new Set([
  "gmail.com","googlemail.com","yahoo.com","yahoo.de","outlook.com","hotmail.com",
  "hotmail.de","gmx.de","gmx.net","web.de","t-online.de","icloud.com","me.com",
  "mail.com","freenet.de",
]);

function validEmail(e: unknown): e is string {
  return typeof e === "string"
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
    && e.length <= 254;
}

function clamp(n: unknown, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function trimStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as LeadPayload;

    if (!validEmail(body.email)) {
      return new Response(JSON.stringify({ error: "invalid_email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body.consentMarketing) {
      return new Response(JSON.stringify({ error: "consent_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body.source || !body.requestId) {
      return new Response(JSON.stringify({ error: "missing_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("supabase env missing");

    const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

    const email = body.email.toLowerCase().trim();
    const domain = email.slice(email.lastIndexOf("@") + 1);
    const isBusiness = !FREE_EMAIL.has(domain);
    const companyName = trimStr(body.companyName, 120) ?? `Lead ${domain}`;
    const industry = trimStr(body.industry, 60);
    const goal = trimStr(body.goal, 240);
    const score = clamp(body.leadQualityScore, 0, 100);
    const tier = ["cold","warm","hot"].includes(body.leadTier ?? "") ? body.leadTier! : "cold";

    const reportCtx = body.reportContext ?? {};
    const meta = {
      module: "foerdermittel",
      source_page: body.source,
      request_id: body.requestId.slice(0, 64),
      company_size: body.companySize ?? null,
      region: body.region ?? null,
      goal: goal,
      lead_tier: tier,
      lead_quality_score: score,
      is_business_email: isBusiness,
      report_top_slugs: (reportCtx.topProgramSlugs ?? []).slice(0, 10),
      report_avg_fit: clamp(reportCtx.averageFit, 0, 100),
      report_avg_probability: clamp(reportCtx.averageProbability, 0, 100),
      report_freshness_risks: clamp(reportCtx.freshnessRiskCount, 0, 100),
      report_readiness_verdict: reportCtx.readinessVerdict ?? null,
      consent_marketing: true,
      consent_at: new Date().toISOString(),
    };

    // 1) b2b_leads insert (idempotent on email+source via meta.request_id check)
    const { data: existing } = await sb
      .from("b2b_leads")
      .select("id, meta")
      .eq("contact_email", email)
      .limit(5);
    const isDuplicate = (existing ?? []).some((r: any) =>
      r.meta?.request_id === meta.request_id || r.meta?.module === "foerdermittel"
    );

    let leadId: string | null = null;
    if (!isDuplicate) {
      const { data: inserted, error: insErr } = await sb
        .from("b2b_leads")
        .insert({
          company_name: companyName,
          contact_email: email,
          industry: industry,
          source: `foerdermittel:${body.source}`,
          status: tier === "hot" ? "qualified" : "new",
          tags: ["foerdermittel", body.source, tier],
          meta,
          notes: goal,
        })
        .select("id")
        .single();
      if (insErr) {
        console.error("b2b_leads insert failed", insErr);
      } else {
        leadId = inserted?.id ?? null;
      }
    } else if (existing && existing.length > 0) {
      leadId = existing[0].id;
    }

    // 2) conversion_events — funding_report_requested
    await sb.from("conversion_events").insert({
      event_type: "funding_report_requested",
      intent: tier,
      page_path: `/foerdermittel/${body.source}`,
      metadata: {
        module: "foerdermittel",
        request_id: meta.request_id,
        lead_id: leadId,
        lead_quality_score: score,
        lead_tier: tier,
        source_page: body.source,
        report_top_slugs: meta.report_top_slugs,
        report_freshness_risks: meta.report_freshness_risks,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, leadId, duplicate: isDuplicate, tier, score }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("foerdermittel-lead-capture error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
