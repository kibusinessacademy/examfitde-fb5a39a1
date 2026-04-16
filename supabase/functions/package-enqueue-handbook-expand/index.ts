import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/enqueue.ts";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";

/**
 * package-enqueue-handbook-expand — Pipeline Step
 *
 * After validate_handbook passes, this lightweight step:
 * 1. Finds all handbook sections with valid basis_content
 * 2. Creates handbook_expand_section jobs in job_queue
 * 3. Completes immediately (expand_handbook tracks subjob completion)
 *
 * SSOT: This step ONLY enqueues — it never generates or modifies content.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const MIN_BASIS_CHARS_FOR_EXPAND = 800;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p?.package_id as string;
  const curriculumId = p?.curriculum_id as string;

  if (!packageId || !curriculumId) {
    return json({ error: "package_id and curriculum_id required" }, 400);
  }

  // 1) Load all chapters for this curriculum
  const { data: chapters, error: chErr } = await sb
    .from("handbook_chapters")
    .select("id")
    .eq("curriculum_id", curriculumId);

  if (chErr || !chapters?.length) {
    await finalizeStepDone(sb, packageId, "enqueue_handbook_expand", { skipped: true, reason: "no_chapters" });
    return json({ ok: true, batch_complete: true, enqueued: 0, message: "No chapters found" });
  }

  const chapterIds = chapters.map((c: any) => c.id);

  // 2) Find all sections eligible for expansion
  const { data: sections, error: secErr } = await sb
    .from("handbook_sections")
    .select("id, basis_content, expand_status, content_tier")
    .in("chapter_id", chapterIds)
    .in("expand_status", ["pending", "failed_soft"]); // Include failed_soft for retry

  if (secErr) throw new Error(`Section query: ${secErr.message}`);

  // Filter to those with sufficient basis content
  const expandable = (sections || []).filter(
    (s: any) => s.basis_content && (s.basis_content as string).length >= MIN_BASIS_CHARS_FOR_EXPAND
  );

  if (expandable.length === 0) {
    console.log(`[enqueue-handbook-expand] No expandable sections for package ${packageId.slice(0, 8)}`);
    await finalizeStepDone(sb, packageId, "enqueue_handbook_expand", { skipped: true, reason: "no_expandable" });
    return json({ ok: true, batch_complete: true, enqueued: 0, message: "All sections already expanded or not ready" });
  }

  // 3) Check for existing active expand jobs to avoid duplicates
  const { data: existingJobs } = await sb
    .from("job_queue")
    .select("id, payload")
    .eq("job_type", "handbook_expand_section")
    .in("status", ["pending", "processing"])
    .limit(500);

  const activeJobSectionIds = new Set<string>();
  for (const job of (existingJobs || [])) {
    const payload = job.payload as any;
    if (payload?.section_id) activeJobSectionIds.add(payload.section_id);
  }

  // 4) Enqueue expand jobs for sections without active jobs
  //    Insert one-by-one to handle unique constraint uq_job_queue_active_package_job
  //    which only allows ONE active job per (package_id, job_type) combo when
  //    payload keys like learning_field_filter/lesson_id are absent.
  const jobsToCreate = expandable
    .filter((s: any) => !activeJobSectionIds.has(s.id));

  let enqueued = 0;
  let skippedDuplicates = 0;

  for (const s of jobsToCreate) {
    const { error: insertErr } = await enqueueJob(sb, {
      job_type: "handbook_expand_section",
      package_id: packageId,
      priority: 3,
      payload: {
        section_id: (s as any).id,
        lesson_id: (s as any).id,
        package_id: packageId,
        curriculum_id: curriculumId,
      },
    }).then(() => ({ error: null as Error | null })).catch(e => ({ error: e as Error }));

    if (insertErr) {
      if (insertErr.message?.includes("duplicate") || insertErr.message?.includes("unique")) {
        skippedDuplicates++;
      } else {
        throw new Error(`Job insert: ${insertErr.message}`);
      }
    } else {
      enqueued++;
    }
  }

  console.log(`[enqueue-handbook-expand] Enqueued ${enqueued} expand jobs for package ${packageId.slice(0, 8)} (${expandable.length} expandable, ${activeJobSectionIds.size} already active, ${skippedDuplicates} skipped duplicates)`);

  await finalizeStepDone(sb, packageId, "enqueue_handbook_expand", { enqueued, total_expandable: expandable.length });

  return json({
    ok: true,
    batch_complete: true,
    enqueued,
    total_expandable: expandable.length,
    already_active: activeJobSectionIds.size,
    skipped_duplicates: skippedDuplicates,
  });
});
