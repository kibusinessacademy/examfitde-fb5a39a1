import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonSb = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonSb.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(url, serviceKey);
    const body = await req.json();
    const { org_id, connection_id, action } = body as {
      org_id: string;
      connection_id?: string;
      action: "save" | "test";
    };

    if (!org_id) return json({ error: "org_id required" }, 400);

    // Check org access
    const { data: membership } = await sb
      .from("org_memberships")
      .select("role")
      .eq("org_id", org_id)
      .eq("user_id", user.id)
      .in("role", ["OWNER", "ADMIN", "IT_ADMIN"])
      .eq("status", "active")
      .maybeSingle();

    if (!membership) return json({ error: "Org access denied" }, 403);

    if (action === "save") {
      return await handleSave(sb, org_id, user.id, body);
    } else if (action === "test") {
      return await handleTest(sb, org_id, user.id, connection_id!, body);
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});

async function handleSave(sb: any, org_id: string, userId: string, body: any) {
  const { provider, config, domain, auto_provision, auto_assign_seat, default_role, role_mapping } = body;

  if (!provider || !config) return json({ error: "provider and config required" }, 400);

  const { data, error } = await sb
    .from("sso_connections")
    .upsert(
      {
        org_id,
        provider,
        config,
        domain: domain || null,
        auto_provision: auto_provision ?? false,
        auto_assign_seat: auto_assign_seat ?? false,
        default_role: default_role || "LEARNER",
        role_mapping: role_mapping || {},
        status: "configured",
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,provider" }
    )
    .select("id")
    .single();

  if (error) {
    // If conflict resolution fails, try insert
    const { data: inserted, error: insertErr } = await sb
      .from("sso_connections")
      .insert({
        org_id,
        provider,
        config,
        domain: domain || null,
        auto_provision: auto_provision ?? false,
        auto_assign_seat: auto_assign_seat ?? false,
        default_role: default_role || "LEARNER",
        role_mapping: role_mapping || {},
        status: "configured",
        created_by: userId,
      })
      .select("id")
      .single();

    if (insertErr) return json({ error: insertErr.message }, 500);

    await sb.from("org_audit_events").insert({
      org_id,
      actor_user_id: userId,
      event_type: "sso_connection_saved",
      entity_type: "sso_connection",
      entity_id: inserted!.id,
      metadata: { provider },
    });

    return json({ success: true, connection_id: inserted!.id });
  }

  await sb.from("org_audit_events").insert({
    org_id,
    actor_user_id: userId,
    event_type: "sso_connection_saved",
    entity_type: "sso_connection",
    entity_id: data!.id,
    metadata: { provider },
  });

  return json({ success: true, connection_id: data!.id });
}

async function handleTest(sb: any, org_id: string, userId: string, connectionId: string, _body: any) {
  // Fetch connection
  const { data: conn, error } = await sb
    .from("sso_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("org_id", org_id)
    .single();

  if (error || !conn) return json({ error: "Connection not found" }, 404);

  const config = conn.config as Record<string, any>;
  const provider = conn.provider;
  const warnings: string[] = [];
  const errors: string[] = [];
  let normalizedConfig: Record<string, any> = {};
  let discoveredEndpoints: Record<string, string> = {};

  if (provider === "oidc" || provider === "azure_ad" || provider === "okta" || provider === "google") {
    // OIDC test
    const issuer = config.issuer_url || config.issuer;
    if (!issuer) {
      errors.push("Issuer URL fehlt");
    } else {
      try {
        const discoveryUrl = issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
        const resp = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10000) });

        if (!resp.ok) {
          errors.push(`Discovery Endpoint nicht erreichbar (HTTP ${resp.status})`);
        } else {
          const disc = await resp.json();

          if (!disc.authorization_endpoint) {
            errors.push("authorization_endpoint fehlt im Discovery-Dokument");
          } else {
            discoveredEndpoints.authorization_endpoint = disc.authorization_endpoint;
          }

          if (!disc.token_endpoint) {
            errors.push("token_endpoint fehlt im Discovery-Dokument");
          } else {
            discoveredEndpoints.token_endpoint = disc.token_endpoint;
          }

          if (!disc.jwks_uri) {
            warnings.push("jwks_uri fehlt — Token-Validierung eingeschränkt");
          } else {
            discoveredEndpoints.jwks_uri = disc.jwks_uri;

            // Verify JWKS is reachable
            try {
              const jwksResp = await fetch(disc.jwks_uri, { signal: AbortSignal.timeout(5000) });
              if (!jwksResp.ok) {
                warnings.push(`JWKS Endpoint erreichbar aber HTTP ${jwksResp.status}`);
              }
              await jwksResp.text();
            } catch {
              warnings.push("JWKS Endpoint nicht erreichbar");
            }
          }

          if (disc.userinfo_endpoint) {
            discoveredEndpoints.userinfo_endpoint = disc.userinfo_endpoint;
          }

          normalizedConfig = {
            issuer: disc.issuer,
            authorization_endpoint: disc.authorization_endpoint,
            token_endpoint: disc.token_endpoint,
            jwks_uri: disc.jwks_uri,
            userinfo_endpoint: disc.userinfo_endpoint,
            scopes_supported: disc.scopes_supported,
          };

          if (!config.client_id) {
            warnings.push("Client ID nicht konfiguriert");
          }
        }
      } catch (err: any) {
        errors.push(`Discovery fehlgeschlagen: ${err.message}`);
      }
    }
  } else if (provider === "saml") {
    // SAML test
    const metadataUrl = config.metadata_url;
    const metadataXml = config.metadata_xml;

    if (!metadataUrl && !metadataXml) {
      errors.push("Metadata URL oder Metadata XML erforderlich");
    } else {
      let xml = metadataXml;
      if (metadataUrl && !xml) {
        try {
          const resp = await fetch(metadataUrl, { signal: AbortSignal.timeout(10000) });
          if (!resp.ok) {
            errors.push(`Metadata URL nicht erreichbar (HTTP ${resp.status})`);
          } else {
            xml = await resp.text();
          }
        } catch (err: any) {
          errors.push(`Metadata Download fehlgeschlagen: ${err.message}`);
        }
      }

      if (xml) {
        // Basic XML validation
        if (!xml.includes("EntityDescriptor")) {
          errors.push("EntityDescriptor nicht im Metadata gefunden");
        } else {
          // Extract entity ID
          const entityMatch = xml.match(/entityID="([^"]+)"/);
          if (entityMatch) {
            normalizedConfig.entity_id = entityMatch[1];
          } else {
            errors.push("entityID nicht gefunden");
          }

          // Check SSO URL
          const ssoMatch = xml.match(/Location="(https?:\/\/[^"]+)"/);
          if (ssoMatch) {
            normalizedConfig.sso_url = ssoMatch[1];
            discoveredEndpoints.sso_url = ssoMatch[1];
          } else {
            errors.push("SSO Location URL nicht gefunden");
          }

          // Check certificate
          if (xml.includes("X509Certificate")) {
            normalizedConfig.has_certificate = true;
          } else {
            warnings.push("Kein X509Certificate im Metadata gefunden");
          }

          // Check NameIDFormat
          const nameIdMatch = xml.match(/<NameIDFormat>([^<]+)<\/NameIDFormat>/);
          if (nameIdMatch) {
            normalizedConfig.name_id_format = nameIdMatch[1];
          }
        }
      }
    }
  } else {
    errors.push(`Unbekannter Provider-Typ: ${provider}`);
  }

  const success = errors.length === 0;
  const testStatus = success ? "success" : "failed";

  // Update connection
  await sb.from("sso_connections").update({
    last_test_at: new Date().toISOString(),
    last_test_result: { success, warnings, errors, normalized_config: normalizedConfig, discovered_endpoints: discoveredEndpoints },
    last_test_status: testStatus,
    last_error: errors.length > 0 ? errors[0] : null,
    updated_at: new Date().toISOString(),
  }).eq("id", connectionId);

  // Audit
  await sb.from("org_audit_events").insert({
    org_id,
    actor_user_id: userId,
    event_type: success ? "sso_connection_tested" : "sso_connection_failed",
    entity_type: "sso_connection",
    entity_id: connectionId,
    metadata: { provider, success, error_count: errors.length, warning_count: warnings.length },
  });

  return json({
    success,
    warnings,
    errors,
    normalized_config: normalizedConfig,
    discovered_endpoints: discoveredEndpoints,
  });
}
