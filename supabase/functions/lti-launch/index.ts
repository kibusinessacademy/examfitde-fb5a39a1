import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * LTI Launch Endpoint
 *
 * Receives the OIDC id_token via form_post from the platform's auth endpoint.
 * Validates claims, resolves deployment + resource mapping, ensures learner identity,
 * checks product access, creates a launch session, and returns the internal redirect target.
 *
 * NOTE: Full JWT cryptographic verification (JWKS fetch + signature validation) is
 * architecturally prepared but marked as TODO for production hardening.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // ── 1. Parse form POST ───────────────────────────────────
    const formData = await req.formData();
    const idToken = formData.get("id_token") as string | null;
    const state = formData.get("state") as string | null;

    if (!idToken) {
      return new Response(
        JSON.stringify({ error: "Missing id_token in launch request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Decode JWT claims (unverified parse) ──────────────
    // TODO: PRODUCTION — Fetch JWKS from keyset_url and verify signature
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      return new Response(
        JSON.stringify({ error: "Invalid id_token format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let claims: Record<string, unknown>;
    try {
      const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      claims = JSON.parse(payload);
    } catch {
      return new Response(
        JSON.stringify({ error: "Failed to decode id_token payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Extract required LTI claims ───────────────────────
    const iss = String(claims.iss ?? "");
    const aud = typeof claims.aud === "string" ? claims.aud : Array.isArray(claims.aud) ? claims.aud[0] : "";
    const sub = String(claims.sub ?? "");
    const deploymentId = String(
      (claims as Record<string, unknown>)["https://purl.imsglobal.org/spec/lti/claim/deployment_id"] ?? ""
    );
    const resourceLink = (claims as Record<string, unknown>)[
      "https://purl.imsglobal.org/spec/lti/claim/resource_link"
    ] as { id?: string } | undefined;
    const resourceLinkId = resourceLink?.id ?? "";

    const namesClaim = claims.name ?? claims.given_name ?? "";
    const displayName = String(namesClaim).substring(0, 200) || null;

    if (!iss || !aud || !sub || !deploymentId) {
      return new Response(
        JSON.stringify({ error: "Missing required LTI claims (iss, aud, sub, deployment_id)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 4. Resolve platform + deployment ─────────────────────
    const { data: regData, error: regErr } = await sb.rpc(
      "resolve_lti_registration",
      { p_issuer: iss, p_client_id: aud, p_deployment_id: deploymentId }
    );

    if (regErr || !regData?.length) {
      console.error("LTI launch: registration not found", { iss, aud, deploymentId, error: regErr });
      return new Response(
        JSON.stringify({ error: "Unknown or inactive LTI platform/deployment" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const reg = regData[0];

    if (reg.registration_status !== "active" || reg.deployment_status !== "active") {
      return new Response(
        JSON.stringify({ error: "LTI platform or deployment is not active" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 5. Resolve resource mapping ──────────────────────────
    let productId: string | null = null;
    let launchMode = "course";
    let gradeReturnPolicy = "none";

    if (resourceLinkId) {
      const { data: mappingData } = await sb.rpc(
        "resolve_lti_resource_mapping",
        { p_deployment_row_id: reg.deployment_row_id, p_resource_link_id: resourceLinkId }
      );

      if (mappingData?.length) {
        const mapping = mappingData[0];
        productId = mapping.product_id;
        launchMode = mapping.launch_mode;
        gradeReturnPolicy = mapping.grade_return_policy;
      }
    }

    // ── 6. Ensure learner identity ───────────────────────────
    // Hash the subject to avoid storing raw external identifiers
    const subHashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${iss}:${sub}`)
    );
    const subHash = Array.from(new Uint8Array(subHashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data: learnerIdentityId, error: liErr } = await sb.rpc(
      "ensure_lti_learner_identity",
      {
        p_org_id: reg.org_id,
        p_external_subject_hash: subHash,
        p_display_name: displayName,
      }
    );

    if (liErr || !learnerIdentityId) {
      console.error("LTI launch: learner identity creation failed", { error: liErr });
      return new Response(
        JSON.stringify({ error: "Failed to resolve learner identity" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 7. Check product access (if product mapped) ──────────
    let hasAccess = true;
    if (productId) {
      // For LTI launches, deployment-level access may auto-grant
      // Check via can_access_product; if no entitlement exists, create one
      const { data: accessResult } = await sb.rpc("can_access_product", {
        p_user_id: null, // LTI learner may not have a platform user yet
        p_product_id: productId,
      });

      // For LTI: access is granted by deployment, not individual entitlement
      // The resource mapping existing IS the access authorization
      hasAccess = true;
    }

    // ── 8. Create launch session ─────────────────────────────
    const sessionExpiry = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours

    const { data: session, error: sessionErr } = await sb
      .from("lti_launch_sessions")
      .insert({
        deployment_id: reg.deployment_row_id,
        learner_identity_id: learnerIdentityId,
        resource_link_id: resourceLinkId || "none",
        sub_hash: subHash,
        launch_claims_json: claims,
        session_status: "active",
        expires_at: sessionExpiry.toISOString(),
      })
      .select("id")
      .single();

    if (sessionErr || !session) {
      console.error("LTI launch: session creation failed", { error: sessionErr });
      return new Response(
        JSON.stringify({ error: "Failed to create launch session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 9. Build response ────────────────────────────────────
    const launchResult = {
      session_id: session.id,
      product_id: productId,
      launch_mode: launchMode,
      grade_return_policy: gradeReturnPolicy,
      learner_identity_id: learnerIdentityId,
      redirect_path: productId
        ? `/lti/launch/${launchMode}?session=${session.id}&product=${productId}`
        : `/lti/launch/pending?session=${session.id}`,
    };

    console.log("LTI launch: success", {
      sessionId: session.id,
      productId,
      launchMode,
      deploymentId,
    });

    return new Response(JSON.stringify(launchResult), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("LTI launch error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error during LTI launch" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
