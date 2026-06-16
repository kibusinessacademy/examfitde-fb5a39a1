CREATE OR REPLACE FUNCTION public.fn_guard_publish_requires_fanout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _legacy bool;
  _has_catalog bool;
  _has_pillar bool;
  _has_product bool;
  _missing text[];
BEGIN
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  _legacy := COALESCE((NEW.feature_flags->>'publish_legacy_grandfathered')::bool, false);
  IF _legacy THEN
    RETURN NEW;
  END IF;

  _has_catalog := NEW.certification_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.certification_catalog cc WHERE cc.id = NEW.certification_id);
  _has_pillar  := EXISTS(SELECT 1 FROM public.blog_articles ba WHERE ba.source_package_id = NEW.id AND ba.article_type='pillar_guide');
  _has_product := EXISTS(SELECT 1 FROM public.products p WHERE p.curriculum_id = NEW.curriculum_id AND p.status='active' AND p.visibility='public');

  _missing := ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT _has_catalog THEN 'catalog_entry' END,
    CASE WHEN NOT _has_pillar  THEN 'pillar_article' END,
    CASE WHEN NOT _has_product THEN 'active_public_product' END
  ], NULL);

  IF array_length(_missing, 1) > 0 THEN
    PERFORM public.fn_emit_audit(
      _action_type   => 'publish_fanout_completeness_check',
      _target_type   => 'course_package',
      _target_id     => NEW.id::text,
      _result_status => 'blocked',
      _payload       => jsonb_build_object(
        'package_id', NEW.id,
        'package_key', NEW.package_key,
        'missing_components', to_jsonb(_missing),
        'decision', 'blocked'
      ),
      _trigger_source => 'fn_guard_publish_requires_fanout'
    );
    RAISE EXCEPTION 'PUBLISH_FANOUT_INCOMPLETE: package % missing %', NEW.package_key, _missing
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;