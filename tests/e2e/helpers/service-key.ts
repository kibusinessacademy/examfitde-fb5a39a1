/**
 * Resolve the Supabase service-role key from several allowed env names.
 *
 * Lovable reserves the `SUPABASE_*` secret prefix in its sandbox, so we
 * accept aliases (`SRK_E2E`, `SR_KEY`, `SUPABASE_SR_KEY`) for sandbox/CI
 * runs while keeping `SUPABASE_SERVICE_ROLE_KEY` as the canonical name.
 *
 * Returns "" when no key is set so callers can `test.skip(!SERVICE, …)`.
 */
export const SERVICE_KEY: string =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SR_KEY ||
  process.env.SRK_E2E ||
  process.env.SR_KEY ||
  "";

export const SUPABASE_URL: string =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";
