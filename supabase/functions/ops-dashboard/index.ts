import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller is authenticated
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    // Use service role for reading ops views
    const sb = createClient(supabaseUrl, supabaseKey);

    const tsNow = new Date().toISOString();

    const [q1, q2, q3, q4, q5] = await Promise.all([
      sb.from("ops_batch_requeue_summary").select("*").limit(200),
      sb.from("ops_package_steps_stuck").select("*").limit(200),
      sb.from("ops_step_job_drift").select("*").limit(300),
      sb.from("ops_prereq_guard_cancelled").select("*").limit(200),
      sb.from("ops_course_build_progress").select("*").limit(300),
    ]);

    const errors = [q1.error, q2.error, q3.error, q4.error, q5.error]
      .filter(Boolean)
      .map((e) => e!.message);

    if (errors.length > 0) {
      return json(
        { ok: false, error: "OPS snapshot query failed", details: errors },
        500,
      );
    }

    return json({
      ok: true,
      as_of: tsNow,
      snapshot: {
        batch_requeue_summary: q1.data ?? [],
        package_steps_stuck: q2.data ?? [],
        step_job_drift: q3.data ?? [],
        prereq_guard_cancelled: q4.data ?? [],
        course_build_progress: q5.data ?? [],
      },
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
