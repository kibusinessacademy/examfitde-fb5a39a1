CREATE OR REPLACE FUNCTION public.fn_guard_blocked_requires_reason()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  allowed_reasons text[] := ARRAY[
    'admin_hold',
    'content_gap',
    'manual_review_required',
    'compliance_hold',
    'pipeline_repair_required',
    'awaiting_source_data',
    'intentional_pause',
    'missing_exam_pool',
    'missing_handbook',
    'auto_heal_zombie',
    'governance_backfill_unknown',
    'quality_no_progress_3x'
  ];
BEGIN
  IF NEW.status = 'blocked' THEN
    IF NEW.blocked_reason IS NULL OR trim(NEW.blocked_reason) = '' THEN
      RAISE EXCEPTION 'SSOT violation: status=blocked requires non-empty blocked_reason';
    END IF;
    IF NOT (NEW.blocked_reason = ANY(allowed_reasons) OR NEW.blocked_reason LIKE 'other:%') THEN
      RAISE EXCEPTION 'SSOT violation: blocked_reason "%" is not in the allowed taxonomy. Use one of: %, or prefix with "other:"',
        NEW.blocked_reason, array_to_string(allowed_reasons, ', ');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;