/**
 * merge-step-meta.ts — Safe meta-merge helper for package_steps
 *
 * Prevents accidental data loss by always reading existing meta
 * before writing. Use this instead of raw `.update({ meta: ... })`.
 *
 * The DB trigger `trg_guard_package_step_meta_contract` is the last
 * line of defense, but this helper avoids the issue at source.
 */

export async function mergePackageStepMeta(
  sb: any,
  packageId: string,
  stepKey: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data: step } = await sb
    .from("package_steps")
    .select("meta")
    .eq("package_id", packageId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const oldMeta = (step?.meta ?? {}) as Record<string, unknown>;
  const merged = { ...oldMeta, ...patch };

  const { error } = await sb
    .from("package_steps")
    .update({ meta: merged })
    .eq("package_id", packageId)
    .eq("step_key", stepKey);

  if (error) throw error;
}
