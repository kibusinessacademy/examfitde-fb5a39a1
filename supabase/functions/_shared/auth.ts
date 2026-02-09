import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "./cors.ts";

// Re-export CORS utilities for backwards compatibility
export { getCorsHeaders, handleCorsPreflightRequest, corsHeaders } from "./cors.ts";

export interface AuthResult {
  user: { id: string; email?: string } | null;
  error: string | null;
  isAdmin: boolean;
  isServiceRole: boolean;
}

/**
 * Validates JWT token and optionally checks for admin role.
 * Also accepts Service Role Key for internal/automated calls.
 * Required for Lovable Cloud which uses ES256 tokens (verify_jwt=false in config).
 */
export async function validateAuth(
  req: Request,
  requireAdmin = false
): Promise<AuthResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // FIRST: Check x-service-role header for internal/automated calls (no Bearer required)
  const serviceRoleHeader = req.headers.get('x-service-role');
  if (serviceRoleHeader && serviceRoleHeader === supabaseServiceKey) {
    console.log('[Auth] Service role via x-service-role header - bypassing user check');
    return { 
      user: { id: 'service-role', email: 'system@internal' }, 
      error: null, 
      isAdmin: true, 
      isServiceRole: true 
    };
  }

  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing or invalid authorization header', isAdmin: false, isServiceRole: false };
  }

  const token = authHeader.replace('Bearer ', '');

  // Check if Bearer token IS the service role key
  if (token === supabaseServiceKey) {
    console.log('[Auth] Service role authentication via Bearer - bypassing user check');
    return { 
      user: { id: 'service-role', email: 'system@internal' }, 
      error: null, 
      isAdmin: true, 
      isServiceRole: true 
    };
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
