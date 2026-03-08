import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function openViolation(
  sb: any,
  type: string,
  severity: string,
  message: string,
  details: any,
) {
  await sb.from("system_contract_violations").insert({
    violation_type: type,
    severity,
    message,
    details,
    status: "open",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await sb.rpc("run_system_contract_audit");
  if (error) return json(500, { error: error.message });

  const audit = data || {};
  const violations: any[] = [];

  if (!audit?.ssot?.ok) {
    violations.push({ type: "ssot_mapping", severity: "critical", details: audit.ssot });
    await openViolation(sb, "ssot_mapping", "critical", "SSOT mapping incomplete", audit.ssot);
  }
  if (!audit?.contracts?.ok) {
    violations.push({ type: "contract_registry", severity: "warn", details: audit.contracts });
    await openViolation(sb, "contract_registry", "warn", "Contract registry inconsistent", audit.contracts);
  }
  if (!audit?.enums?.ok) {
    violations.push({ type: "enum_registry", severity: "warn", details: audit.enums });
    await openViolation(sb, "enum_registry", "warn", "Enum registry inconsistent", audit.enums);
  }
  if (!audit?.pipeline?.ok) {
    violations.push({ type: "pipeline_status", severity: "critical", details: audit.pipeline });
    await openViolation(sb, "pipeline_status", "critical", "Pipeline status integrity violated", audit.pipeline);
  }

  return json(200, {
    ok: violations.length === 0,
    audit,
    violations,
  });
});
