import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

function weakHash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return (h >>> 0).toString(16);
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "claim";
    const payload = body.payload ?? body;

    if (action !== "claim") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), { status: 400, headers });
    }

    const code = String(payload.code ?? "").trim().toUpperCase();
    const deviceId = String(payload.deviceId ?? "").trim();
    if (!code || code.length < 6) return new Response(JSON.stringify({ ok: false, error: "Invalid code" }), { status: 400, headers });
    if (!deviceId) return new Response(JSON.stringify({ ok: false, error: "Missing deviceId" }), { status: 400, headers });

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return new Response(JSON.stringify({ ok: false, error: "Missing user JWT" }), { status: 401, headers });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes, error: uErr } = await userClient.auth.getUser();
    if (uErr) return new Response(JSON.stringify({ ok: false, error: uErr.message }), { status: 401, headers });

    const userId = userRes.user?.id;
    if (!userId) return new Response(JSON.stringify({ ok: false, error: "No user" }), { status: 401, headers });

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ua = req.headers.get("user-agent") ?? "unknown";
    const ipHash = weakHash(ip);
    const uaHash = weakHash(ua);
    const deviceHash = weakHash(deviceId);

    // 0) User blocked?
    const blocked = await sb.rpc("is_user_blocked", { p_user: userId });
    if (blocked.error) throw blocked.error;
    if (blocked.data === true) {
      await logEvent(sb, {
        event_type: "admin_block", user_id: userId, license_code: code,
        ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
        decision: "block", reason: "user_blocked",
      });
      return new Response(JSON.stringify({ ok: false, error: "Account blocked" }), { status: 403, headers });
    }

    // 1) Code locked?
    const lock = await sb.rpc("is_code_locked", { p_code: code });
    if (lock.error) throw lock.error;
    if (lock.data?.locked) {
      await logEvent(sb, {
        event_type: "claim_locked", user_id: userId, license_code: code,
        ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
        decision: "block", reason: "code_locked", meta: lock.data,
      });
      return new Response(JSON.stringify({ ok: false, error: "Code locked. Try later.", locked_until: lock.data.locked_until }), { status: 429, headers });
    }

    // 2) Rate limits: user 5/10min, ip 20/10min, device 10/10min, code 5/10min
    const rlUser = await sb.rpc("security_rate_limit_hit", { p_bucket_key: `claim:user:${userId}`, p_window_seconds: 600, p_max_count: 5, p_block_seconds: 900 });
    const rlIp   = await sb.rpc("security_rate_limit_hit", { p_bucket_key: `claim:ip:${ipHash}`, p_window_seconds: 600, p_max_count: 20, p_block_seconds: 900 });
    const rlDev  = await sb.rpc("security_rate_limit_hit", { p_bucket_key: `claim:dev:${deviceHash}`, p_window_seconds: 600, p_max_count: 10, p_block_seconds: 900 });
    const rlCode = await sb.rpc("security_rate_limit_hit", { p_bucket_key: `claim:code:${code}`, p_window_seconds: 600, p_max_count: 5, p_block_seconds: 1800 });

    for (const [name, r] of [["user", rlUser], ["ip", rlIp], ["dev", rlDev], ["code", rlCode]] as const) {
      if (r.error) throw r.error;
      if (!r.data?.allow) {
        await logEvent(sb, {
          event_type: "rate_limited", user_id: userId, license_code: code,
          ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
          decision: "block", reason: `rate_limited:${name}`, meta: r.data,
        });
        return new Response(JSON.stringify({ ok: false, error: "Too many attempts. Try later.", blocked_until: r.data.blocked_until }), { status: 429, headers });
      }
    }

    // 3) Device binding
    await upsertDeviceBinding(sb, userId, deviceHash);

    await logEvent(sb, {
      event_type: "claim_attempt", user_id: userId, license_code: code,
      ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash, decision: "allow",
    });

    // 4) CLAIM: fetch code row from license_claim_codes
    const claimRow = await sb
      .from("license_claim_codes")
      .select("code, seat_id, claimed_at, expires_at")
      .eq("code", code)
      .maybeSingle();

    if (claimRow.error || !claimRow.data) {
      await sb.rpc("note_code_failure", { p_code: code, p_max_fail: 5, p_lock_seconds: 1800 });
      await logEvent(sb, {
        event_type: "claim_failed", user_id: userId, license_code: code,
        ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
        decision: "block", reason: "code_not_found",
      });
      return new Response(JSON.stringify({ ok: false, error: "Invalid code" }), { status: 400, headers });
    }

    if (claimRow.data.claimed_at) {
      await logEvent(sb, {
        event_type: "claim_failed", user_id: userId, license_code: code,
        ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
        decision: "block", reason: "already_claimed", meta: { seat_id: claimRow.data.seat_id },
      });
      return new Response(JSON.stringify({ ok: false, error: "Code already claimed" }), { status: 409, headers });
    }

    if (claimRow.data.expires_at && new Date(claimRow.data.expires_at).getTime() < Date.now()) {
      await sb.rpc("note_code_failure", { p_code: code, p_max_fail: 5, p_lock_seconds: 1800 });
      await logEvent(sb, {
        event_type: "claim_failed", user_id: userId, license_code: code,
        ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
        decision: "block", reason: "expired", meta: { expires_at: claimRow.data.expires_at },
      });
      return new Response(JSON.stringify({ ok: false, error: "Code expired" }), { status: 400, headers });
    }

    // Atomic claim: only if claimed_at is still null
    const upd = await sb
      .from("license_claim_codes")
      .update({ claimed_at: new Date().toISOString(), claimed_by_user_id: userId })
      .eq("code", code)
      .is("claimed_at", null)
      .select("seat_id")
      .single();

    if (upd.error) {
      await logEvent(sb, {
        event_type: "claim_failed", user_id: userId, license_code: code,
        ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
        decision: "review", reason: "race_or_update_failed", meta: { error: upd.error.message },
      });
      return new Response(JSON.stringify({ ok: false, error: "Claim failed. Try again." }), { status: 409, headers });
    }

    const seatId = upd.data.seat_id;

    // Best effort: bind seat to learner
    await tryBindSeat(sb, seatId, userId);

    await logEvent(sb, {
      event_type: "claim_success", user_id: userId, license_code: code,
      seat_id: seatId, ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
      decision: "allow", reason: "claimed",
    });

    return new Response(JSON.stringify({ ok: true, seat_id: seatId }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[claim-license-secure] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function logEvent(sb: ReturnType<typeof createClient>, e: Record<string, unknown>) {
  await sb.from("security_events").insert(e);
}

async function upsertDeviceBinding(sb: ReturnType<typeof createClient>, userId: string, deviceHash: string) {
  const r = await sb.from("user_device_bindings").select("id, seen_count").eq("user_id", userId).eq("device_hash", deviceHash).maybeSingle();
  if (r.error) return;
  if (!r.data) {
    await sb.from("user_device_bindings").insert({ user_id: userId, device_hash: deviceHash });
    return;
  }
  await sb.from("user_device_bindings").update({
    last_seen_at: new Date().toISOString(),
    seen_count: Number(r.data.seen_count ?? 0) + 1,
  }).eq("id", r.data.id);
}

async function tryBindSeat(sb: ReturnType<typeof createClient>, seatId: string, userId: string) {
  const candidates = ["license_seats", "license_package_seats", "seats"];
  for (const t of candidates) {
    const exists = await sb.rpc("table_exists", { p_table: t }).catch(() => null);
    if (exists?.data !== true) continue;

    const upd = await sb.from(t).update({ learner_user_id: userId }).eq("id", seatId).is("learner_user_id", null).select("id").maybeSingle();
    if (!upd.error) {
      await sb.from("security_events").insert({
        event_type: "seat_bound", user_id: userId, seat_id: seatId,
        decision: "allow", reason: `seat_bound:${t}`,
      });
      return;
    }
  }
}
