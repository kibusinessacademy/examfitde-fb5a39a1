import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SB = ReturnType<typeof createClient>;

interface PolicyRow {
  id: string;
  policy_key: string;
  enabled: boolean;
  threshold_minutes: number;
  max_per_run: number;
  cooldown_minutes: number;
  config_json: Record<string, unknown>;
  last_run_at: string | null;
  // Safety Rails
  dry_run: boolean;
  max_per_hour: number | null;
  max_per_day: number | null;
  escalate_instead: boolean;
  blacklist_ids: string[];
  requires_transient_pattern: boolean;
  severity: string;
}

interface HealResult {
  policy_key: string;
  updated: number;
  affected_ids: string[];
  skipped_reason?: string;
  was_dry_run?: boolean;
  escalated?: boolean;
}

/* ── Safety: count actions in time window ── */
async function countRecentActions(sb: SB, policyKey: string, hoursBack: number): Promise<number> {
  try {
    const since = new Date(Date.now() - hoursBack * 3600_000).toISOString();
    const { count } = await sb
      .from("auto_heal_log")
      .select("*", { count: "exact", head: true })
      .eq("action_type", `auto_heal:${policyKey}`)
      .gte("created_at", since);
    return count ?? 0;
  } catch { return 0; }
}

/* ── Safety: check budget limits ── */
async function checkBudgetLimits(sb: SB, policy: PolicyRow): Promise<string | null> {
  if (policy.max_per_hour) {
    const hourCount = await countRecentActions(sb, policy.policy_key, 1);
    if (hourCount >= policy.max_per_hour) return `hourly_limit_reached (${hourCount}/${policy.max_per_hour})`;
  }
  if (policy.max_per_day) {
    const dayCount = await countRecentActions(sb, policy.policy_key, 24);
    if (dayCount >= policy.max_per_day) return `daily_limit_reached (${dayCount}/${policy.max_per_day})`;
  }
  return null;
}

/* ── Safety: filter blacklisted IDs ── */
function filterBlacklist(ids: string[], blacklist: string[]): string[] {
  if (!blacklist?.length) return ids;
  const bl = new Set(blacklist);
  return ids.filter(id => !bl.has(id) && !bl.has(id.split(":")[0]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Missing env" }, 500);

    const sb = createClient(supabaseUrl, serviceKey);

    const { data: policies, error: polErr } = await sb
      .from("auto_heal_config")
      .select("*")
      .eq("enabled", true);

    if (polErr) throw polErr;
    if (!policies?.length) return json({ ok: true, results: [], message: "No enabled policies" });

    const results: HealResult[] = [];
    const now = new Date();

    for (const policy of policies as PolicyRow[]) {
      // Cooldown check
      if (policy.last_run_at) {
        const lastRun = new Date(policy.last_run_at);
        const cooldownMs = (policy.cooldown_minutes || 5) * 60_000;
        if (now.getTime() - lastRun.getTime() < cooldownMs) {
          results.push({ policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: "cooldown" });
          continue;
        }
      }

      // Safety: Budget limits
      const budgetBlock = await checkBudgetLimits(sb, policy);
      if (budgetBlock) {
        results.push({ policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: budgetBlock });
        continue;
      }

      // Safety: Escalate instead of auto-heal
      if (policy.escalate_instead) {
        const result = await escalateInstead(sb, policy);
        results.push(result);
        continue;
      }

      let result: HealResult;

      try {
        switch (policy.policy_key) {
          case "requeue_transient_failed":
            result = await healRequeueTransient(sb, policy);
            break;
          case "release_expired_cooldowns":
            result = await healReleaseCooldowns(sb, policy);
            break;
          case "reset_stuck_steps":
            result = await healResetStuck(sb, policy);
            break;
          case "cancel_zombies":
            result = await healCancelZombies(sb, policy);
            break;
          case "flag_seo_gaps":
            result = await healFlagSeoGaps(sb, policy);
            break;
          case "archive_stale_drafts":
            result = await healArchiveStaleDrafts(sb, policy);
            break;
          case "fix_broken_redirects":
            result = await healFixBrokenRedirects(sb, policy);
            break;
          default:
            result = { policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: "unknown_policy" };
        }
      } catch (e) {
        result = { policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: String(e) };
      }

      // Update last_run
      await sb.from("auto_heal_config").update({
        last_run_at: now.toISOString(),
        last_run_result: result as any,
        updated_at: now.toISOString(),
      }).eq("id", policy.id);

      // Audit log
      if (result.updated > 0 || result.was_dry_run) {
        await sb.from("auto_heal_log").insert({
          action_type: `auto_heal:${policy.policy_key}`,
          trigger_source: "scheduled",
          result_status: result.was_dry_run ? "dry_run" : "success",
          result_detail: result.was_dry_run
            ? `DRY RUN: would affect ${result.updated} items`
            : `Healed ${result.updated} items`,
          target_type: policy.policy_key,
          target_id: result.affected_ids[0] || null,
          metadata: { affected_ids: result.affected_ids, severity: policy.severity } as any,
          was_dry_run: result.was_dry_run || false,
          policy_key: policy.policy_key,
        });

        // Also log to admin_actions for audit trail (only real actions)
        if (!result.was_dry_run && result.updated > 0) {
          await sb.from("admin_actions").insert({
            action: `auto_heal:${policy.policy_key}`,
            payload: { policy_key: policy.policy_key, threshold_minutes: policy.threshold_minutes } as any,
            before_state: null,
            after_state: { updated: result.updated } as any,
            affected_ids: result.affected_ids,
            scope: "auto_heal",
          });
        }
      }

      results.push(result);
    }

    return json({ ok: true, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/* ── Escalate: create notification instead of healing ── */
async function escalateInstead(sb: SB, policy: PolicyRow): Promise<HealResult> {
  await sb.from("admin_notifications").insert({
    title: `Eskalation: ${policy.label}`,
    body: `Policy "${policy.policy_key}" hätte eingegriffen, ist aber auf Eskalation konfiguriert. Bitte manuell prüfen.`,
    severity: policy.severity === "critical" ? "critical" : "warning",
    category: "auto_heal",
    entity_type: "auto_heal_config",
    entity_id: policy.id,
    metadata: { policy_key: policy.policy_key, escalated: true } as any,
  });
  return { policy_key: policy.policy_key, updated: 0, affected_ids: [], escalated: true, skipped_reason: "escalated_to_admin" };
}

/* ── Heal: Requeue transient failed jobs ── */
// GOVERNANCE EXCLUSION: never requeue governance job types
const GOVERNANCE_JOB_TYPES_AHR = new Set([
  "package_run_integrity_check",
  "package_quality_council",
  "package_auto_publish",
]);
const GOVERNANCE_STEP_KEYS_AHR = new Set([
  "run_integrity_check",
  "quality_council",
  "auto_publish",
]);

async function healRequeueTransient(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const thresholdMs = (policy.threshold_minutes || 5) * 60_000;
  const since = new Date(Date.now() - thresholdMs).toISOString();
  const transientPatterns = ['503', '504', 'timeout', 'rate_limit', 'rate-limit', 'ECONNRESET', 'ops_empty_response'];

  const { data: jobs, error } = await sb
    .from("job_queue")
    .select("id, job_type, last_error")
    .eq("status", "failed")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(policy.max_per_run);

  if (error) throw error;
  if (!jobs?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  const transient = jobs.filter((j: any) => {
    // GOVERNANCE EXCLUSION
    if (GOVERNANCE_JOB_TYPES_AHR.has(j.job_type)) return false;
    const err = String(j.last_error || "").toLowerCase();
    return transientPatterns.some(p => err.includes(p));
  });

  if (!transient.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  let ids = transient.map((j: any) => j.id);
  ids = filterBlacklist(ids, policy.blacklist_ids || []);
  if (!ids.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: "all_blacklisted" };

  // Dry run: don't actually change
  if (policy.dry_run) {
    return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids, was_dry_run: true };
  }

  const { error: updErr } = await sb
    .from("job_queue")
    .update({
      status: "pending", last_error: null, updated_at: new Date().toISOString(),
      meta: { transition_source: "auto-heal-runner", transition_reason: "requeue_transient", transition_prev_status: "failed", transition_at: new Date().toISOString() },
    })
    .in("id", ids);

  if (updErr) throw updErr;
  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}

/* ── Heal: Release expired cooldowns ── */
async function healReleaseCooldowns(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const now = new Date().toISOString();

  if (policy.dry_run) {
    const { count } = await sb
      .from("llm_provider_cooldowns")
      .select("*", { count: "exact", head: true })
      .lt("cooldown_until", now)
      .gt("cooldown_until", new Date(0).toISOString());
    return { policy_key: policy.policy_key, updated: count ?? 0, affected_ids: [], was_dry_run: true };
  }

  const { data, error } = await sb
    .from("llm_provider_cooldowns")
    .update({ cooldown_until: new Date(0).toISOString(), updated_at: now })
    .lt("cooldown_until", now)
    .gt("cooldown_until", new Date(0).toISOString())
    .select("id")
    .limit(policy.max_per_run);

  if (error) throw error;
  const ids = (data || []).map((r: any) => r.id);
  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}

/* ── Heal: Reset stuck steps ── */
async function healResetStuck(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const { data: rows, error } = await sb
    .from("ops_package_steps_stuck")
    .select("package_id, step_key, minutes_stuck, stall_minutes")
    .limit(policy.max_per_run);

  if (error) throw error;
  if (!rows?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  const threshold = policy.threshold_minutes || 60;
  const affected: string[] = [];

  for (const row of rows as any[]) {
    const stallMin = row.minutes_stuck ?? row.stall_minutes ?? 0;
    if (stallMin < threshold) continue;
    if (!row.package_id || !row.step_key) continue;
    // GOVERNANCE EXCLUSION: never reset governance steps
    if (GOVERNANCE_STEP_KEYS_AHR.has(row.step_key)) continue;

    const compositeId = `${row.package_id}:${row.step_key}`;
    if (filterBlacklist([compositeId], policy.blacklist_ids || []).length === 0) continue;

    if (policy.dry_run) {
      affected.push(compositeId);
      continue;
    }

    const { error: updErr } = await sb
      .from("package_steps")
      .update({
        status: "queued", started_at: null, finished_at: null, last_error: null, updated_at: new Date().toISOString(),
        meta: { transition_source: "auto-heal-runner", transition_reason: "reset_stuck_step", transition_at: new Date().toISOString() },
      })
      .eq("package_id", row.package_id)
      .eq("step_key", row.step_key);

    if (!updErr) affected.push(compositeId);
  }

  return { policy_key: policy.policy_key, updated: affected.length, affected_ids: affected, was_dry_run: policy.dry_run };
}

/* ── Heal: Cancel zombie packages ── */
async function healCancelZombies(sb: SB, policy: PolicyRow): Promise<HealResult> {
  // View already filters: building >10min, no jobs/leases, no recent recovery
  const { data: zombies, error } = await sb
    .from("ops_building_without_job_or_lease")
    .select("package_id, updated_at")
    .limit(policy.max_per_run);

  if (error) throw error;
  if (!zombies?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  let ids = (zombies as any[]).map(z => z.package_id).filter(Boolean);
  ids = filterBlacklist(ids, policy.blacklist_ids || []);
  if (!ids.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: "all_blacklisted" };

  if (policy.dry_run) {
    return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids, was_dry_run: true };
  }

  const { error: updErr } = await sb
    .from("course_packages")
    .update({ status: "blocked", blocked_reason: "auto_heal_zombie", updated_at: new Date().toISOString() })
    .in("id", ids);

  if (updErr) throw updErr;
  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}

/* ── Heal: Flag SEO gaps ── */
async function healFlagSeoGaps(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const { data: pages } = await sb
    .from("content_pages")
    .select("id, title, slug")
    .eq("status", "published")
    .or("meta_title.is.null,meta_description.is.null")
    .limit(policy.max_per_run);

  const { data: blogs } = await sb
    .from("blog_posts")
    .select("id, title, slug")
    .eq("status", "published")
    .or("meta_title.is.null,meta_description.is.null")
    .limit(policy.max_per_run);

  const allGaps = [...(pages || []), ...(blogs || [])];
  if (!allGaps.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  if (policy.dry_run) {
    return { policy_key: policy.policy_key, updated: allGaps.length, affected_ids: allGaps.map(g => g.id), was_dry_run: true };
  }

  await sb.from("admin_notifications").insert({
    title: `SEO-Lücken: ${allGaps.length} veröffentlichte Inhalte ohne Meta-Daten`,
    body: `Betroffene: ${allGaps.slice(0, 5).map(g => g.title || g.slug).join(', ')}${allGaps.length > 5 ? ` und ${allGaps.length - 5} weitere` : ''}`,
    severity: allGaps.length > 10 ? 'critical' : 'warning',
    category: 'seo',
    entity_type: 'content',
    metadata: { gap_count: allGaps.length, sample_ids: allGaps.slice(0, 10).map(g => g.id) } as any,
  });

  return { policy_key: policy.policy_key, updated: allGaps.length, affected_ids: allGaps.map(g => g.id) };
}

/* ── Heal: Archive stale drafts ── */
async function healArchiveStaleDrafts(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const thresholdDays =
    typeof (policy.config_json as any)?.threshold_days === 'number'
      ? (policy.config_json as any).threshold_days
      : 30;

  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60_000).toISOString();

  const { data: stalePages, error } = await sb
    .from("content_pages")
    .select("id, title")
    .eq("status", "draft")
    .lt("updated_at", cutoff)
    .limit(policy.max_per_run);

  if (error) throw error;
  if (!stalePages?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  let ids = stalePages.map((p: any) => String(p.id)).filter(Boolean);
  ids = filterBlacklist(ids, policy.blacklist_ids || []);

  if (!ids.length) {
    return { policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: "all_blacklisted" };
  }

  if (policy.dry_run) {
    return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids, was_dry_run: true };
  }

  await sb.from("admin_notifications").insert({
    title: `${ids.length} Seiten-Entwürfe seit ${thresholdDays}+ Tagen unverändert`,
    body: `Erwäge Archivierung: ${stalePages.slice(0, 5).map((p: any) => p.title).join(", ")}`,
    severity: "info",
    category: "content",
    entity_type: "content_pages",
    metadata: { stale_count: ids.length, stale_ids: ids.slice(0, 20), threshold_days: thresholdDays } as any,
  });

  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}

/* ── Heal: Fix broken redirects ── */
async function healFixBrokenRedirects(sb: SB, policy: PolicyRow): Promise<HealResult> {
  const { data: broken, error } = await sb
    .from("seo_redirects")
    .select("id, from_path, to_path")
    .eq("is_active", true)
    .or("to_path.is.null,to_path.eq.")
    .limit(policy.max_per_run);

  if (error) throw error;
  if (!broken?.length) return { policy_key: policy.policy_key, updated: 0, affected_ids: [] };

  let ids = broken.map((r: any) => String(r.id)).filter(Boolean);
  ids = filterBlacklist(ids, policy.blacklist_ids || []);

  if (!ids.length) {
    return { policy_key: policy.policy_key, updated: 0, affected_ids: [], skipped_reason: "all_blacklisted" };
  }

  if (policy.dry_run) {
    return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids, was_dry_run: true };
  }

  // Notify instead of blind auto-fix for broken redirects
  await sb.from("admin_notifications").insert({
    title: `${ids.length} fehlerhafte Redirects erkannt`,
    body: `Bitte prüfen: ${broken.slice(0, 5).map((r: any) => `${r.from_path} → ${r.to_path || '(leer)'}`).join(", ")}`,
    severity: ids.length > 10 ? "warning" : "info",
    category: "seo",
    entity_type: "seo_redirects",
    metadata: { broken_redirect_ids: ids.slice(0, 20) } as any,
  });

  return { policy_key: policy.policy_key, updated: ids.length, affected_ids: ids };
}
