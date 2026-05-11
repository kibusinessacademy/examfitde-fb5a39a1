
-- Table
CREATE TABLE IF NOT EXISTS public.admin_growth_bulk_loop_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  loop_limit int NOT NULL DEFAULT 10 CHECK (loop_limit BETWEEN 1 AND 50),
  subscores text[] NOT NULL DEFAULT ARRAY['blog_quality','seo_meta','internal_links','cta','funnel_events','email_sequence','distribution','og_image']::text[],
  time_window_hours int NOT NULL DEFAULT 24 CHECK (time_window_hours BETWEEN 1 AND 168),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_growth_bulk_loop_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_self_select" ON public.admin_growth_bulk_loop_config;
CREATE POLICY "admin_self_select" ON public.admin_growth_bulk_loop_config
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "admin_self_upsert" ON public.admin_growth_bulk_loop_config;
CREATE POLICY "admin_self_upsert" ON public.admin_growth_bulk_loop_config
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "admin_self_update" ON public.admin_growth_bulk_loop_config;
CREATE POLICY "admin_self_update" ON public.admin_growth_bulk_loop_config
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (user_id = auth.uid() AND public.has_role(auth.uid(),'admin'));

-- Get RPC
CREATE OR REPLACE FUNCTION public.admin_get_growth_bulk_loop_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row admin_growth_bulk_loop_config%ROWTYPE;
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  SELECT * INTO v_row FROM public.admin_growth_bulk_loop_config WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'loop_limit', 10,
      'subscores', ARRAY['blog_quality','seo_meta','internal_links','cta','funnel_events','email_sequence','distribution','og_image']::text[],
      'time_window_hours', 24,
      'updated_at', null,
      'is_default', true
    );
  END IF;
  RETURN jsonb_build_object(
    'loop_limit', v_row.loop_limit,
    'subscores', v_row.subscores,
    'time_window_hours', v_row.time_window_hours,
    'updated_at', v_row.updated_at,
    'is_default', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_growth_bulk_loop_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_bulk_loop_config() TO authenticated;

-- Save RPC
CREATE OR REPLACE FUNCTION public.admin_save_growth_bulk_loop_config(
  p_loop_limit int,
  p_subscores text[],
  p_time_window_hours int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed text[] := ARRAY['blog_quality','seo_meta','internal_links','cta','funnel_events','email_sequence','distribution','og_image'];
  v_invalid text[];
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  IF p_loop_limit IS NULL OR p_loop_limit < 1 OR p_loop_limit > 50 THEN
    RAISE EXCEPTION 'invalid_loop_limit (1..50)';
  END IF;
  IF p_time_window_hours IS NULL OR p_time_window_hours < 1 OR p_time_window_hours > 168 THEN
    RAISE EXCEPTION 'invalid_time_window_hours (1..168)';
  END IF;
  IF p_subscores IS NULL OR array_length(p_subscores,1) IS NULL THEN
    RAISE EXCEPTION 'subscores_empty';
  END IF;
  SELECT array_agg(s) INTO v_invalid
  FROM unnest(p_subscores) s WHERE s <> ALL(v_allowed);
  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_subscores: %', v_invalid;
  END IF;

  INSERT INTO public.admin_growth_bulk_loop_config(user_id, loop_limit, subscores, time_window_hours, updated_at)
  VALUES (v_uid, p_loop_limit, p_subscores, p_time_window_hours, now())
  ON CONFLICT (user_id) DO UPDATE
    SET loop_limit = EXCLUDED.loop_limit,
        subscores = EXCLUDED.subscores,
        time_window_hours = EXCLUDED.time_window_hours,
        updated_at = now();

  RETURN jsonb_build_object('saved', true, 'updated_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_growth_bulk_loop_config(int,text[],int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_growth_bulk_loop_config(int,text[],int) TO authenticated;
