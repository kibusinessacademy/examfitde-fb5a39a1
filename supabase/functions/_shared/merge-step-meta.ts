/**
 * merge-step-meta.ts — Atomic meta-merge helper for package_steps
 *
 * Uses DB-side `merge_package_step_meta` RPC to atomically merge
 * JSONB patches via `coalesce(meta,'{}'::jsonb) || patch`.
 *
 * This prevents read-modify-write race conditions when multiple
 * concurrent processes (watchdogs, validators, healers, reconcilers)
 * update the same step's meta simultaneously.
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
  const { error } = await sb.rpc("merge_package_step_meta", {
    p_package_id: packageId,
    p_step_key: stepKey,
    p_patch: patch,
  });

  if (error) throw error;
}

/**
 * Remove specific keys from package_steps.meta atomically.
 * Used to clear block states, temporary flags, etc.
 */
export async function removePackageStepMetaKeys(
  sb: any,
  packageId: string,
  stepKey: string,
  keys: string[],
): Promise<void> {
  const { error } = await sb.rpc("remove_package_step_meta_keys", {
    p_package_id: packageId,
    p_step_key: stepKey,
    p_keys: keys,
  });

  if (error) throw error;
}
