
-- Fix all public functions missing SET search_path

ALTER FUNCTION public.auto_set_track_defaults()
  SET search_path = public;

ALTER FUNCTION public.calculate_authority_index(numeric, numeric, numeric, numeric, numeric, numeric, numeric)
  SET search_path = public;

ALTER FUNCTION public.derive_feature_flags(product_track, certification_type)
  SET search_path = public;

ALTER FUNCTION public.evaluate_portfolio_health()
  SET search_path = public;

ALTER FUNCTION public.get_ship_level(numeric)
  SET search_path = public;

ALTER FUNCTION public.get_track_pipeline_steps(uuid)
  SET search_path = public;

ALTER FUNCTION public.get_track_summary()
  SET search_path = public;

ALTER FUNCTION public.promote_to_authority(uuid, text)
  SET search_path = public;
