/**
 * validator-bypass.ts — Generic fingerprint-based validator bypass pattern.
 *
 * Reusable for any pipeline validator step that supports artifact fingerprinting.
 * First consumer: validate_handbook_depth (Pattern A).
 * Future consumers: validate_lesson_minichecks (Pattern E), validate_tutor_index, etc.
 *
 * Usage:
 *   const result = await checkValidatorBypass(sb, { packageId, stepKey, curriculumId, validatorVersion });
 *   if (result.eligible) { markStepDone(...); return bypassResponse(result); }
 *   // else: run full validation
 */

const VALIDATOR_VERSION = "v1";

type SB = any;

export interface BypassCheckArgs {
  packageId: string;
  stepKey: string;
  curriculumId: string;
  validatorVersion?: string;
  /** Override fingerprint computation — if not provided, uses step-specific DB function */
  fingerprintFn?: "fn_compute_handbook_depth_fingerprint";
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
}

/**
 * Check if a validator step can be bypassed via fingerprint matching.
 *
 * Flow:
 * 1. Compute current artifact fingerprint from SSOT data
 * 2. Compare against last successful validation's fingerprint in package_steps.meta
 * 3. Check guard conditions (no active jobs, no dirty flags, version match)
 */
export async function checkValidatorBypass(
  sb: SB,
  args: BypassCheckArgs,
): Promise<BypassResult> {
  const version = args.validatorVersion ?? VALIDATOR_VERSION;
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

    // 2. Check bypass eligibility via generic DB function
    const { data: eligibility, error: elErr } = await sb.rpc("fn_is_step_bypass_eligible", {
      p_package_id: args.packageId,
      p_step_key: args.stepKey,
      p_current_fingerprint: currentFp,
      p_validator_version: version,
    });

    if (elErr) {
      return { eligible: false, reason: `eligibility_check_error: ${elErr.message}` };
    }

    return {
      eligible: eligibility?.eligible === true,
      reason: eligibility?.reason ?? "unknown",
      fingerprint: currentFp,
      chapterCount: fpData.chapter_count,
      totalSections: fpData.total_sections,
      expandedSections: fpData.expanded_sections,
      sourcePackageId: eligibility?.source_package_id,
      validatorVersion: version,
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
    bypassed_at: new Date().toISOString(),
    chapter_count: result.chapterCount,
    section_count: result.totalSections,
    expanded_sections: result.expandedSections,
    ...(extra ?? {}),
  };
}

/**
 * Build full-run meta to store after a successful full validation.
 * This primes the bypass for the next run.
 */
export function buildFullRunMeta(
  fingerprint: string,
  validatorVersion: string,
  metrics: Record<string, unknown>,
): Record<string, unknown> {
  return {
    validation_passed: true,
    bypass_eligible: true,
    artifact_fingerprint: fingerprint,
    validator_version: validatorVersion,
    validated_at: new Date().toISOString(),
    bypassed: false,
    ...metrics,
  };
}
