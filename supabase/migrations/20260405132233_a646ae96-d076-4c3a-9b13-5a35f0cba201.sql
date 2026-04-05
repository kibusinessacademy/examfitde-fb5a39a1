
-- 1. Drop the old 4-param overload to prevent ambiguous RPC resolution
DROP FUNCTION IF EXISTS public.fn_is_step_bypass_eligible(uuid, text, text, text);

-- 2. The 5-param version (with p_fingerprint_version) remains as the sole signature.
-- Verify it exists:
-- fn_is_step_bypass_eligible(p_package_id uuid, p_step_key text, p_current_fingerprint text, p_validator_version text, p_fingerprint_version text DEFAULT 'v1')
