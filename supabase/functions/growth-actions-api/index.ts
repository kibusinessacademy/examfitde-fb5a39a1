import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const payload = body.payload ?? {};

    const authHeader = req.headers.get("Authorization") ?? "";
    const hasUserJwt = authHeader.startsWith("Bearer ");

    if (action === "get_my_action") {
      if (!hasUserJwt) {
        return new Response(JSON.stringify({ ok: false, error: "Missing user JWT" }), { status: 401, headers });
      }

      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: userRes, error: uErr } = await userClient.auth.getUser();
      if (uErr) return new Response(JSON.stringify({ ok: false, error: uErr.message }), { status: 401, headers });

      const userId = userRes.user?.id;
      if (!userId) return new Response(JSON.stringify({ ok: false, error: "No user" }), { status: 401, headers });

      // Use service role to read view (admin-only RLS on base table)
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);
      const { data, error } = await sb
        .from("v_growth_actions_approved")
        .select("id, title, payload_json, created_at")
        .eq("target_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, action: data?.[0] ?? null }), { status: 200, headers });
    }

    // Admin operations - require admin role
    const adminAuth = await validateAuth(req, true);
    if (adminAuth.error) {
      return forbiddenResponse(adminAuth.error, origin ?? undefined);
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    if (action === "list_actions") {
      const status = payload.status ?? "proposed";
      const limit = Math.min(Number(payload.limit ?? 50), 200);
      const { data, error } = await sb
        .from("growth_actions")
        .select("id, action_type, target_user_id, title, status, dedupe_key, cooldown_until, created_at, rationale_json")
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, items: data ?? [] }), { status: 200, headers });
    }

    if (action === "approve") {
      const id = payload.actionId;
      if (!id) return new Response(JSON.stringify({ ok: false, error: "Missing actionId" }), { status: 400, headers });
      const r = await sb.rpc("admin_approve_growth_action", { p_action_id: id });
      if (r.error) throw r.error;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (action === "dismiss") {
      const id = payload.actionId;
      if (!id) return new Response(JSON.stringify({ ok: false, error: "Missing actionId" }), { status: 400, headers });
      const r = await sb.rpc("admin_dismiss_growth_action", { p_action_id: id });
      if (r.error) throw r.error;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (action === "cooldown") {
      const id = payload.actionId;
      const days = Number(payload.days ?? 3);
      if (!id) return new Response(JSON.stringify({ ok: false, error: "Missing actionId" }), { status: 400, headers });
      const r = await sb.rpc("set_growth_action_cooldown", { p_action_id: id, p_days: days });
      if (r.error) throw r.error;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (action === "mark_sent") {
      const id = payload.actionId;
      if (!id) return new Response(JSON.stringify({ ok: false, error: "Missing actionId" }), { status: 400, headers });
      await sb.from("growth_actions").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", id);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    // --- Learner-facing: claim_referral (requires user JWT) ---
    if (action === "claim_referral") {
      if (!hasUserJwt) {
        return new Response(JSON.stringify({ ok: false, error: "Missing JWT" }), { status: 401, headers });
      }
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: uRes, error: uErr2 } = await userClient.auth.getUser();
      if (uErr2 || !uRes.user) return new Response(JSON.stringify({ ok: false, error: "Auth error" }), { status: 401, headers });

      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE);
      const { data: result, error: claimErr } = await svc.rpc("claim_referral_code", {
        p_invite_code: payload.invite_code,
        p_referred_user_id: uRes.user.id,
      });
      if (claimErr) throw claimErr;
      return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers });
    }

    // --- Learner-facing: record_share (requires user JWT, not admin) ---
    if (action === "record_share") {
      if (!hasUserJwt) {
        return new Response(JSON.stringify({ ok: false, error: "Missing JWT" }), { status: 401, headers });
      }
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: uRes, error: uErr2 } = await userClient.auth.getUser();
      if (uErr2 || !uRes.user) return new Response(JSON.stringify({ ok: false, error: "Auth error" }), { status: 401, headers });

      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE);
      await svc.from("share_events").insert({
        user_id: uRes.user.id,
        share_channel: payload.channel ?? "unknown",
        share_type: "exam_result",
        entity_type: "exam_session",
        entity_id: payload.sessionId ?? null,
      });
      // Update share metadata for attribution
      if (payload.referralCode) {
        await svc.from("share_events").update({ metadata: { score: payload.score, passed: payload.passed, referral_code: payload.referralCode } })
          .eq("user_id", uRes.user.id)
          .order("created_at", { ascending: false })
          .limit(1);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), { status: 400, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[growth-actions-api] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});
