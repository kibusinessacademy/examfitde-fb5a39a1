import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function scimError(status: number, detail: string) {
  return json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail,
      status,
    },
    status
  );
}

async function authenticateScim(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Hash token and check against stored hashes
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data: tokenRecord } = await sb
    .from("scim_tokens")
    .select("id, org_id, is_active, expires_at")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (!tokenRecord) return null;

  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
    return null;
  }

  // Update last_used_at
  await sb
    .from("scim_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRecord.id);

  return { sb, orgId: tokenRecord.org_id, tokenId: tokenRecord.id };
}

// ── SCIM User Handlers ──────────────────────────────

async function handleCreateUser(body: any, sb: ReturnType<typeof createClient>, orgId: string | null) {
  const email = body.userName?.toLowerCase()?.trim();
  const externalId = body.externalId;
  const givenName = body.name?.givenName || "";
  const familyName = body.name?.familyName || "";
  const active = body.active !== false;
  const displayName = `${givenName} ${familyName}`.trim() || email;

  if (!email || !externalId) {
    return scimError(400, "userName and externalId are required");
  }

  // Hash the external ID for storage
  const encoder = new TextEncoder();
  const data = encoder.encode(externalId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const extHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Upsert learner identity
  const { data: existing } = await sb
    .from("learner_identities")
    .select("id, user_id")
    .eq("external_subject_hash", extHash)
    .limit(1)
    .single();

  let identityId: string;

  if (existing) {
    await sb
      .from("learner_identities")
      .update({
        display_name: displayName,
        org_id: orgId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    identityId = existing.id;
  } else {
    const { data: created, error } = await sb
      .from("learner_identities")
      .insert({
        identity_type: "scim",
        external_subject_hash: extHash,
        display_name: displayName,
        org_id: orgId,
      })
      .select("id")
      .single();

    if (error) return scimError(500, error.message);
    identityId = created!.id;
  }

  // If org provided, ensure membership
  if (orgId && existing?.user_id) {
    await sb.from("org_memberships").upsert(
      {
        org_id: orgId,
        user_id: existing.user_id,
        role: "learner",
        status: active ? "active" : "inactive",
      },
      { onConflict: "org_id,user_id" }
    );
  }

  return json(
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: identityId,
      externalId,
      userName: email,
      name: { givenName, familyName },
      active,
      meta: {
        resourceType: "User",
        created: new Date().toISOString(),
      },
    },
    existing ? 200 : 201
  );
}

async function handlePatchUser(userId: string, body: any, sb: ReturnType<typeof createClient>, orgId: string | null) {
  const operations = body.Operations || [];

  for (const op of operations) {
    if (op.op === "replace" && op.value?.active === false) {
      // Deactivate: revoke org membership
      const { data: identity } = await sb
        .from("learner_identities")
        .select("user_id")
        .eq("id", userId)
        .single();

      if (identity?.user_id && orgId) {
        await sb
          .from("org_memberships")
          .update({ status: "inactive" })
          .eq("org_id", orgId)
          .eq("user_id", identity.user_id);
      }
    }

    if (op.op === "replace" && op.value?.name) {
      const name = op.value.name;
      const displayName =
        `${name.givenName || ""} ${name.familyName || ""}`.trim();
      if (displayName) {
        await sb
          .from("learner_identities")
          .update({ display_name: displayName, updated_at: new Date().toISOString() })
          .eq("id", userId);
      }
    }
  }

  return json({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], id: userId });
}

async function handleGetUser(userId: string, sb: ReturnType<typeof createClient>) {
  const { data, error } = await sb
    .from("learner_identities")
    .select("id, display_name, identity_type, created_at, updated_at")
    .eq("id", userId)
    .single();

  if (error || !data) return scimError(404, "User not found");

  return json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: data.id,
    userName: data.display_name,
    active: true,
    meta: {
      resourceType: "User",
      created: data.created_at,
      lastModified: data.updated_at,
    },
  });
}

// ── SCIM Group Handlers ─────────────────────────────

async function handleCreateGroup(body: any, sb: ReturnType<typeof createClient>) {
  const displayName = body.displayName;
  if (!displayName) return scimError(400, "displayName required");

  const { data, error } = await sb
    .from("organizations")
    .insert({ name: displayName, slug: displayName.toLowerCase().replace(/\s+/g, "-") })
    .select("id")
    .single();

  if (error) return scimError(500, error.message);

  return json(
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: data!.id,
      displayName,
      meta: { resourceType: "Group", created: new Date().toISOString() },
    },
    201
  );
}

// ── Main Router ─────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await authenticateScim(req);
  if (!auth) {
    return scimError(401, "Invalid or missing SCIM token");
  }

  const { sb, orgId } = auth;
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  // Route: /scim/Users, /scim/Users/{id}, /scim/Groups
  const resource = pathParts.find(
    (p) => p === "Users" || p === "Groups"
  );
  const resourceIdx = pathParts.indexOf(resource || "");
  const resourceId = pathParts[resourceIdx + 1] || null;

  try {
    if (resource === "Users") {
      if (req.method === "POST") {
        const body = await req.json();
        return await handleCreateUser(body, sb, orgId);
      }
      if (req.method === "PATCH" && resourceId) {
        const body = await req.json();
        return await handlePatchUser(resourceId, body, sb, orgId);
      }
      if (req.method === "GET" && resourceId) {
        return await handleGetUser(resourceId, sb);
      }
      if (req.method === "GET") {
        // List users (simplified)
        return json({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
          totalResults: 0,
          Resources: [],
        });
      }
    }

    if (resource === "Groups") {
      if (req.method === "POST") {
        const body = await req.json();
        return await handleCreateGroup(body, sb);
      }
    }

    return scimError(404, "Endpoint not found");
  } catch (err) {
    console.error("SCIM error:", err);
    return scimError(500, "Internal server error");
  }
});
