/**
 * Shared prerequisite check for pipeline edge functions.
 *
 * A prerequisite step is considered fulfilled if:
 *  1. It doesn't exist in package_steps (track doesn't include it) → true
 *  2. Its status is 'done' or 'skipped' → true
 *  3. Fallback: check legacy course_package_build_steps table
 *
 * IMPORTANT: This is the SINGLE source of truth. Do NOT copy this function
 * into individual edge functions.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FULFILLED = ["done", "skipped"];

export async function prereqDone(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  stepKey: string,
): Promise<boolean> {
  // Modern table
  const { data: d1 } = await sb
    .from("package_steps")
    .select("status")
    .eq("package_id", packageId)
    .eq("step_key", stepKey)
    .maybeSingle();

  // Step doesn't exist in this package (track doesn't include it) → fulfilled
  if (!d1) return true;
  if (FULFILLED.includes(d1.status)) return true;

  // Fallback: legacy table
  const { data: d2 } = await sb
    .from("course_package_build_steps")
    .select("status")
    .eq("package_id", packageId)
    .eq("step_key", stepKey)
    .maybeSingle();

  return d2?.status ? FULFILLED.includes(d2.status) : false;
}
