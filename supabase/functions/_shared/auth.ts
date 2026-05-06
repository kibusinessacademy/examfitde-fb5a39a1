import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";

// Re-export CORS utilities for backwards compatibility (legacy corsHeaders removed for security)
export { getCorsHeaders, handleCorsPreflightRequest } from "./cors.ts";

export interface AuthResult {
  user: { id: string; email?: string } | null;
  error: string | null;
  isAdmin: boolean;
  isServiceRole: boolean;
}

/**
 * Validates JWT token and optionally checks for admin role.
 * Service Role bypasses have been removed for production security.
 * Internal edge-to-edge calls must use createClient(url, serviceRoleKey) directly.
 */
export async function validateAuth(
  req: Request,
  requireAdmin = false
): Promise<AuthResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Internal edge-to-edge bypass: validated via dedicated shared secret ONLY.
  // The previous service-role-key fallback was removed — if EDGE_INTERNAL_SHARED_SECRET
  // is not configured, internal calls must use createClient(url, serviceRoleKey) directly
  // instead of the x-job-runner-key header.
  const internalSecret = Deno.env.get('EDGE_INTERNAL_SHARED_SECRET');
  const jobRunnerKey = req.headers.get('x-job-runner-key');
  if (jobRunnerKey && internalSecret && jobRunnerKey === internalSecret) {
    return { user: { id: 'job-runner' }, error: null, isAdmin: true, isServiceRole: true };
  }
  // Reject any attempt to pass the service role key as the internal token.
  if (jobRunnerKey && jobRunnerKey === supabaseServiceKey) {
    console.warn('[Auth] BLOCKED: Attempt to use service role key as x-job-runner-key');
    return { user: null, error: 'Invalid internal token', isAdmin: false, isServiceRole: false };
  }

  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing or invalid authorization header', isAdmin: false, isServiceRole: false };
  }

  const token = authHeader.replace('Bearer ', '');

  // SECURITY: Reject if someone tries to use the service role key as a Bearer token
  if (token === supabaseServiceKey) {
    console.warn('[Auth] BLOCKED: Attempt to use service role key as Bearer token');
    return { user: null, error: 'Invalid token', isAdmin: false, isServiceRole: false };
  }

  // Create client with auth header for RLS context
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Validate JWT - MUST pass token explicitly when verify_jwt=false
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { user: null, error: 'Invalid or expired token', isAdmin: false, isServiceRole: false };
  }

  // Check admin role if required
  let isAdmin = false;
  if (requireAdmin) {
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: roles } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    
    isAdmin = !!roles;
    
    if (!isAdmin) {
      return { user, error: 'Admin access required', isAdmin: false, isServiceRole: false };
    }
  }

  return { user: { id: user.id, email: user.email }, error: null, isAdmin, isServiceRole: false };
}

/**
 * Creates unauthorized response with proper CORS headers.
 */
export function unauthorizedResponse(message = 'Unauthorized', origin?: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 401, headers: { ...getCorsHeaders(origin || null), 'Content-Type': 'application/json' } }
  );
}

/**
 * Creates forbidden response with proper CORS headers.
 */
export function forbiddenResponse(message = 'Forbidden', origin?: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 403, headers: { ...getCorsHeaders(origin || null), 'Content-Type': 'application/json' } }
  );
}
