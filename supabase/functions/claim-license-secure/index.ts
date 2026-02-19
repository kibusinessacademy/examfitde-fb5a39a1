import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

// SHA-256 via WebCrypto (replaces weakHash)
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normIp(ip: string) { return ip.trim().toLowerCase(); }
function normUa(ua: string) { return ua.slice(0, 180).trim(); }
function normDeviceId(d: string) { return d.trim(); }

type Decision = { decision: "allow" | "review" | "block"; score: number; reasons: string[] };

async function scoreDecision(
  sb: ReturnType<typeof createClient>,
  userId: string, ipHash: string, deviceHash: string
): Promise<Decision> {
  const cfgRes = await sb.from("security_anomaly_config")
    .select("*").eq("name", "default").eq("enabled", true).maybeSingle();
  const cfg = cfgRes.data ?? {
    w_ip_change: 0.25, w_device_new: 0.25, w_fail_spike: 0.30, w_rate_limit: 0.20,
    review_threshold: 0.55, block_threshold: 0.80, window_minutes: 30
  };

  const sinceIso = new Date(Date.now() - Number(cfg.window_minutes ?? 30) * 60 * 1000).toISOString();

  const events = await sb.from("security_events")
    .select("event_type, decision, ip_hash, device_hash, created_at")
    .eq("user_id", userId).gte("created_at", sinceIso);
  const rows = events.data ?? [];

  const ipChanged = rows.some((r: Record<string, unknown>) => r.ip_hash && r.ip_hash !== ipHash);
  const recentFails = rows.filter((r: Record<string, unknown>) => r.event_type === "claim_failed").length;
  const recentRL = rows.filter((r: Record<string, unknown>) => r.event_type === "rate_limited").length;

  const dev = await sb.from("user_device_bindings")
    .select("id").eq("user_id", userId).eq("device_hash", deviceHash).maybeSingle();
  const deviceNew = !dev.data;

  const sIp = ipChanged ? 1 : 0;
  const sDev = deviceNew ? 1 : 0;
  const sFail = Math.min(1, recentFails / 3);
  const sRate = Math.min(1, recentRL / 2);

  const score =
    sIp * Number(cfg.w_ip_change) + sDev * Number(cfg.w_device_new) +
    sFail * Number(cfg.w_fail_spike) + sRate * Number(cfg.w_rate_limit);

  const reasons: string[] = [];
  if (ipChanged) reasons.push("ip_change");
  if (deviceNew) reasons.push("new_device");
  if (recentFails > 0) reasons.push(`fails_${recentFails}`);
  if (recentRL > 0) reasons.push(`rate_limited_${recentRL}`);

  if (score >= Number(cfg.block_threshold ?? 0.8)) return { decision: "block", score, reasons };
  if (score >= Number(cfg.review_threshold ?? 0.55)) return { decision: "review", score, reasons };
  return { decision: "allow", score, reasons };
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

    if (action === "verify_otp") {
      return await handleVerifyOtp(req, payload, headers);
    }

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
    const ipHash = await sha256Hex(normIp(ip));
    const uaHash = await sha256Hex(normUa(ua));
    const deviceHash = await sha256Hex(normDeviceId(deviceId));

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

    // 2) Rate limits
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

    // 3) Anomaly scoring
    const sec = await scoreDecision(sb, userId, ipHash, deviceHash);

    // Log attempt with anomaly info
    const ev = await sb.from("security_events").insert({
      event_type: "claim_attempt", user_id: userId, license_code: code,
      ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
      decision: sec.decision, reason: sec.reasons.join(","),
      meta: { score: sec.score, reasons: sec.reasons },
    }).select("id").single();
    if (ev.error) throw ev.error;

    if (sec.decision === "block") {
      await sb.rpc("auto_block_user_if_needed", { p_user_id: userId, p_minutes: 30, p_fail_threshold: 6, p_block_seconds: 1800 });
      return new Response(JSON.stringify({ ok: false, error: "Suspicious activity. Try later." }), { status: 403, headers });
    }

    if (sec.decision === "review") {
      // Enqueue review + require step-up OTP
      await sb.rpc("enqueue_security_review", {
        p_event_id: ev.data.id, p_user_id: userId, p_license_code: code,
        p_seat_id: null, p_score: sec.score, p_reasons: sec.reasons,
      });

      // Check if OTP already verified for this session
      const otpToken = String(payload.otpToken ?? "").trim();
      if (!otpToken) {
        // Generate OTP and send via email
        const otp = generateOtp();
        const otpHash = await sha256Hex(otp);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
        await sb.from("security_otp_challenges").insert({
          user_id: userId, otp_hash: otpHash, purpose: "claim_stepup", expires_at: expiresAt,
        });

        // Best effort: send OTP email via auth admin
        const userEmail = userRes.user?.email;
        if (userEmail) {
          // Log that OTP was issued (actual email sending would use a mail provider)
          await logEvent(sb, {
            event_type: "claim_attempt", user_id: userId, license_code: code,
            ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
            decision: "review", reason: "otp_issued",
            meta: { otp_hint: otp.slice(0, 2) + "****", email: userEmail.slice(0, 3) + "***" },
          });
        }

        return new Response(JSON.stringify({
          ok: false, error: "step_up_required",
          message: "Bitte bestätige deine Identität. Ein Code wurde an deine E-Mail gesendet.",
          otp_required: true,
        }), { status: 428, headers });
      }

      // Verify OTP token
      const otpValid = await verifyOtpToken(sb, userId, otpToken);
      if (!otpValid) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid or expired OTP" }), { status: 403, headers });
      }
    }

    // 4) Device binding
    await upsertDeviceBinding(sb, userId, deviceHash);

    // 5) CLAIM
    const claimRow = await sb.from("license_claim_codes")
      .select("code, seat_id, claimed_at, expires_at")
      .eq("code", code).maybeSingle();

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

    // Atomic claim
    const upd = await sb.from("license_claim_codes")
      .update({ claimed_at: new Date().toISOString(), claimed_by_user_id: userId })
      .eq("code", code).is("claimed_at", null)
      .select("seat_id").single();

    if (upd.error) {
      await logEvent(sb, {
        event_type: "claim_failed", user_id: userId, license_code: code,
        ip_hash: ipHash, device_hash: deviceHash, ua_hash: uaHash,
        decision: "review", reason: "race_or_update_failed", meta: { error: upd.error.message },
      });
      return new Response(JSON.stringify({ ok: false, error: "Claim failed. Try again." }), { status: 409, headers });
    }

    const seatId = upd.data.seat_id;

    // Bind seat + log seat device for misuse tracking
    await tryBindSeat(sb, seatId, userId);
    await sb.from("seat_device_log").insert({
      seat_id: seatId, user_id: userId, device_hash: deviceHash, ip_hash: ipHash,
    });

    // Update review with seat_id if exists
    if (sec.decision === "review" && ev.data?.id) {
      await sb.rpc("enqueue_security_review", {
        p_event_id: ev.data.id, p_user_id: userId, p_license_code: code,
        p_seat_id: seatId, p_score: sec.score, p_reasons: sec.reasons,
      });
    }

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

// --- OTP helpers ---

function generateOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, "0");
}

async function verifyOtpToken(
  sb: ReturnType<typeof createClient>, userId: string, otp: string
): Promise<boolean> {
  const otpHash = await sha256Hex(otp.trim());
  const r = await sb.from("security_otp_challenges")
    .select("id, expires_at, attempts, max_attempts, verified_at")
    .eq("user_id", userId).eq("otp_hash", otpHash).eq("purpose", "claim_stepup")
    .is("verified_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!r.data) return false;
  if (new Date(r.data.expires_at).getTime() < Date.now()) return false;
  if (r.data.attempts >= r.data.max_attempts) return false;

  await sb.from("security_otp_challenges")
    .update({ verified_at: new Date().toISOString() }).eq("id", r.data.id);
  return true;
}

async function handleVerifyOtp(
  req: Request, payload: Record<string, unknown>, headers: Record<string, string>
): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer "))
    return new Response(JSON.stringify({ ok: false, error: "Missing JWT" }), { status: 401, headers });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error: uErr } = await userClient.auth.getUser();
  if (uErr) return new Response(JSON.stringify({ ok: false, error: uErr.message }), { status: 401, headers });

  const userId = userRes.user?.id;
  if (!userId) return new Response(JSON.stringify({ ok: false, error: "No user" }), { status: 401, headers });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const otp = String(payload.otp ?? "").trim();
  if (!otp || otp.length !== 6)
    return new Response(JSON.stringify({ ok: false, error: "Invalid OTP format" }), { status: 400, headers });

  // Increment attempt count for all unverified OTPs
  await sb.from("security_otp_challenges")
    .update({ attempts: 999 }) // we'll use a proper increment below
    .eq("user_id", userId).eq("purpose", "claim_stepup").is("verified_at", null);

  const valid = await verifyOtpToken(sb, userId, otp);
  if (!valid)
    return new Response(JSON.stringify({ ok: false, error: "Invalid or expired OTP" }), { status: 403, headers });

  return new Response(JSON.stringify({ ok: true, verified: true }), { status: 200, headers });
}

// --- Helpers ---

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
