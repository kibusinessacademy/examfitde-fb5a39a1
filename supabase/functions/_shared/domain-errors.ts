/**
 * Domain Error System – Server-side helpers for Edge Functions.
 * All Edge Functions MUST use jsonOk / jsonDomainError for responses.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export type DomainErrorCode =
  | "ACTIVE_PACKAGE_EXISTS"
  | "PACKAGE_ALREADY_PUBLISHED"
  | "PACKAGE_NOT_BUILDABLE"
  | "PACKAGE_NOT_FOUND"
  | "STEP_ALREADY_RUNNING"
  | "STEP_NOT_FOUND"
  | "STEP_DEPENDENCY_MISSING"
  | "BLUEPRINT_NOT_APPROVED"
  | "EXAM_POOL_INCOMPLETE"
  | "INTEGRITY_CHECK_FAILED"
  | "INVALID_TRACK"
  | "CURRICULUM_NOT_FOUND"
  | "CERTIFICATION_NOT_FOUND"
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface DomainErrorPayload {
  ok: false;
  error: {
    code: DomainErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface DomainSuccessPayload<T> {
  ok: true;
  data: T;
}

export function jsonOk<T>(data: T, status = 200): Response {
  return new Response(
    JSON.stringify({ ok: true, data } as DomainSuccessPayload<T>),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

export function jsonDomainError(
  code: DomainErrorCode,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message, details },
    } as DomainErrorPayload),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
