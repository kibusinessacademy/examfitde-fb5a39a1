// Chunked backfill for minicheck_questions.package_id
// Processes a single curriculum (or batch of small chunks) per invocation to avoid timeouts.
// Idempotent: only touches rows where package_id IS NULL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RunBody {
  // Optional: limit total chunks per invocation (default 8 chunks of 2000 rows = up to 16k rows)
  max_chunks?: number;
  chunk_size?: number;
  // Optional: target a specific curriculum
  curriculum_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: require admin JWT or EDGE_INTERNAL_SHARED_SECRET. Backfill performs
  // mass updates with service-role privileges and must not be public.
  const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  const jobRunnerKey = req.headers.get("x-job-runner-key") || "";
  const isInternal = !!internalSecret && jobRunnerKey === internalSecret;

  if (!isInternal) {
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    if (token === SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userSb = createClient(SUPABASE_URL, ANON_KEY);
    const { data: u, error: uErr } = await userSb.auth.getUser(token);
    if (uErr || !u?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: role } = await adminSb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!role) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  const body: RunBody = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const maxChunks = Math.max(1, Math.min(50, body.max_chunks ?? 8));
  const chunkSize = Math.max(100, Math.min(5000, body.chunk_size ?? 2000));

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const startedAt = Date.now();
  const log: any[] = [];
  let totalUpdated = 0;
  let chunksDone = 0;

  // Acquire pending curricula (those with NULL package_id rows)
  const { data: pending, error: pendErr } = await sb.rpc("admin_minicheck_pending_curricula", {});
  let pendingList: { curriculum_id: string; missing: number }[] = [];

  if (pendErr) {
    // Fallback: raw select via RPC alternative — use a SQL view if RPC missing
    const { data: rawData, error: rawErr } = await sb
      .from("minicheck_questions")
      .select("curriculum_id", { count: "exact", head: false })
      .is("package_id", null)
      .limit(1000);
    if (rawErr) {
      return new Response(JSON.stringify({ error: rawErr.message, hint: pendErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const counts = new Map<string, number>();
    for (const r of rawData ?? []) {
      counts.set(r.curriculum_id, (counts.get(r.curriculum_id) ?? 0) + 1);
    }
    pendingList = [...counts.entries()].map(([curriculum_id, missing]) => ({ curriculum_id, missing }));
  } else {
    pendingList = pending ?? [];
  }

  if (body.curriculum_id) {
    pendingList = pendingList.filter((p) => p.curriculum_id === body.curriculum_id);
  }

  if (pendingList.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, done: true, message: "No pending rows. Backfill complete." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Process curricula one by one until budget exhausted
  for (const c of pendingList) {
    if (chunksDone >= maxChunks) break;

    // Resolve package
    const { data: pkgRow, error: pkgErr } = await sb
      .from("course_packages")
      .select("id")
      .eq("curriculum_id", c.curriculum_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pkgErr) {
      log.push({ curriculum_id: c.curriculum_id, error: pkgErr.message });
      continue;
    }
    if (!pkgRow) {
      log.push({ curriculum_id: c.curriculum_id, skip: "no_package" });
      continue;
    }

    while (chunksDone < maxChunks) {
      // RPC call wrapping a chunked UPDATE returning count
      const { data: updated, error: updErr } = await sb.rpc(
        "admin_minicheck_backfill_chunk",
        {
          p_curriculum_id: c.curriculum_id,
          p_package_id: pkgRow.id,
          p_limit: chunkSize,
        },
      );
      if (updErr) {
        log.push({ curriculum_id: c.curriculum_id, error: updErr.message });
        break;
      }
      const n = Number(updated ?? 0);
      chunksDone += 1;
      totalUpdated += n;
      log.push({ curriculum_id: c.curriculum_id, package_id: pkgRow.id, chunk: chunksDone, updated: n });
      if (n < chunkSize) break; // curriculum done
      if (Date.now() - startedAt > 25000) break; // safety budget
    }

    if (Date.now() - startedAt > 25000) break;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      total_updated: totalUpdated,
      chunks_done: chunksDone,
      remaining_curricula: pendingList.length,
      elapsed_ms: Date.now() - startedAt,
      log,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
