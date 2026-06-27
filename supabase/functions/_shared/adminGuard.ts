/**
 * Shared admin guard for Edge Functions.
 * Validates JWT + checks user_roles for admin role.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export { corsHeaders };

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

export interface AdminContext {
  userId: string;
  sb: ReturnType<typeof createClient>;
}

/**
 * Validates Bearer JWT, resolves user, checks admin role.
 * Returns AdminContext on success or a Response (401/403) on failure.
 * The returned `sb` uses SUPABASE_SERVICE_ROLE_KEY for privileged queries.
 */
export async function requireAdmin(
  req: Request,
): Promise<AdminContext | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify JWT via anon client (works on all SDK versions)
  const anonSb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId: string | null = null;
  try {
    const { data, error } = await anonSb.auth.getUser(token);
    if (error || !data?.user?.id) {
      return json({ error: "Unauthorized" }, 401);
    }
    userId = data.user.id;
  } catch (_e) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Check admin role using service client
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: roles } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");

  if (!roles || roles.length === 0) {
    return json({ error: "Admin access required" }, 403);
  }

  return { userId, sb };
}
