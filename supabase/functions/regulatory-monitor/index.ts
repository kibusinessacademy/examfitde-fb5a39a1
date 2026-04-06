import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

// ── Severity → Auto-Action mapping ──
const SEVERITY_ACTIONS: Record<string, { action: string; status: string }> = {
  low:      { action: "tutor_hint",       status: "up_to_date" },
  medium:   { action: "content_update",   status: "review_needed" },
  high:     { action: "rebuild_checks",   status: "outdated" },
  critical: { action: "suspend_rebuild",  status: "suspended" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "process";

    // ── ACTION: ingest — add a new regulatory update ──
    if (action === "ingest") {
      const { source, title, description, affected_topics, severity, legal_reference, effective_date, affected_curriculum_ids } = body;
      if (!source || !title) return json({ error: "source and title required" }, 400);

      const { data, error } = await sb.from("regulatory_updates").insert({
        source,
        title,
        description: description || null,
        affected_topics: affected_topics || [],
        affected_curriculum_ids: affected_curriculum_ids || [],
        severity: severity || "low",
        legal_reference: legal_reference || null,
        effective_date: effective_date || null,
      }).select().single();

      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, update: data });
    }

    // ── ACTION: process — process unprocessed updates with impact engine ──
    if (action === "process") {
      const { data: updates, error } = await sb
        .from("regulatory_updates")
        .select("*")
        .eq("processed", false)
        .order("severity", { ascending: false })
        .limit(body.limit || 20);

      if (error) return json({ error: error.message }, 500);
      if (!updates?.length) return json({ ok: true, processed: 0, message: "No pending updates" });

      const results = [];

      for (const update of updates) {
        const severityConfig = SEVERITY_ACTIONS[update.severity] || SEVERITY_ACTIONS.low;

        // Find affected packages via curriculum IDs or topic matching
        let affectedPackageIds: string[] = [];

        if (update.affected_curriculum_ids?.length) {
          const { data: packages } = await sb
            .from("course_packages")
            .select("id")
            .in("curriculum_id", update.affected_curriculum_ids);
          affectedPackageIds = (packages || []).map((p: { id: string }) => p.id);
        }

        if (!affectedPackageIds.length && update.affected_topics?.length) {
          // Topic-based matching via curriculum titles
          const { data: curricula } = await sb
            .from("curricula")
            .select("id, title");
          
          const matchedCurriculumIds = (curricula || [])
            .filter((c: { title: string }) => 
              update.affected_topics.some((topic: string) => 
                c.title.toLowerCase().includes(topic.toLowerCase())
              )
            )
            .map((c: { id: string }) => c.id);

          if (matchedCurriculumIds.length) {
            const { data: packages } = await sb
              .from("course_packages")
              .select("id")
              .in("curriculum_id", matchedCurriculumIds);
            affectedPackageIds = (packages || []).map((p: { id: string }) => p.id);
          }
        }

        // Update regulatory status for affected packages
        for (const pkgId of affectedPackageIds) {
          await sb.from("course_regulatory_status").upsert({
            package_id: pkgId,
            regulatory_status: severityConfig.status,
            last_checked_at: new Date().toISOString(),
            last_update_id: update.id,
            staleness_reason: update.title,
            auto_action_taken: severityConfig.action,
            updated_at: new Date().toISOString(),
          }, { onConflict: "package_id" });
        }

        // Critical: suspend package and trigger rebuild
        if (update.severity === "critical" && affectedPackageIds.length) {
          for (const pkgId of affectedPackageIds) {
            await sb.from("course_packages")
              .update({ status: "blocked", block_reason: `Regulatory: ${update.title}` })
              .eq("id", pkgId)
              .in("status", ["published", "building"]);
          }
        }

        // Mark update as processed
        await sb.from("regulatory_updates").update({
          processed: true,
          processed_at: new Date().toISOString(),
          auto_action: severityConfig.action,
          impact_analysis: {
            affected_packages: affectedPackageIds.length,
            action_taken: severityConfig.action,
            new_status: severityConfig.status,
          },
        }).eq("id", update.id);

        results.push({
          id: update.id,
          title: update.title,
          severity: update.severity,
          affected_packages: affectedPackageIds.length,
          action: severityConfig.action,
        });
      }

      return json({ ok: true, processed: results.length, results });
    }

    // ── ACTION: status — get regulatory status overview ──
    if (action === "status") {
      const { data, error } = await sb
        .from("course_regulatory_status")
        .select("*, course_packages(id, curriculum_id)")
        .neq("regulatory_status", "up_to_date")
        .order("updated_at", { ascending: false });

      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, flagged: data?.length || 0, items: data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
