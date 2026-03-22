/**
 * stuck-scan: Building package checks — stuck detection, zombie recovery, auto-publish.
 */
import { isPermanentStepFailure, safeRpc, type SupabaseClient } from "./stuck-scan-helpers.ts";

export async function checkStuckPackages(
  sb: SupabaseClient,
  packageTimeout: number,
) {
  const stuckSince = new Date(Date.now() - packageTimeout * 60_000).toISOString();
  const { data: stuckPackages } = await sb
    .from("course_packages")
    .select("id, title, last_progress_at, stuck_reason, course_id")
    .eq("status", "building").is("published_at", null)
    .lt("last_progress_at", stuckSince);

  const results: Array<{ package_id: string; retried: number; reason: string }> = [];

  for (const pkg of stuckPackages || []) {
    const { count: activeSteps } = await sb
      .from("package_steps").select("step_key", { count: "exact", head: true })
      .eq("package_id", pkg.id).in("status", ["running", "enqueued"]);

    if ((activeSteps ?? 0) > 0) {
      if (pkg.stuck_reason) await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
      results.push({ package_id: pkg.id, retried: 0, reason: `Skipped: ${activeSteps} active steps in package_steps` });
      continue;
    }

    const { count: activeLeases } = await sb
      .from("package_leases").select("package_id", { count: "exact", head: true })
      .eq("package_id", pkg.id).gt("lease_until", new Date().toISOString());

    if ((activeLeases ?? 0) > 0) {
      if (pkg.stuck_reason) await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
      results.push({ package_id: pkg.id, retried: 0, reason: `Skipped: active lease exists` });
      continue;
    }

    const { data: failedSteps } = await sb
      .from("package_steps").select("step_key, status, meta, last_error")
      .eq("package_id", pkg.id).eq("status", "failed");

    const permanentFailed = (failedSteps || []).filter(isPermanentStepFailure);
    if (permanentFailed.length > 0) {
      const reason = `Permanent SSOT guard failure in step(s): ${permanentFailed.slice(0, 5).map((s: any) => s.step_key).join(", ")}${permanentFailed.length > 5 ? "…" : ""}`;
      await sb.from("course_packages").update({ stuck_reason: reason }).eq("id", pkg.id);
      results.push({ package_id: pkg.id, retried: 0, reason: `Marked stuck: ${reason}` });
      continue;
    }

    const { data: candidateSteps } = await sb
      .from("package_steps").select("step_key, status, meta, last_error")
      .eq("package_id", pkg.id).in("status", ["queued", "failed"]);

    const retryableSteps = (candidateSteps || []).filter((s: any) => {
      if (s.status === "queued") return true;
      if (s.status === "failed") return !isPermanentStepFailure(s);
      return false;
    });

    if (retryableSteps.length > 0) {
      if (pkg.stuck_reason) await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
      results.push({ package_id: pkg.id, retried: 0, reason: `Has ${retryableSteps.length} retryable steps — will be picked up by runner` });
      continue;
    }

    const { data: retried } = await sb.rpc("auto_retry_stuck_package", { p_package_id: pkg.id });
    const retriedCount = retried ?? 0;

    if (retriedCount === 0) {
      const { count: totalSteps } = await sb.from("package_steps").select("step_key", { count: "exact", head: true }).eq("package_id", pkg.id);
      const { count: doneSteps } = await sb.from("package_steps").select("step_key", { count: "exact", head: true }).eq("package_id", pkg.id).in("status", ["done", "skipped"]);

      if ((totalSteps ?? 0) > 0 && (doneSteps ?? 0) === (totalSteps ?? 0)) {
        await sb.from("course_packages").update({ status: "published", stuck_reason: null }).eq("id", pkg.id);
        results.push({ package_id: pkg.id, retried: 0, reason: `All ${totalSteps} steps done — promoted to published` });
      } else {
        await sb.rpc("mark_package_stuck", { p_id: pkg.id, p_reason: `No progress for ${packageTimeout}min, no retryable steps or jobs` });
        results.push({ package_id: pkg.id, retried: 0, reason: `Marked stuck: no retryable steps or jobs` });
      }
    } else {
      results.push({ package_id: pkg.id, retried: retriedCount, reason: `Auto-retried ${retriedCount} jobs` });
    }
  }

  return results;
}

export async function checkBuildingOrphans(sb: SupabaseClient) {
  const { data: buildingPkgs } = await sb
    .from("course_packages")
    .select("id, title, build_progress, updated_at, course_id")
    .eq("status", "building").is("published_at", null).is("stuck_reason", null);

  const buildingPkgResults: Array<{ package_id: string; action: string }> = [];

  for (const pkg of buildingPkgs || []) {
    const { count: activeSteps } = await sb
      .from("package_steps").select("step_key", { count: "exact", head: true })
      .eq("package_id", pkg.id).in("status", ["running", "enqueued"]);

    const { count: queuedSteps } = await sb
      .from("package_steps").select("step_key", { count: "exact", head: true })
      .eq("package_id", pkg.id).eq("status", "queued");

    // ── ZOMBIE DETECTION ──
    if ((queuedSteps ?? 0) > 0 && (activeSteps ?? 0) === 0) {
      const { count: activeJobs } = await sb
        .from("job_queue").select("id", { count: "exact", head: true })
        .eq("package_id", pkg.id).in("status", ["pending", "processing", "queued"]);

      const { data: activeLease } = await sb
        .from("package_leases").select("id")
        .eq("package_id", pkg.id).gt("lease_until", new Date().toISOString())
        .limit(1).maybeSingle();

      if ((activeJobs ?? 0) === 0 && !activeLease) {
        // ── Grace period: skip if recently recovered via RPC ──
        const { count: recentRecovery } = await sb
          .from("auto_heal_log")
          .select("id", { count: "exact", head: true })
          .eq("action_type", "recover_and_reenter_package")
          .eq("target_id", pkg.id)
          .eq("result_status", "success")
          .gt("created_at", new Date(Date.now() - 15 * 60_000).toISOString());

        if ((recentRecovery ?? 0) > 0) {
          buildingPkgResults.push({ package_id: pkg.id, action: "Skipped zombie check: recent recovery grace period" });
          continue;
        }

        // ── Grace period: skip if package was set to building < 10 minutes ago ──
        const pkgAge = (Date.now() - new Date(pkg.updated_at).getTime()) / 60_000;
        if (pkgAge < 10) {
          buildingPkgResults.push({ package_id: pkg.id, action: `Skipped zombie check: building for only ${Math.round(pkgAge)}m (grace <10m)` });
          continue;
        }

        const { data: lastDone } = await sb
          .from("package_steps").select("finished_at")
          .eq("package_id", pkg.id).eq("status", "done")
          .order("finished_at", { ascending: false }).limit(1).maybeSingle();

        const lastDoneAge = lastDone?.finished_at
          ? (Date.now() - new Date(lastDone.finished_at).getTime()) / 60_000 : 999;

        if (lastDoneAge >= 3) {
          await sb.from("course_packages").update({
            status: "queued",
            updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          }).eq("id", pkg.id).eq("status", "building");

          await sb.from("package_leases").delete().eq("package_id", pkg.id);

          try {
            const pipelineUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pipeline-runner`;
            await fetch(pipelineUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ package_id: pkg.id }),
            });
          } catch (_e) { /* fire and forget */ }

          await sb.from("auto_heal_log").insert({
            action_type: "zombie_recovery", target_type: "course_package",
            target_id: pkg.id, trigger_source: "stuck-scan", result_status: "applied",
            result_detail: `Zombie detected: ${queuedSteps} queued steps, 0 jobs, 0 leases, last_done ${Math.round(lastDoneAge)}m ago — reset to queued + triggered runner`,
            metadata: { queued_steps: queuedSteps, last_done_age_min: Math.round(lastDoneAge), fix: "direct_requeue_v2" },
          });

          buildingPkgResults.push({ package_id: pkg.id, action: `Zombie healed: reset to queued + runner triggered (${queuedSteps} queued steps)` });
          continue;
        }
      }
      continue;
    }

    if ((activeSteps ?? 0) > 0) continue;

    const { count: totalSteps } = await sb.from("package_steps").select("step_key", { count: "exact", head: true }).eq("package_id", pkg.id);
    const { count: doneSteps } = await sb.from("package_steps").select("step_key", { count: "exact", head: true }).eq("package_id", pkg.id).in("status", ["done", "skipped"]);

    if ((totalSteps ?? 0) > 0 && (doneSteps ?? 0) === (totalSteps ?? 0)) {
      await sb.from("course_packages").update({ status: "published", stuck_reason: null }).eq("id", pkg.id);
      buildingPkgResults.push({ package_id: pkg.id, action: "All steps done — promoted to published" });
      continue;
    }

    if ((totalSteps ?? 0) === 0) {
      buildingPkgResults.push({ package_id: pkg.id, action: "No steps yet — waiting for runner bootstrap" });
      continue;
    }

    await sb.from("course_packages").update({ stuck_reason: "No actionable steps remaining" }).eq("id", pkg.id);
    buildingPkgResults.push({ package_id: pkg.id, action: "marked stuck (no actionable steps)" });
  }

  return buildingPkgResults;
}
