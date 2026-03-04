
-- Fix 1: Disable aspirational trigger bindings that have no function yet
UPDATE public.expected_trigger_bindings
SET enabled = false
WHERE expected_trigger IN (
  'trg_curriculum_freeze_guard',
  'trg_package_steps_sort_order_guard',
  'trg_blueprint_approval_guard'
);

-- Fix 2: Grant execute on check_trigger_bindings to service_role so nightly guards can call it
GRANT EXECUTE ON FUNCTION public.check_trigger_bindings() TO service_role;
