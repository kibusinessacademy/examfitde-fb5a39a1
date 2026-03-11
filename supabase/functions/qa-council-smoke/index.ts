import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "run_smoke";
    const payload = body.payload ?? {};

    if (action !== "run_smoke") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), { status: 400, headers });
    }

    const run = await sb.from("qa_runs").insert({
      run_type: payload.runType ?? "smoke",
      scope_json: payload.scope ?? {},
      summary_json: {},
    }).select("id").single();
    if (run.error) throw run.error;
    const runId = run.data.id;

    // 1) Job queue health
    await checkJobs(sb, runId);

    // 2) Payments: reconcile gaps
    await checkPayments(sb, runId);

    // 3) Basic data integrity
    await checkDataIntegrity(sb, runId);

    // 4) Summarize gate status
    const gate = await sb.rpc("compute_qa_release_gate");
    const summary = { gate: gate.data ?? null };
    await sb.from("qa_runs").update({ summary_json: summary }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, summary }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[qa-council-smoke] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function upsertFinding(sb: ReturnType<typeof createClient>, runId: string, input: {
  area: string; severity: string; title: string; description: string; evidence?: Record<string, unknown>;
}) {
  const r = await sb.rpc("upsert_qa_finding", {
    p_area: input.area, p_severity: input.severity, p_title: input.title,
    p_description: input.description, p_evidence: input.evidence ?? {},
    p_qa_run_id: runId,
  });
  if (r.error) console.error("[qa-council-smoke] upsert finding error:", r.error.message);
}

async function checkJobs(sb: ReturnType<typeof createClient>, runId: string) {
  const q = await sb.from("job_queue").select("status, created_at").order("created_at", { ascending: false }).limit(200);
  if (q.error) {
    await upsertFinding(sb, runId, {
      area: "jobs", severity: "critical", title: "job_queue not readable",
      description: "job_queue konnte nicht gelesen werden (service role).",
      evidence: { error: q.error.message },
    });
    return;
  }

  const rows = q.data ?? [];
  const failed = rows.filter((r: { status: string }) => r.status === "failed").length;
  const pending = rows.filter((r: { status: string }) => r.status === "pending").length;

  if (failed >= 10) {
    await upsertFinding(sb, runId, {
      area: "jobs", severity: "high", title: "Many failed jobs (last 200)",
      description: `Es gibt ${failed} fehlgeschlagene Jobs in den letzten 200.`,
      evidence: { failed, pending },
    });
  } else {
    await sb.rpc("resolve_qa_finding_if_exists", { p_area: "jobs", p_title: "Many failed jobs (last 200)" });
  }

  if (pending >= 150) {
    await upsertFinding(sb, runId, {
      area: "jobs", severity: "high", title: "Backlog too high (pending)",
      description: `Job Backlog ist hoch: ${pending} pending in den letzten 200.`,
      evidence: { pending, failed },
    });
  } else {
    await sb.rpc("resolve_qa_finding_if_exists", { p_area: "jobs", p_title: "Backlog too high (pending)" });
  }
}

async function checkPayments(sb: ReturnType<typeof createClient>, runId: string) {
  let gaps: any = { data: null, error: null };
  try { gaps = await sb.rpc("get_reconcile_gaps_details", { p_limit: 50 }); } catch { gaps = { data: null, error: null }; }
  if (gaps?.error || !gaps?.data) return;

  const count = (gaps.data as unknown[]).length;
  if (count >= 10) {
    await upsertFinding(sb, runId, {
      area: "payments", severity: "high", title: "Stripe reconcile gaps detected",
      description: `Es gibt ${count} Orders ohne payment_succeeded im finance_ledger.`,
      evidence: { count, sample: (gaps.data as unknown[]).slice(0, 5) },
    });
  } else {
    await sb.rpc("resolve_qa_finding_if_exists", { p_area: "payments", p_title: "Stripe reconcile gaps detected" });
  }
}

async function checkDataIntegrity(sb: ReturnType<typeof createClient>, runId: string) {
  const c = await sb.from("course_enrollments").select("id, course_id").limit(1);
  if (c.error) {
    await upsertFinding(sb, runId, {
      area: "data_integrity", severity: "medium", title: "Cannot read course_enrollments",
      description: "course_enrollments konnte nicht gelesen werden (service role).",
      evidence: { error: c.error.message },
    });
  } else {
    await sb.rpc("resolve_qa_finding_if_exists", { p_area: "data_integrity", p_title: "Cannot read course_enrollments" });
  }
}
