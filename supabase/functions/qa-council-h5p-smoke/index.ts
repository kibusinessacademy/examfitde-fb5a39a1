import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
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
    const action = body.action ?? "run_h5p_smoke";
    const payload = body.payload ?? {};

    if (action !== "run_h5p_smoke") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), { status: 400, headers });
    }

    const run = await sb.from("qa_runs").insert({
      run_type: payload.runType ?? "smoke",
      scope_json: { area: "h5p" },
      summary_json: {},
    }).select("id").single();
    if (run.error) throw run.error;
    const runId = run.data.id;

    // 1) Find lessons with H5P IDs
    const lessons = await sb.from("lessons")
      .select("id, course_id, title, h5p_content_ids, is_published")
      .eq("is_published", true).limit(50);

    if (lessons.error) {
      await upsert(sb, runId, {
        area: "h5p", severity: "critical",
        title: "Cannot read lessons for H5P smoke",
        description: "Tabelle lessons konnte nicht gelesen werden (service role).",
        evidence: { error: lessons.error.message },
      });
      return new Response(JSON.stringify({ ok: true, runId, summary: { lessonsReadable: false } }), { status: 200, headers });
    }

    const withH5P = (lessons.data ?? []).filter((l: { h5p_content_ids?: string[] }) =>
      Array.isArray(l.h5p_content_ids) && l.h5p_content_ids.length > 0
    );

    if (withH5P.length === 0) {
      await upsert(sb, runId, {
        area: "h5p", severity: "high",
        title: "No published lessons with H5P content IDs",
        description: "Es gibt keine veröffentlichten Lessons mit h5p_content_ids.",
        evidence: { sampleCount: (lessons.data ?? []).length },
      });
    } else {
      await sb.rpc("resolve_qa_finding_if_exists", { p_area: "h5p", p_title: "No published lessons with H5P content IDs" });
    }

    // 2) Tracking write smoke
    const write = await sb.from("qa_h5p_smoke_writes")
      .insert({ note: `H5P smoke write ${new Date().toISOString()}` }).select("id").single();

    if (write.error) {
      await upsert(sb, runId, {
        area: "h5p", severity: "critical",
        title: "H5P tracking write path failed (QA test)",
        description: "QA Smoke konnte nicht schreiben.",
        evidence: { error: write.error.message },
      });
    } else {
      await sb.rpc("resolve_qa_finding_if_exists", { p_area: "h5p", p_title: "H5P tracking write path failed (QA test)" });
    }

    const gate = await sb.rpc("compute_qa_release_gate");
    const summary = {
      publishedLessonsChecked: (lessons.data ?? []).length,
      lessonsWithH5P: withH5P.length,
      writeOk: !write.error,
      gate: gate.data ?? null,
    };
    await sb.from("qa_runs").update({ summary_json: summary }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, summary }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[qa-council-h5p-smoke] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function upsert(sb: ReturnType<typeof createClient>, runId: string, f: {
  area: string; severity: string; title: string; description: string; evidence?: Record<string, unknown>;
}) {
  const r = await sb.rpc("upsert_qa_finding", {
    p_area: f.area, p_severity: f.severity, p_title: f.title,
    p_description: f.description, p_evidence: f.evidence ?? {}, p_qa_run_id: runId,
  });
  if (r.error) console.error("[qa-h5p-smoke] upsert error:", r.error.message);
}
