-- E.3: Fanout-Cap LF-aware (job_queue Guard Audit-Mirror Pattern v1)
-- Concern: Trigger-Logik. Kein UI/View/Cron-Touch.
-- Rollback: Wiederherstellen der Pre-LF Variante (siehe pg_get_functiondef in Memory).

CREATE OR REPLACE FUNCTION public.fn_enforce_global_fanout_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _pkg_id text;
  _lf_filter text;
  _scope text;
  _cap_key text;
  _pending_count int;
  _cap int := 3;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  _pkg_id := NEW.payload->>'package_id';
  IF _pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  _lf_filter := NULLIF(NEW.payload->>'learning_field_filter','');

  IF _lf_filter IS NOT NULL THEN
    -- LF-scoped Cap: pro (package, job_type, lf)
    _scope   := 'learning_field';
    _cap_key := _pkg_id || '|' || NEW.job_type || '|' || _lf_filter;

    SELECT count(*) INTO _pending_count
      FROM public.job_queue
     WHERE payload->>'package_id' = _pkg_id
       AND job_type = NEW.job_type
       AND payload->>'learning_field_filter' = _lf_filter
       AND status IN ('pending','processing')
       AND id <> NEW.id;
  ELSE
    -- Bestehendes globales Verhalten (paket-weit)
    _scope   := 'package';
    _cap_key := _pkg_id || '|' || NEW.job_type;

    SELECT count(*) INTO _pending_count
      FROM public.job_queue
     WHERE payload->>'package_id' = _pkg_id
       AND job_type = NEW.job_type
       AND status IN ('pending','processing')
       AND id <> NEW.id;
  END IF;

  IF _pending_count >= _cap THEN
    PERFORM public.fn_log_guardrail_event(
      'fanout_cap_blocked',
      jsonb_build_object(
        'package_id',         _pkg_id,
        'job_type',           NEW.job_type,
        'pending_count',      _pending_count,
        'cap',                _cap,
        'scope',              _scope,
        'learning_field_id',  _lf_filter,
        'cap_key',            _cap_key
      )
    );
    BEGIN
      INSERT INTO public.auto_heal_log(
        action_type, target_type, target_id, result_status, metadata
      )
      VALUES (
        'job_queue_insert_suppressed_fanout_cap',
        'package',
        _pkg_id,
        'skipped',
        jsonb_build_object(
          'reason',            'FANOUT_CAP_REACHED',
          'job_type',          NEW.job_type,
          'pending_count',     _pending_count,
          'cap',               _cap,
          'attempted_status',  NEW.status,
          'scope',             _scope,
          'learning_field_id', _lf_filter,
          'cap_key',           _cap_key
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- Smoke-Audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES (
  'fanout_cap_lf_aware_deployed',
  'system',
  'success',
  jsonb_build_object(
    'version','E.3',
    'cap',3,
    'lf_scope_active',true,
    'fallback_global','package'
  )
);