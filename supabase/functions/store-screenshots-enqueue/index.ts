// Store Screenshots Enqueue
// Records a screenshot run request. The actual Playwright capture happens in a
// GitHub Action (.github/workflows/store-screenshots.yml) triggered by repository_dispatch.
// This function does NOT call GitHub directly — it returns the run record so the
// admin can either dispatch manually or rely on a scheduled poller in CI.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

const DEFAULT_ROUTES = ["/dashboard", "/app/oral", "/courses", "/app/exam"];
const DEVICE_PROFILES = {
  apple: ["iphone_6_7", "iphone_5_5", "ipad_12_9"],
  google: ["android_phone", "android_tablet_7", "android_tablet_10"],
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const { courseId, platform, routes, actorId = null } = body ?? {};

  if (!courseId || !platform || !["apple", "google"].includes(platform)) {
    return json({ error: "courseId and platform (apple|google) required" }, 400);
  }

  const useRoutes = Array.isArray(routes) && routes.length > 0 ? routes : DEFAULT_ROUTES;
  const profiles = DEVICE_PROFILES[platform as "apple" | "google"];

  // Create run record
  const { data: run, error: runErr } = await sb
    .from("store_release_screenshot_runs")
    .insert({
      course_id: courseId,
      platform,
      status: "queued",
      requested_by: actorId,
      routes: useRoutes,
      device_profiles: profiles,
      notes: "Pending pickup by .github/workflows/store-screenshots.yml",
    })
    .select()
    .single();

  if (runErr) return json({ error: runErr.message }, 500);

  // Seed pending rows
  const rows = [];
  for (const profile of profiles) {
    for (const route of useRoutes) {
      rows.push({
        course_id: courseId,
        platform,
        device_profile: profile,
        route,
        status: "pending",
        run_id: (run as any).id,
      });
    }
  }
  if (rows.length > 0) {
    await sb.from("store_release_screenshots").insert(rows);
  }

  return json({ ok: true, run, pending_shots: rows.length });
});
