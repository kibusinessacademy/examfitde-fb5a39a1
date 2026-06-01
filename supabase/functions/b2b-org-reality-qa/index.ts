// supabase/functions/b2b-org-reality-qa/index.ts
//
// B2B Org Reality QA v1 — Server-side reality check for the Org Console flow.
//
// Builds two synthetic orgs with smoke-tagged users, drives the full B2B
// pipeline (invite → accept → role change → seat assignment), probes RLS
// isolation and last-owner protection, and returns a Reality Report with a
// gate decision (RELEASE / REVIEW / BLOCK).
//
// Cleanup runs at the end of every invocation (or via { cleanup_only: true }).
//
// service-role auth required (Authorization: Bearer SERVICE_KEY).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type FindingStatus = "pass" | "fail" | "skip";
type Severity = "critical" | "ux";

interface Finding {
  code: string;
  status: FindingStatus;
  severity: Severity;
  detail?: string;
}

const FINDING_CODES = {
  ORG_DASHBOARD_NOT_REACHABLE: { severity: "critical" as Severity },
  ORG_INVITE_FAILED: { severity: "critical" as Severity },
  ORG_INVITE_ACCEPT_FAILED: { severity: "critical" as Severity },
  ORG_SEAT_ASSIGNMENT_FAILED: { severity: "critical" as Severity },
  ORG_ROLE_CHANGE_FAILED: { severity: "critical" as Severity },
  ORG_LAST_OWNER_NOT_PROTECTED: { severity: "critical" as Severity },
  ORG_CROSS_ORG_LEAK: { severity: "critical" as Severity },
  ORG_AUDIT_MISSING: { severity: "ux" as Severity },
} as const;

type FindingCode = keyof typeof FINDING_CODES;

function mkFinding(
  code: FindingCode,
  status: FindingStatus,
  detail?: string,
): Finding {
  return { code, status, severity: FINDING_CODES[code].severity, detail };
}

// ---------------------------------------------------------------------------
// Smoke fixture identity (idempotent — same emails across runs)
// ---------------------------------------------------------------------------

const SMOKE_EMAILS = {
  ownerA: "qa+org-a-owner@examfit-smoke.local",
  managerA: "qa+org-a-manager@examfit-smoke.local",
  memberA: "qa+org-a-member@examfit-smoke.local",
  inviteeA: "qa+org-a-invitee@examfit-smoke.local",
  ownerB: "qa+org-b-owner@examfit-smoke.local",
} as const;

const ORG_A_NAME = "QA Reality Org A";
const ORG_B_NAME = "QA Reality Org B";

// ---------------------------------------------------------------------------
// User helpers (service-role only)
// ---------------------------------------------------------------------------

async function ensureUser(sb: SupabaseClient, email: string): Promise<string> {
  // Try lookup first
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
  const found = list?.users.find((u) => u.email === email);
  if (found) return found.id;

  const { data, error } = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID(),
    user_metadata: { qa_reality: true },
  });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  return data.user!.id;
}

async function ensureOrg(sb: SupabaseClient, name: string): Promise<string> {
  const { data: existing } = await sb
    .from("organizations")
    .select("id")
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await sb
    .from("organizations")
    .insert({ name, org_type: "COMPANY", is_active: true })
    .select("id")
    .single();
  if (error) throw new Error(`createOrg(${name}) failed: ${error.message}`);
  return data.id as string;
}

async function ensureMembership(
  sb: SupabaseClient,
  orgId: string,
  userId: string,
  role: "owner" | "admin" | "manager" | "learner",
) {
  const { error } = await sb.from("org_memberships").upsert(
    {
      org_id: orgId,
      user_id: userId,
      role,
      status: "active",
      source_type: "manual",
    },
    { onConflict: "org_id,user_id" },
  );
  if (error) throw new Error(`upsertMembership failed: ${error.message}`);
}

async function ensureLicense(
  sb: SupabaseClient,
  orgId: string,
): Promise<string> {
  // Pick any existing product (we won't grant real course access, only
  // exercise the seat-assignment pipeline).
  const { data: prod } = await sb
    .from("products")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!prod) throw new Error("no active product for license fixture");

  const { data: existing } = await sb
    .from("org_licenses")
    .select("id")
    .eq("org_id", orgId)
    .eq("product_id", prod.id)
    .eq("status", "active")
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await sb
    .from("org_licenses")
    .insert({
      org_id: orgId,
      product_id: prod.id,
      seat_count: 5,
      total_seats: 5,
      status: "active",
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`createLicense failed: ${error.message}`);
  return data.id as string;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup(sb: SupabaseClient) {
  // 1) Hard-cleanup orgs+memberships+licenses via service-role RPC that
  //    bypasses the last-owner trigger (uses session_replication_role=replica).
  const { error: rpcErr } = await sb.rpc("qa_b2b_reality_cleanup");
  if (rpcErr) console.error("[cleanup] qa_b2b_reality_cleanup", rpcErr.message);

  // 2) Delete smoke users — paginate to handle large user tables
  const emails = new Set<string>(Object.values(SMOKE_EMAILS));
  let page = 1;
  // Stop after a hard cap to avoid runaway
  while (page < 50) {
    const { data: list } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (!list?.users?.length) break;
    let matched = 0;
    for (const u of list.users) {
      if (u.email && emails.has(u.email)) {
        await sb.auth.admin.deleteUser(u.id);
        matched++;
      }
    }
    if (list.users.length < 200) break;
    page++;
    // Optimisation: if no matches on a full page, stop early after 3 empty pages
    if (matched === 0 && page > 3) break;
  }
}


// ---------------------------------------------------------------------------
// Per-user JWT helper — sign in as a smoke user via service-role-issued magic
// link is overkill; we use admin generateLink + token verification instead.
// Simpler: create a per-user client using admin.signInWithIdToken? Not
// available.  Use generateLink('magiclink') and exchange token.
// ---------------------------------------------------------------------------

async function clientAsUser(
  sbAdmin: SupabaseClient,
  supabaseUrl: string,
  publishableKey: string,
  userId: string,
): Promise<SupabaseClient | null> {
  // Use admin to mint an access_token by signing a temporary password and
  // logging in with it (works for service-role-created confirmed users).
  const tempPw = `qa-${crypto.randomUUID()}`;
  const { error: updErr } = await sbAdmin.auth.admin.updateUserById(userId, {
    password: tempPw,
  });
  if (updErr) {
    console.error("updateUserById failed", updErr);
    return null;
  }
  const { data: user } = await sbAdmin.auth.admin.getUserById(userId);
  if (!user?.user?.email) return null;
  const anon = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signErr } = await anon.auth.signInWithPassword({
    email: user.user.email,
    password: tempPw,
  });
  if (signErr) {
    console.error("signIn failed for", user.user.email, signErr);
    return null;
  }
  return anon;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runReality(
  sb: SupabaseClient,
  supabaseUrl: string,
  publishableKey: string,
): Promise<{
  findings: Finding[];
  gate: "RELEASE" | "REVIEW" | "BLOCK";
  fixtures: Record<string, string>;
}> {
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  // --- Setup fixtures (idempotent) ---
  const ownerAId = await ensureUser(sb, SMOKE_EMAILS.ownerA);
  const managerAId = await ensureUser(sb, SMOKE_EMAILS.managerA);
  const memberAId = await ensureUser(sb, SMOKE_EMAILS.memberA);
  const inviteeAId = await ensureUser(sb, SMOKE_EMAILS.inviteeA);
  const ownerBId = await ensureUser(sb, SMOKE_EMAILS.ownerB);

  const orgA = await ensureOrg(sb, ORG_A_NAME);
  const orgB = await ensureOrg(sb, ORG_B_NAME);

  await ensureMembership(sb, orgA, ownerAId, "owner");
  await ensureMembership(sb, orgA, managerAId, "manager");
  await ensureMembership(sb, orgA, memberAId, "learner");
  await ensureMembership(sb, orgB, ownerBId, "owner");

  const licenseA = await ensureLicense(sb, orgA);

  const fixtures = {
    org_a: orgA,
    org_b: orgB,
    owner_a: ownerAId,
    manager_a: managerAId,
    member_a: memberAId,
    invitee_a: inviteeAId,
    owner_b: ownerBId,
    license_a: licenseA,
  };

  // --- 1. ORG_DASHBOARD_NOT_REACHABLE — owner_a can list members of Org A ---
  const ownerAClient = await clientAsUser(sb, supabaseUrl, publishableKey, ownerAId);
  if (!ownerAClient) {
    push(mkFinding("ORG_DASHBOARD_NOT_REACHABLE", "fail", "owner_a sign-in failed"));
  } else {
    const { data, error } = await ownerAClient.rpc("list_org_members", {
      p_org_id: orgA,
    });
    if (error || !Array.isArray(data) || data.length === 0) {
      push(mkFinding(
        "ORG_DASHBOARD_NOT_REACHABLE",
        "fail",
        error?.message ?? "list_org_members returned empty",
      ));
    } else {
      push(mkFinding("ORG_DASHBOARD_NOT_REACHABLE", "pass",
        `${data.length} members visible`));
    }
  }

  // --- 2. ORG_CROSS_ORG_LEAK — owner_a must NOT see Org B members ---
  if (ownerAClient) {
    const { data, error } = await ownerAClient.rpc("list_org_members", {
      p_org_id: orgB,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      push(mkFinding(
        "ORG_CROSS_ORG_LEAK",
        "fail",
        `owner_a saw ${data.length} members of Org B`,
      ));
    } else {
      push(mkFinding("ORG_CROSS_ORG_LEAK", "pass",
        `blocked: ${error?.message ?? "empty"}`));
    }
  }

  // --- 3. ORG_INVITE_FAILED — owner_a creates an invite ---
  let inviteToken: string | null = null;
  if (ownerAClient) {
    const { data, error } = await ownerAClient.rpc("create_org_license_invite", {
      p_license_id: licenseA,
      p_org_id: orgA,
      p_email: SMOKE_EMAILS.inviteeA,
      p_role: "learner",
      p_invited_by: ownerAId,
    });
    const ok = !error && data && (data as Record<string, unknown>).ok !== false;
    if (!ok) {
      push(mkFinding(
        "ORG_INVITE_FAILED",
        "fail",
        error?.message ?? JSON.stringify(data),
      ));
    } else {
      push(mkFinding("ORG_INVITE_FAILED", "pass"));
      // pick the token from DB (service role)
      const { data: row } = await sb
        .from("org_license_invites")
        .select("invite_token")
        .eq("license_id", licenseA)
        .eq("email", SMOKE_EMAILS.inviteeA)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      inviteToken = (row?.invite_token as string) ?? null;
    }
  }

  // --- 4. ORG_INVITE_ACCEPT_FAILED — invitee accepts ---
  if (inviteToken) {
    const inviteeClient = await clientAsUser(sb, supabaseUrl, publishableKey, inviteeAId);
    if (!inviteeClient) {
      push(mkFinding("ORG_INVITE_ACCEPT_FAILED", "fail", "invitee sign-in failed"));
    } else {
      const { data, error } = await inviteeClient.rpc("accept_org_license_invite", {
        p_invite_token: inviteToken,
        p_user_id: inviteeAId,
      });
      const ok = !error && data && (data as Record<string, unknown>).ok !== false;
      if (!ok) {
        push(mkFinding(
          "ORG_INVITE_ACCEPT_FAILED",
          "fail",
          error?.message ?? JSON.stringify(data),
        ));
      } else {
        push(mkFinding("ORG_INVITE_ACCEPT_FAILED", "pass"));
      }
    }
  } else {
    push(mkFinding("ORG_INVITE_ACCEPT_FAILED", "skip", "no invite token"));
  }

  // --- 5. ORG_SEAT_ASSIGNMENT_FAILED — assign seat to member_a ---
  {
    const { data, error } = await sb.rpc("assign_org_license_seat", {
      p_license_id: licenseA,
      p_user_id: memberAId,
      p_assigned_by: ownerAId,
    });
    const ok = !error && data && (data as Record<string, unknown>).ok !== false;
    if (!ok) {
      push(mkFinding(
        "ORG_SEAT_ASSIGNMENT_FAILED",
        "fail",
        error?.message ?? JSON.stringify(data),
      ));
    } else {
      push(mkFinding("ORG_SEAT_ASSIGNMENT_FAILED", "pass"));
    }
  }

  // --- 6. ORG_ROLE_CHANGE_FAILED — owner_a promotes manager_a to admin ---
  if (ownerAClient) {
    const { data, error } = await ownerAClient.rpc("update_org_member_role", {
      p_org_id: orgA,
      p_user_id: managerAId,
      p_new_role: "admin",
    });
    const ok = !error && data && (data as Record<string, unknown>).ok !== false;
    if (!ok) {
      push(mkFinding(
        "ORG_ROLE_CHANGE_FAILED",
        "fail",
        error?.message ?? JSON.stringify(data),
      ));
    } else {
      push(mkFinding("ORG_ROLE_CHANGE_FAILED", "pass"));
    }
  }

  // --- 7. ORG_LAST_OWNER_NOT_PROTECTED — two layers:
  //   (a) RPC must reject demoting the only owner
  //   (b) Direct UPDATE on org_memberships must raise (trigger)
  {
    // (a) via RPC as owner_b on org_b (only one owner)
    const ownerBClient = await clientAsUser(sb, supabaseUrl, publishableKey, ownerBId);
    let rpcBlocked = false;
    let rpcDiag = "";
    if (ownerBClient) {
      const { data, error } = await ownerBClient.rpc("update_org_member_role", {
        p_org_id: orgB,
        p_user_id: ownerBId,
        p_new_role: "admin",
      });
      const obj = data as Record<string, unknown> | null;
      rpcBlocked = !!obj && obj.ok === false && obj.error === "CANNOT_REMOVE_LAST_OWNER";
      rpcDiag = error ? `err=${error.message}` : `data=${JSON.stringify(obj)}`;
    } else {
      rpcDiag = "ownerB_signin_failed";
    }

    // (b) via raw service-role UPDATE — trigger must raise
    let triggerBlocked = false;
    const { error: trigErr } = await sb
      .from("org_memberships")
      .update({ role: "admin" })
      .eq("org_id", orgB)
      .eq("user_id", ownerBId);
    const trigDiag = trigErr ? trigErr.message : "no_error";
    if (trigErr && /CANNOT_REMOVE_LAST_OWNER|check_violation/i.test(trigErr.message)) {
      triggerBlocked = true;
    }

    if (rpcBlocked && triggerBlocked) {
      push(mkFinding("ORG_LAST_OWNER_NOT_PROTECTED", "pass",
        "rpc+trigger both blocked"));
    } else {
      push(mkFinding(
        "ORG_LAST_OWNER_NOT_PROTECTED",
        "fail",
        `rpc=${rpcBlocked} (${rpcDiag}) | trigger=${triggerBlocked} (${trigDiag})`,
      ));
    }
  }

  // --- 8. ORG_AUDIT_MISSING — check audit row for role change ---
  {
    const { data, error } = await sb
      .from("auto_heal_log")
      .select("id, action_type, metadata")
      .eq("action_type", "org_member_role_changed")
      .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(5);
    if (error || !data || data.length === 0) {
      push(mkFinding(
        "ORG_AUDIT_MISSING",
        "fail",
        error?.message ?? "no role-change audit in last 5min",
      ));
    } else {
      push(mkFinding("ORG_AUDIT_MISSING", "pass",
        `${data.length} audit rows`));
    }
  }


  // --- Gate decision ---
  const failedCrit = findings.some(
    (f) => f.status === "fail" && f.severity === "critical",
  );
  const failedUx = findings.some(
    (f) => f.status === "fail" && f.severity === "ux",
  );
  const gate: "RELEASE" | "REVIEW" | "BLOCK" = failedCrit
    ? "BLOCK"
    : failedUx
    ? "REVIEW"
    : "RELEASE";

  // Emit per-finding audit (best-effort)
  for (const f of findings) {
    try {
      await sb.rpc("fn_emit_audit", {
        _target_type: "org_reality_qa",
        _action_type: "org_reality_qa_finding",
        _target_id: f.code,
        _result_status: f.status === "pass" ? "ok" : f.status === "fail" ? "failed" : "skipped",
        _payload: { finding_code: f.code, status: f.status, severity: f.severity, detail: f.detail ?? null },
        _trigger_source: "b2b-org-reality-qa",
        _error_message: null,
      });
    } catch (_) {
      /* ignore */
    }
  }
  // Emit run-level audit
  try {
    await sb.rpc("fn_emit_audit", {
      _target_type: "org_reality_qa",
      _action_type: "org_reality_qa_run",
      _target_id: null,
      _result_status: gate === "RELEASE" ? "ok" : gate === "REVIEW" ? "warn" : "failed",
      _payload: {
        gate_decision: gate,
        findings_count: findings.length,
        failed: findings.filter((f) => f.status === "fail").length,
        passed: findings.filter((f) => f.status === "pass").length,
      },
      _trigger_source: "b2b-org-reality-qa",
      _error_message: null,
    });
  } catch (_) {
    /* ignore */
  }

  return { findings, gate, fixtures };
}

// ---------------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Require service-role caller
  const auth = req.headers.get("Authorization") || "";
  if (!auth.includes(SERVICE_KEY)) {
    return new Response(
      JSON.stringify({ ok: false, error: "SERVICE_ROLE_REQUIRED" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const cleanupOnly = body.cleanup_only === true;
  const skipCleanup = body.skip_cleanup === true;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (cleanupOnly) {
      await cleanup(sb);
      return new Response(
        JSON.stringify({ ok: true, cleaned: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Always start with a clean slate to keep runs idempotent
    await cleanup(sb);

    const result = await runReality(sb, SUPABASE_URL, ANON_KEY);

    if (!skipCleanup) {
      await cleanup(sb);
    }

    return new Response(
      JSON.stringify({
        ok: result.gate !== "BLOCK",
        gate: result.gate,
        findings: result.findings,
        summary: {
          total: result.findings.length,
          passed: result.findings.filter((f) => f.status === "pass").length,
          failed: result.findings.filter((f) => f.status === "fail").length,
          skipped: result.findings.filter((f) => f.status === "skip").length,
        },
      }),
      {
        status: result.gate === "BLOCK" ? 422 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[b2b-org-reality-qa] fatal", err);
    return new Response(
      JSON.stringify({
        ok: false,
        gate: "BLOCK",
        error: String(err instanceof Error ? err.message : err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
