import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/scim+json" },
  });
}

function scimError(detail: string, status: number) {
  return json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    detail,
    status,
  }, status);
}

async function authenticateScimToken(sb: ReturnType<typeof createClient>, authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");

  // Find active token by checking hash
  const { data: tokens } = await sb
    .from("scim_tokens")
    .select("id, org_id")
    .eq("is_active", true);

  if (!tokens) return null;

  // For simplicity, we store token_hash as the raw hash for comparison
  // In production, use bcrypt comparison
  for (const t of tokens) {
    // Simple token check - compare SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    const { data: match } = await sb
      .from("scim_tokens")
      .select("id, org_id")
      .eq("id", t.id)
      .eq("token_hash", hashHex)
      .eq("is_active", true)
      .maybeSingle();

    if (match) {
      // Update last_used_at
      await sb.from("scim_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", match.id);
      return { org_id: match.org_id, token_id: match.id };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, serviceKey);

  const auth = await authenticateScimToken(sb, req.headers.get("Authorization"));
  if (!auth) return scimError("Unauthorized", 401);

  const { org_id } = auth;
  const reqUrl = new URL(req.url);
  const pathParts = reqUrl.pathname.split("/").filter(Boolean);

  // Route: /scim-v2/Users or /scim-v2/Users/{id}
  const usersIdx = pathParts.indexOf("Users");
  if (usersIdx === -1) return scimError("Unknown endpoint", 404);

  const userId = pathParts[usersIdx + 1] || null;

  try {
    if (req.method === "GET" && !userId) {
      return await listUsers(sb, org_id, reqUrl);
    } else if (req.method === "GET" && userId) {
      return await getUser(sb, org_id, userId);
    } else if (req.method === "POST" && !userId) {
      return await createUser(sb, org_id, await req.json());
    } else if (req.method === "PATCH" && userId) {
      return await patchUser(sb, org_id, userId, await req.json());
    } else if (req.method === "DELETE" && userId) {
      return await deleteUser(sb, org_id, userId);
    }
    return scimError("Method not allowed", 405);
  } catch (err: any) {
    return scimError(err.message, 500);
  }
});

async function listUsers(sb: any, org_id: string, reqUrl: URL) {
  const startIndex = parseInt(reqUrl.searchParams.get("startIndex") || "1");
  const count = Math.min(parseInt(reqUrl.searchParams.get("count") || "100"), 200);
  const filter = reqUrl.searchParams.get("filter");

  let query = sb
    .from("org_memberships")
    .select("user_id, role, status, external_id, profiles!inner(id, full_name, email)", { count: "exact" })
    .eq("org_id", org_id)
    .range(startIndex - 1, startIndex - 1 + count - 1);

  // Basic filter support: userName eq "email@test.com"
  if (filter) {
    const match = filter.match(/userName\s+eq\s+"([^"]+)"/);
    if (match) {
      query = query.eq("profiles.email", match[1]);
    }
  }

  const { data, count: total, error } = await query;
  if (error) return scimError(error.message, 500);

  return json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total || 0,
    startIndex,
    itemsPerPage: count,
    Resources: (data || []).map((m: any) => toScimUser(m)),
  });
}

async function getUser(sb: any, org_id: string, userId: string) {
  const { data, error } = await sb
    .from("org_memberships")
    .select("user_id, role, status, external_id, profiles!inner(id, full_name, email)")
    .eq("org_id", org_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return scimError(error.message, 500);
  if (!data) return scimError("User not found", 404);
  return json(toScimUser(data));
}

async function createUser(sb: any, org_id: string, body: any) {
  const email = body.userName || body.emails?.[0]?.value;
  if (!email) return scimError("userName required", 400);

  const displayName = body.displayName ||
    [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ") ||
    email.split("@")[0];

  // Check if user exists
  const { data: existing } = await sb
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  let userId: string;

  if (existing) {
    userId = existing.id;
  } else {
    const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });
    if (createErr) return scimError(createErr.message, 409);
    userId = newUser.user!.id;
  }

  // Upsert membership
  const role = body.roles?.[0]?.value?.toUpperCase() || "LEARNER";
  await sb.from("org_memberships").upsert({
    org_id,
    user_id: userId,
    role,
    status: body.active !== false ? "active" : "inactive",
    external_id: body.externalId || null,
  }, { onConflict: "org_id,user_id" });

  // Audit
  await sb.from("org_audit_events").insert({
    org_id,
    event_type: "scim_user_created",
    entity_type: "user",
    entity_id: userId,
    metadata: { email, role },
  });

  const { data: result } = await sb
    .from("org_memberships")
    .select("user_id, role, status, external_id, profiles!inner(id, full_name, email)")
    .eq("org_id", org_id)
    .eq("user_id", userId)
    .single();

  return json(toScimUser(result), 201);
}

async function patchUser(sb: any, org_id: string, userId: string, body: any) {
  const ops = body.Operations || [];

  for (const op of ops) {
    if (op.op === "replace" || op.op === "Replace") {
      const val = op.value || {};
      const updates: Record<string, any> = {};

      if ("active" in val) {
        updates.status = val.active ? "active" : "inactive";

        // If deactivating, release seats
        if (!val.active) {
          await sb
            .from("org_license_seats")
            .update({ released_at: new Date().toISOString() })
            .eq("user_id", userId)
            .is("released_at", null);
        }
      }

      if (val.roles?.[0]?.value) {
        updates.role = val.roles[0].value.toUpperCase();
      }

      if (Object.keys(updates).length > 0) {
        await sb
          .from("org_memberships")
          .update(updates)
          .eq("org_id", org_id)
          .eq("user_id", userId);
      }

      // Update display name
      if (val.displayName || val.name) {
        const name = val.displayName || [val.name?.givenName, val.name?.familyName].filter(Boolean).join(" ");
        if (name) {
          await sb.from("profiles").update({ full_name: name }).eq("id", userId);
        }
      }
    }
  }

  // Audit
  await sb.from("org_audit_events").insert({
    org_id,
    event_type: "scim_user_updated",
    entity_type: "user",
    entity_id: userId,
    metadata: { operations: ops.length },
  });

  return await getUser(sb, org_id, userId);
}

async function deleteUser(sb: any, org_id: string, userId: string) {
  // Deactivate membership
  await sb
    .from("org_memberships")
    .update({ status: "inactive" })
    .eq("org_id", org_id)
    .eq("user_id", userId);

  // Release seats
  await sb
    .from("org_license_seats")
    .update({ released_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("released_at", null);

  // Audit
  await sb.from("org_audit_events").insert({
    org_id,
    event_type: "scim_user_deactivated",
    entity_type: "user",
    entity_id: userId,
    metadata: {},
  });

  return new Response(null, { status: 204, headers: corsHeaders });
}

function toScimUser(m: any) {
  const profile = m.profiles;
  const nameParts = (profile?.full_name || "").split(" ");
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: m.user_id,
    userName: profile?.email || "",
    name: {
      givenName: nameParts[0] || "",
      familyName: nameParts.slice(1).join(" ") || "",
      formatted: profile?.full_name || "",
    },
    displayName: profile?.full_name || "",
    emails: [{ value: profile?.email, primary: true }],
    active: m.status === "active",
    externalId: m.external_id || undefined,
    roles: [{ value: m.role }],
    meta: {
      resourceType: "User",
    },
  };
}
