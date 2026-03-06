/**
 * Domain Error System – Client-side parser.
 * Mirrors the server-side DomainErrorCode taxonomy.
 */

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

export interface ParsedDomainError {
  code: DomainErrorCode;
  message: string;
  details?: Record<string, unknown>;
  status?: number;
}

export function isDomainErrorPayload(value: unknown): value is {
  ok: false;
  error: { code: DomainErrorCode; message: string; details?: Record<string, unknown> };
} {
  if (!value || typeof value !== "object") return false;
  const v = value as any;
  return v.ok === false && v.error && typeof v.error.code === "string";
}

/**
 * Attempts to extract a structured DomainError from various error shapes
 * returned by supabase.functions.invoke or thrown by mutation handlers.
 */
export function parseDomainError(error: any): ParsedDomainError | null {
  // Direct payload (e.g. error.context from FunctionsHttpError)
  const candidates: unknown[] = [
    error?.context,
    error?.details,
    error?.response,
    error?.data,
    error,
  ];

  for (const candidate of candidates) {
    if (isDomainErrorPayload(candidate)) {
      return {
        code: candidate.error.code,
        message: candidate.error.message,
        details: candidate.error.details,
        status: error?.status,
      };
    }
  }

  // Try parsing stringified JSON in error.message
  const message = error?.message;
  if (typeof message === "string") {
    try {
      const parsed = JSON.parse(message);
      if (isDomainErrorPayload(parsed)) {
        return {
          code: parsed.error.code,
          message: parsed.error.message,
          details: parsed.error.details,
          status: error?.status,
        };
      }
    } catch {
      // not JSON – ignore
    }
  }

  return null;
}
