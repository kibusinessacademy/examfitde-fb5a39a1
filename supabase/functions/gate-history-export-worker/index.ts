// gate-history-export-worker
// Triggered by system-intent-worker for intent_type=gate_history_export.
// Streams the filtered gate-decision history into chunked CSV/JSON parts
// uploaded to the private 'gate-exports' bucket. Updates gate_export_jobs
// row to status=done with file_paths array on success.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAGE_SIZE = 5000;            // rows per RPC call
const ROWS_PER_PART = 50_000;      // rows per uploaded part file
const MAX_PARTS = 200;             // safety cap (10M rows)

const CSV_HEADERS = [
  "id","decision","prev_decision","quality_score","quality_badge",
  "bronze_locked","recorded_at","recorded_by","inputs_json",
];

function csvEscape(v: unknown): string {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowToCsv(r: any): string {
  return [
    r.id, r.decision, r.prev_decision, r.quality_score, r.quality_badge,
    r.bronze_locked, r.recorded_at, r.recorded_by, r.inputs,
  ].map(csvEscape).join(",");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const jobId: string | undefined = body?.job_id ?? body?.payload?.job_id;
  if (!jobId) {
    return new Response(JSON.stringify({ ok: false, error: "missing job_id" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load + claim job
  const { data: job, error: jobErr } = await supabase
    .from("gate_export_jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobErr || !job) {
    return new Response(JSON.stringify({ ok: false, error: "job not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (job.status !== "queued" && job.status !== "running") {
    return new Response(JSON.stringify({ ok: true, skipped: job.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  await supabase.from("gate_export_jobs").update({
    status: "running", started_at: new Date().toISOString(),
  }).eq("id", jobId);

  const filePaths: string[] = [];
  let totalRows = 0;
  let part = 1;
  let buffer: string[] = [];
  let bufferRows = 0;

  const flushPart = async () => {
    if (!bufferRows) return;
    const ext = job.format === "json" ? "json" : "csv";
    const path = `${jobId}/part_${String(part).padStart(3, "0")}.${ext}`;
    let content: Uint8Array;
    if (job.format === "json") {
      content = new TextEncoder().encode(`[${buffer.join(",")}]`);
    } else {
      content = new TextEncoder().encode(
        CSV_HEADERS.join(",") + "\n" + buffer.join("\n") + "\n",
      );
    }
    const { error: upErr } = await supabase.storage
      .from("gate-exports")
      .upload(path, content, {
        contentType: job.format === "json" ? "application/json" : "text/csv",
        upsert: true,
      });
    if (upErr) throw upErr;
    filePaths.push(path);
    part++;
    buffer = [];
    bufferRows = 0;
  };

  try {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.rpc(
        "admin_get_gate_decision_package_timeline_filtered_service" as any,
        {
          p_package_id: job.package_id,
          p_window_days: job.window_days,
          p_lane: job.lane,
          p_decision: job.decision,
          p_limit: PAGE_SIZE,
          p_offset: offset,
        },
      );
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (!rows.length) break;

      for (const r of rows) {
        if (job.format === "json") {
          buffer.push(JSON.stringify({
            id: r.id, decision: r.decision, prev_decision: r.prev_decision,
            quality_score: r.quality_score, quality_badge: r.quality_badge,
            bronze_locked: r.bronze_locked, recorded_at: r.recorded_at,
            recorded_by: r.recorded_by, inputs: r.inputs,
          }));
        } else {
          buffer.push(rowToCsv(r));
        }
        bufferRows++;
        totalRows++;
        if (bufferRows >= ROWS_PER_PART) {
          await flushPart();
          if (part > MAX_PARTS) throw new Error(`exceeded MAX_PARTS=${MAX_PARTS}`);
        }
      }

      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    await flushPart();

    await supabase.from("gate_export_jobs").update({
      status: "done",
      total_rows: totalRows,
      file_paths: filePaths,
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    return new Response(JSON.stringify({
      ok: true, job_id: jobId, parts: filePaths.length, total_rows: totalRows,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await supabase.from("gate_export_jobs").update({
      status: "failed",
      error: String((e as any)?.message ?? e),
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
