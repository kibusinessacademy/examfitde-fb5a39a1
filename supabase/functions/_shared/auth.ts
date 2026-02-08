import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

export interface AuthResult {
  user: { id: string; email?: string } | null;
  error: string | null;
  isAdmin: boolean;
}

/**
 * Validates JWT token and optionally checks for admin role.
 * Required for Lovable Cloud which uses ES256 tokens (verify_jwt=false in config).
 */
export async function validateAuth(
  req: Request,
  requireAdmin = false
): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing or invalid authorization header', isAdmin: false };
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Create client with auth header for RLS context
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Validate JWT - MUST pass token explicitly when verify_jwt=false
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { user: null, error: 'Invalid or expired token', isAdmin: false };
  }

  // Check admin role if required
  let isAdmin = false;
  if (requireAdmin) {
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: roles } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    
    isAdmin = !!roles;
    
    if (!isAdmin) {
      return { user, error: 'Admin access required', isAdmin: false };
    }
  }

  return { user: { id: user.id, email: user.email }, error: null, isAdmin };
}

/**
 * Creates unauthorized response with proper CORS headers.
 */
export function unauthorizedResponse(message = 'Unauthorized'): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Creates forbidden response with proper CORS headers.
 */
export function forbiddenResponse(message = 'Forbidden'): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
