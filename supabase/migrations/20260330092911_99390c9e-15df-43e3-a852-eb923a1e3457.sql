-- Fix schema drift: add missing entitlement columns + RPC that block all workers

-- 1. Add missing boolean columns to entitlements
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS has_learning_course boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_exam_trainer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_ai_tutor boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_oral_trainer boolean DEFAULT false;

-- 2. Backfill existing rows to true (all current entitlements assumed full-access)
UPDATE public.entitlements
SET has_learning_course = true,
    has_exam_trainer = true,
    has_ai_tutor = true,
    has_oral_trainer = true
WHERE has_learning_course = false;

-- 3. Create missing RPC check_user_entitlement
CREATE OR REPLACE FUNCTION public.check_user_entitlement(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_feature text DEFAULT 'any'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.entitlements
    WHERE user_id = p_user_id
      AND curriculum_id = p_curriculum_id
      AND valid_from <= now()
      AND valid_until > now()
      AND (
        p_feature = 'any'
        OR (p_feature = 'learning_course' AND has_learning_course)
        OR (p_feature = 'exam_trainer' AND has_exam_trainer)
        OR (p_feature = 'ai_tutor' AND has_ai_tutor)
        OR (p_feature = 'oral_trainer' AND has_oral_trainer)
      )
  );
$$;

-- 4. Reset schema_version_ledger to force re-verification on next run
UPDATE public.schema_version_ledger
SET verified_ok = false,
    last_verified_at = '2000-01-01T00:00:00Z',
    verified_cycle = null;

-- 5. Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';