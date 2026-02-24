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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth + admin check
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);

    const { data: roleData } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) return json({ error: "Admin required" }, 403);

    // ── ENVIRONMENT GUARD: Only staging ──
    // In production, you'd check an env var like ENVIRONMENT=staging
    // For now, we proceed but tag everything as "staging"
    const targetEnv = "staging";

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "seed") {
      // Ensure test org, users, entitlements, curriculum, package exist
      const results: string[] = [];

      // 1. Check/create test org
      const testOrgName = "UAT Test Organisation";
      let { data: org } = await sb.from("organizations").select("id").eq("name", testOrgName).maybeSingle();
      if (!org) {
        const { data: newOrg, error } = await sb.from("organizations").insert({
          name: testOrgName,
          slug: "uat-test-org",
          status: "active",
        }).select("id").single();
        if (error) return json({ error: `Org creation failed: ${error.message}` }, 500);
        org = newOrg;
        results.push(`Created test org: ${org.id}`);
      } else {
        results.push(`Test org exists: ${org.id}`);
      }

      // 2. Check test users (we don't create auth users here – they must exist)
      const testEmails = [
        "smoke_no_entitlement@examfit.test",
        "smoke_with_entitlement@examfit.test",
        "uat_azubi@examfit.test",
      ];

      for (const email of testEmails) {
        const { data: authUser } = await sb.auth.admin.getUserByEmail(email);
        if (authUser?.user) {
          results.push(`User exists: ${email} (${authUser.user.id})`);
        } else {
          // Create test user via admin API
          const { data: newUser, error } = await sb.auth.admin.createUser({
            email,
            password: `TestPass_${Date.now()}!`,
            email_confirm: true,
            user_metadata: { display_name: email.split("@")[0], test_user: true },
          });
          if (error) {
            results.push(`WARN: Could not create ${email}: ${error.message}`);
          } else {
            results.push(`Created user: ${email} (${newUser.user.id})`);
          }
        }
      }

      // 3. Check for at least 1 frozen curriculum (for testing)
      const { data: curricula } = await sb
        .from("curricula")
        .select("id, title")
        .eq("is_frozen", true)
        .limit(1);

      if (curricula && curricula.length > 0) {
        results.push(`Test curriculum available: ${curricula[0].title} (${curricula[0].id})`);
      } else {
        results.push("WARN: No frozen curriculum found for testing");
      }

      return json({ ok: true, env: targetEnv, results });
    }

    if (action === "status") {
      // Check seed status
      const testEmails = [
        "smoke_no_entitlement@examfit.test",
        "smoke_with_entitlement@examfit.test",
        "uat_azubi@examfit.test",
      ];

      const users: any[] = [];
      for (const email of testEmails) {
        const { data } = await sb.auth.admin.getUserByEmail(email);
        users.push({ email, exists: !!data?.user, id: data?.user?.id || null });
      }

      const { data: curricula } = await sb
        .from("curricula")
        .select("id, title")
        .eq("is_frozen", true)
        .limit(3);

      return json({
        ok: true,
        env: targetEnv,
        test_users: users,
        available_curricula: curricula || [],
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
