-- 1) Tighten audit contract
UPDATE public.ops_audit_contract
SET required_keys = ARRAY['reason','job_type','pending_count','cap','scope','cap_key']
WHERE action_type = 'job_queue_insert_suppressed_fanout_cap';

-- 2) Rewrite guard to use fn_emit_audit + trigger_source
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
  _bp_id text;
  _origin text;
  _enq_src text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  _pkg_id := NEW.payload->>'package_id';
  IF _pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  _lf_filter := NULLIF(NEW.payload->>'learning_field_filter','');
  _bp_id     := NULLIF(NEW.payload->>'blueprint_id','');
  _origin    := NULLIF(NEW.payload->>'_origin','');
  _enq_src   := NULLIF(NEW.payload->>'enqueue_source','');

  IF _lf_filter IS NOT NULL THEN
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
    -- SSOT
    PERFORM public.fn_log_guardrail_event(
      'fanout_cap_blocked',
      jsonb_build_object(
        'package_id', _pkg_id, 'job_type', NEW.job_type,
        'pending_count', _pending_count, 'cap', _cap,
        'scope', _scope, 'learning_field_id', _lf_filter,
        'cap_key', _cap_key, 'blueprint_id', _bp_id,
        'origin', _origin, 'enqueue_source', _enq_src
      )
    );
    -- Audit mirror via central emitter (best-effort)
    BEGIN
      PERFORM public.fn_emit_audit(
        'job_queue_insert_suppressed_fanout_cap',
        'package',
        _pkg_id,
        'skipped',
        jsonb_build_object(
          'reason',            'FANOUT_CAP_REACHED',
          'job_type',          NEW.job_type,
          'pending_count',     _pending_count,
          'cap',               _cap,
          'scope',             _scope,
          'cap_key',           _cap_key,
          'attempted_status',  NEW.status,
          'learning_field_id', _lf_filter,
          'blueprint_id',      _bp_id,
          'origin',            _origin,
          'enqueue_source',    _enq_src,
          'mirror_of',         'ops_guardrail_events.fanout_cap_blocked'
        ),
        'fn_enforce_global_fanout_cap',
        NULL
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) Audit deployment
SELECT public.fn_emit_audit(
  'fanout_cap_audit_enrichment_deployed',
  'system',
  'fn_enforce_global_fanout_cap',
  'success',
  jsonb_build_object(
    'version', 'v2',
    'changes', jsonb_build_array(
      'switched_to_fn_emit_audit',
      'added_trigger_source',
      'tightened_required_keys'
    ),
    'required_keys', ARRAY['reason','job_type','pending_count','cap','scope','cap_key']
  ),
  'migration',
  NULL
);