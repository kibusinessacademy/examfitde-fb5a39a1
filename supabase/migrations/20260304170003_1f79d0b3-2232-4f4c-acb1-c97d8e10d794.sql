
-- Idempotent unique index for safe step upserts during upgrade_to_elite
CREATE UNIQUE INDEX IF NOT EXISTS package_steps_pkg_step_uq
ON public.package_steps (package_id, step_key);
