/**
 * validator-bypass.ts — Generic fingerprint-based validator bypass pattern (v2 hardened).
 *
 * Reusable for any pipeline validator step that supports artifact fingerprinting.
 * Consumers: validate_handbook_depth (Pattern A), validate_lesson_minichecks (Pattern E).
 *
 * Usage:
 *   const result = await checkValidatorBypass(sb, { packageId, stepKey, curriculumId, validatorVersion });
 *   if (result.eligible) { markStepDone(...); return bypassResponse(result); }
 *   // else: run full validation
 */

const FINGERPRINT_VERSION = "v1";
const VALIDATOR_VERSION = "v1";

type SB = any;

export interface BypassCheckArgs {
  packageId: string;
  stepKey: string;
  curriculumId: string;
  validatorVersion?: string;
  fingerprintVersion?: string;
  /** Override fingerprint computation — step-specific DB function */
  fingerprintFn?: "fn_compute_handbook_depth_fingerprint" | "fn_compute_minicheck_fingerprint";
}

export interface BypassResult {
  eligible: boolean;
  reason: string;
  fingerprint?: string;
  chapterCount?: number;
  totalSections?: number;
  expandedSections?: number;
  sourcePackageId?: string;
  validatorVersion?: string;
  fingerprintVersion?: string;
  // minicheck-specific
  approvedCount?: number;
  totalCount?: number;
  trapCount?: number;
}

/**
 * Check if a validator step can be bypassed via fingerprint matching.
 */
export async function checkValidatorBypass(
  sb: SB,
  args: BypassCheckArgs,
): Promise<BypassResult> {
  const version = args.validatorVersion ?? VALIDATOR_VERSION;
  const fpVersion = args.fingerprintVersion ?? FINGERPRINT_VERSION;
  const fpFn = args.fingerprintFn ?? "fn_compute_handbook_depth_fingerprint";

  try {
    // 1. Compute current fingerprint
    const { data: fpData, error: fpErr } = await sb.rpc(fpFn, {
      p_curriculum_id: args.curriculumId,
    });

    if (fpErr || !fpData?.fingerprint) {
      return {
        eligible: false,
        reason: fpErr ? `fingerprint_error: ${fpErr.message}` : "no_fingerprint_data",
      };
    }

    const currentFp = fpData.fingerprint as string;

    // 2. Check bypass eligibility via hardened DB function (v2 with fingerprint_version)
    const { data: eligibility, error: elErr } = await sb.rpc("fn_is_step_bypass_eligible", {
      p_package_id: args.packageId,
      p_step_key: args.stepKey,
      p_current_fingerprint: currentFp,
      p_validator_version: version,
      p_fingerprint_version: fpVersion,
    });

    if (elErr) {
      return { eligible: false, reason: `eligibility_check_error: ${elErr.message}` };
    }

    return {
      eligible: eligibility?.eligible === true,
      reason: eligibility?.reason ?? "unknown",
      fingerprint: currentFp,
      // handbook-specific
      chapterCount: fpData.chapter_count,
      totalSections: fpData.total_sections,
      expandedSections: fpData.expanded_sections,
      // minicheck-specific
      approvedCount: fpData.approved_count,
      totalCount: fpData.total_count,
      trapCount: fpData.trap_count,
      // versioning
      sourcePackageId: eligibility?.source_package_id,
      validatorVersion: version,
      fingerprintVersion: fpVersion,
    };
  } catch (err: any) {
    console.error(`[validator-bypass] Error checking bypass for ${args.stepKey}:`, err);
    return { eligible: false, reason: `exception: ${err.message}` };
  }
}

/**
 * Build bypass meta to store in package_steps.meta when a step is bypassed.
 */
export function buildBypassMeta(result: BypassResult, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    validation_passed: true,
    bypassed: true,
    bypass_reason: result.reason,
    bypass_eligible: true,
    artifact_fingerprint: result.fingerprint,
    reused_from_package_id: result.sourcePackageId,
    validator_version: result.validatorVersion,
    fingerprint_version: result.fingerprintVersion,
    bypassed_at: new Date().toISOString(),
    chapter_count: result.chapterCount,
    section_count: result.totalSections,
    expanded_sections: result.expandedSections,
    approved_count: result.approvedCount,
    total_count: result.totalCount,
    trap_count: result.trapCount,
    ...(extra ?? {}),
  };
}

/**
 * Build full-run meta to store after a successful full validation.
 * This primes the bypass for the next run.
 *
 * CRITICAL: Only call this when validation actually PASSED (depthPass/gatePassed).
 * Calling with a failed validation would incorrectly prime the next bypass.
 */
export function buildFullRunMeta(
  fingerprint: string,
  validatorVersion: string,
  metrics: Record<string, unknown>,
  fingerprintVersion: string = FINGERPRINT_VERSION,
): Record<string, unknown> {
  return {
    validation_passed: true,
    bypass_eligible: true,
    artifact_fingerprint: fingerprint,
    validator_version: validatorVersion,
    fingerprint_version: fingerprintVersion,
    validated_at: new Date().toISOString(),
    bypassed: false,
    ...metrics,
  };
}

/**
 * Build meta for a failed full validation run.
 * Does NOT prime bypass — next run must do full validation.
 */
export function buildFailedRunMeta(
  fingerprint: string | undefined,
  validatorVersion: string,
  metrics: Record<string, unknown>,
  failureReason: string,
  fingerprintVersion: string = FINGERPRINT_VERSION,
): Record<string, unknown> {
  return {
    validation_passed: false,
    bypass_eligible: false,
    artifact_fingerprint: fingerprint,
    validator_version: validatorVersion,
    fingerprint_version: fingerprintVersion,
    validated_at: new Date().toISOString(),
    bypassed: false,
    failure_reason: failureReason,
    ...metrics,
  };
}
