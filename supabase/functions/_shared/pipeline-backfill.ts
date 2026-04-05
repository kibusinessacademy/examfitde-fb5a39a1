/**
 * pipeline-backfill.ts — Extracted from pipeline-process.ts to reduce bundle size.
 * Contains backfillPipelinePool().
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { enqueueJob } from "./enqueue.ts";

const TARGET_POOL_SIZE = 10;

export async function backfillPipelinePool(
  sb: ReturnType<typeof createClient>,
): Promise<number> {
  const { count: top30Incomplete } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .lte("priority", 10)
    .not("status", "in", '("published","done")');

  if ((top30Incomplete ?? 0) > 0) {
    console.log(`[runner] 🚧 Top-30 gate: ${top30Incomplete} packages still incomplete`);
    return 0;
  }

  const { count: activeCount } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "building", "planning"]);

  const active = activeCount ?? 0;
  const slotsToFill = TARGET_POOL_SIZE - active;

  if (slotsToFill <= 0) {
    console.log(`[runner] Pool full: ${active} active packages (target ${TARGET_POOL_SIZE})`);
    return 0;
  }

  console.log(`[runner] Pool has ${active}/${TARGET_POOL_SIZE} — backfilling ${slotsToFill}`);

  const { data: catalog } = await sb
    .from("certification_catalog")
    .select("id, title, slug, track, min_question_target, priority_score")
    .order("priority_score", { ascending: false })
    .limit(50);

  if (!catalog?.length) return 0;

  const { data: existingPackages } = await sb
    .from("course_packages")
    .select("title, status")
    .in("status", ["queued", "building", "done", "published", "planning", "failed"]);

  const existingTitles = new Set(
    (existingPackages ?? []).filter((p: { title: string | null }) => p.title).map((p: { title: string }) => p.title.toLowerCase()),
  );

  const { data: existingCurricula } = await sb
    .from("curricula")
    .select("id, title, status");

  const curriculaByTitle = new Map<string, { id: string; status: string }>();
  for (const c of existingCurricula ?? []) {
    curriculaByTitle.set(c.title.toLowerCase(), { id: c.id, status: c.status });
  }

  const candidates = catalog.filter((c: any) => {
    const packageTitle = `ExamFit – ${c.title}`.toLowerCase();
    return !existingTitles.has(packageTitle);
  });

  if (candidates.length === 0) return 0;

  const toEnqueue = candidates.slice(0, slotsToFill);
  let enqueued = 0;

  for (const cert of toEnqueue) {
    const matchKey = cert.title.toLowerCase();
    const existingCurr = curriculaByTitle.get(matchKey) ||
      [...curriculaByTitle.entries()].find(([k]) => k.includes(matchKey) || matchKey.includes(k))?.[1];

    if (existingCurr?.status === "frozen") {
      const { count: pendingSetup } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("job_type", "setup_course_package")
        .in("status", ["pending", "processing"])
        .contains("payload", { curriculum_id: existingCurr.id });

      if ((pendingSetup ?? 0) === 0) {
        await enqueueJob(sb, {
          job_type: "setup_course_package",
          max_attempts: 8,
          payload: {
            curriculum_id: existingCurr.id,
            catalog_id: cert.id,
            triggered_by: "pool_backfill",
            exam_target: cert.min_question_target || 1000,
          },
        });
        enqueued++;
        console.log(`[runner] 🏭 Backfill: "${cert.title}" (frozen curriculum)`);
      }
    } else if (!existingCurr) {
      const { count: pendingIngest } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("job_type", "package_curriculum_ingest")
        .in("status", ["pending", "processing"])
        .contains("payload", { catalog_id: cert.id });

      if ((pendingIngest ?? 0) === 0) {
        // Derive track & certification_type from catalog entry
        const catalogTrack = String(cert.track || "").toUpperCase();
        let dbTrack = "AUSBILDUNG_VOLL";
        let dbCertType: string = "ausbildung";
        if (catalogTrack === "FORTBILDUNG" || catalogTrack === "FORTBILDUNG_IHK" || catalogTrack === "ZERTIFIKAT" || catalogTrack === "CERTIFICATION" || catalogTrack === "BRANCHENZERTIFIKAT") {
          dbTrack = "EXAM_FIRST_PLUS";
          dbCertType = catalogTrack === "FORTBILDUNG" || catalogTrack === "FORTBILDUNG_IHK" ? "fortbildung_ihk" : "branchenzertifikat";
        } else if (catalogTrack === "STUDIUM" || catalogTrack === "HIGHER_EDUCATION") {
          dbTrack = "STUDIUM";
          dbCertType = "studium";
        }

        const { data: newCurr, error: currErr } = await sb
          .from("curricula")
          .insert({
            title: cert.title,
            status: "draft",
            certification_type: dbCertType,
            track: dbTrack,
          })
          .select("id")
          .single();

        if (!currErr && newCurr) {
          await enqueueJob(sb, {
            job_type: "package_curriculum_ingest",
            max_attempts: 8,
            payload: {
              curriculum_id: newCurr.id,
              catalog_id: cert.id,
              certification_title: cert.title,
              triggered_by: "pool_backfill",
            },
          });
          enqueued++;
          console.log(`[runner] 🏭 Backfill: "${cert.title}" (new curriculum)`);
        }
      }
    }
  }

  if (enqueued > 0) {
    await sb.from("auto_heal_log").insert({
      action_type: "pool_backfill",
      trigger_source: "pipeline_runner",
      result_status: "ok",
      result_detail: `Backfilled ${enqueued} to maintain pool of ${TARGET_POOL_SIZE} (was ${active})`,
      metadata: { enqueued, active_before: active, target: TARGET_POOL_SIZE, candidates: toEnqueue.map((c: any) => c.title) },
    });
  }

  return enqueued;
}
