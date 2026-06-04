/**
 * Production-ready CORS configuration.
 * Restricts origins to allowed domains only.
 */

// Allowed production domains
const ALLOWED_ORIGINS = [
  'https://berufos.com',
  'https://berufos.com',
  'https://examfitde.lovable.app',
  'https://id-preview--ad51e8f9-6cff-41cf-9723-b4e49dbcd9db.lovable.app',
  'https://ad51e8f9-6cff-41cf-9723-b4e49dbcd9db.lovableproject.com',
];

// Development mode check
const isDevelopment = Deno.env.get('ENVIRONMENT') !== 'production';

/**
 * Get CORS headers for the request origin.
 * In development: allows all origins.
 * In production: restricts to ALLOWED_ORIGINS.
 */
export function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  let allowedOrigin = '';

  if (isDevelopment) {
    // In development, allow all origins for easier testing
    allowedOrigin = requestOrigin || '*';
  } else {
    // In production, only allow specific origins
    if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
      allowedOrigin = requestOrigin;
    } else {
      // Default to main production domain if origin not in list
      allowedOrigin = 'https://berufos.com';
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Handle CORS preflight request.
 */
export function handleCorsPreflightRequest(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('origin');
    return new Response(null, { headers: getCorsHeaders(origin) });
  }
  return null;
}

// Legacy corsHeaders with wildcard origin has been REMOVED for production security.
// All functions must use getCorsHeaders(origin) instead.

/**
 * Convenience: return a JSON Response with CORS headers.
 */
export function json(status: number, data: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
