import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * LTI Login Initiation (OIDC Third-Party Initiated Login)
 *
 * Receives the platform's login-init request, resolves the registration,
 * and builds the OIDC auth redirect URL.
 *
 * Query params (per LTI 1.3 spec):
 *   iss, login_hint, target_link_uri, client_id (optional), lti_message_hint (optional),
 *   lti_deployment_id (optional)
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const params =
      req.method === "POST"
        ? Object.fromEntries((await req.formData()).entries())
        : Object.fromEntries(url.searchParams.entries());

    const iss = String(params.iss ?? "");
    const loginHint = String(params.login_hint ?? "");
    const targetLinkUri = String(params.target_link_uri ?? "");
    const clientId = String(params.client_id ?? "");
    const ltiDeploymentId = String(params.lti_deployment_id ?? "");
    const ltiMessageHint = String(params.lti_message_hint ?? "");

    // ── Validate required params ─────────────────────────────
    if (!iss || !loginHint || !targetLinkUri) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameters: iss, login_hint, target_link_uri",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Resolve platform registration ────────────────────────
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find registration by issuer (+ optional client_id)
    let query = sb
      .from("lti_platform_registrations")
      .select("id, client_id, auth_login_url, keyset_url, status")
      .eq("issuer", iss)
      .eq("status", "active");

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    const { data: registrations, error: regError } = await query.limit(1);

    if (regError || !registrations?.length) {
      console.error("LTI login-init: unknown platform", { iss, clientId, error: regError });
      return new Response(
        JSON.stringify({ error: "Unknown or inactive LTI platform" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const reg = registrations[0];

    // ── Build OIDC Auth Request ──────────────────────────────
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();

    // In production, state+nonce would be persisted for validation on callback.
    // TODO: Persist state+nonce to a short-lived store (e.g., lti_login_state table or KV)

    const launchUrl = Deno.env.get("SUPABASE_URL")! + "/functions/v1/lti-launch";

    const authParams = new URLSearchParams({
      scope: "openid",
      response_type: "id_token",
      response_mode: "form_post",
      prompt: "none",
      client_id: reg.client_id,
      redirect_uri: launchUrl,
      login_hint: loginHint,
      state,
      nonce,
    });

    if (ltiMessageHint) {
      authParams.set("lti_message_hint", ltiMessageHint);
    }
    if (ltiDeploymentId) {
      authParams.set("lti_deployment_id", ltiDeploymentId);
    }

    const redirectUrl = `${reg.auth_login_url}?${authParams.toString()}`;

    console.log("LTI login-init: redirecting", {
      iss,
      clientId: reg.client_id,
      redirectUrl: redirectUrl.substring(0, 120) + "...",
    });

    // Return redirect (302) to platform's auth endpoint
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: redirectUrl,
      },
    });
  } catch (err) {
    console.error("LTI login-init error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error during LTI login initiation" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
