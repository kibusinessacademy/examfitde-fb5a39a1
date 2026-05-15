
-- 1) Watchlist table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_pillar_retry_watchlist (
  curriculum_id uuid PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'watching'
    CHECK (status IN ('watching','enqueued','timeout','cancelled')),
  last_check_at timestamptz,
  last_reasons jsonb,
  enqueued_job_id uuid,
  enqueued_at timestamptz,
  notes text
);

ALTER TABLE public.seo_pillar_retry_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access seo_pillar_retry_watchlist"
  ON public.seo_pillar_retry_watchlist;
CREATE POLICY "service_role full access seo_pillar_retry_watchlist"
  ON public.seo_pillar_retry_watchlist
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "admin read seo_pillar_retry_watchlist"
  ON public.seo_pillar_retry_watchlist;
CREATE POLICY "admin read seo_pillar_retry_watchlist"
  ON public.seo_pillar_retry_watchlist
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Watcher function ------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_watch_and_enqueue_pillar_retry()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_published_spokes int;
  v_active_jobs int;
  v_recent_failed int;
  v_reasons text[];
  v_idem text;
  v_existing uuid;
  v_new_job_id uuid;
  v_processed int := 0;
  v_enqueued int := 0;
  v_deferred int := 0;
  v_timed_out int := 0;
  v_remaining int := 0;
BEGIN
  FOR r IN
    SELECT curriculum_id, deadline_at
    FROM public.seo_pillar_retry_watchlist
    WHERE status = 'watching'
    ORDER BY added_at
  LOOP
    v_processed := v_processed + 1;
    v_reasons := ARRAY[]::text[];

    -- Gate A: deadline
    IF now() > r.deadline_at THEN
      UPDATE public.seo_pillar_retry_watchlist
        SET status='timeout', last_check_at=now(),
            last_reasons=jsonb_build_object('reason','deadline_exceeded',
              'deadline_at', r.deadline_at)
        WHERE curriculum_id = r.curriculum_id;
      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, result_status, metadata, trigger_source)
      VALUES
        ('pillar_retry_watcher_done','curriculum',r.curriculum_id,'timeout',
         jsonb_build_object('deadline_at', r.deadline_at),
         'fn_watch_and_enqueue_pillar_retry');
      v_timed_out := v_timed_out + 1;
      CONTINUE;
    END IF;

    -- Gate B/C/D: spoke counts
    SELECT count(*) INTO v_published_spokes
      FROM public.seo_content_pages p
      WHERE p.curriculum_id = r.curriculum_id
        AND p.page_type = 'intent_page'
        AND p.status = 'published';

    SELECT count(*) INTO v_active_jobs
      FROM public.job_queue j
      WHERE j.job_type = 'seo_intent_page_generate'
        AND (j.payload->>'curriculum_id')::uuid = r.curriculum_id
        AND j.status IN ('pending','processing','queued');

    SELECT count(*) INTO v_recent_failed
      FROM public.job_queue j
      WHERE j.job_type = 'seo_intent_page_generate'
        AND (j.payload->>'curriculum_id')::uuid = r.curriculum_id
        AND j.status = 'failed'
        AND j.updated_at > now() - interval '15 minutes';

    IF v_published_spokes < 6 THEN v_reasons := array_append(v_reasons,'spokes_missing'); END IF;
    IF v_active_jobs > 0     THEN v_reasons := array_append(v_reasons,'active_jobs_present'); END IF;
    IF v_recent_failed > 0   THEN v_reasons := array_append(v_reasons,'recent_failures'); END IF;

    IF array_length(v_reasons,1) IS NOT NULL THEN
      UPDATE public.seo_pillar_retry_watchlist
        SET last_check_at=now(),
            last_reasons=jsonb_build_object(
              'published_spokes', v_published_spokes,
              'active_spoke_jobs', v_active_jobs,
              'recent_failed_spokes', v_recent_failed,
              'reasons', to_jsonb(v_reasons))
        WHERE curriculum_id = r.curriculum_id;

      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, result_status, metadata, trigger_source)
      VALUES
        ('pillar_retry_deferred','curriculum',r.curriculum_id,'deferred',
         jsonb_build_object(
           'published_spokes', v_published_spokes,
           'active_spoke_jobs', v_active_jobs,
           'recent_failed_spokes', v_recent_failed,
           'reasons', to_jsonb(v_reasons)),
         'fn_watch_and_enqueue_pillar_retry');
      v_deferred := v_deferred + 1;
      CONTINUE;
    END IF;

    -- All gates green → idempotent enqueue
    v_idem := 'pillar_retry|' || r.curriculum_id::text || '|' || to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD');

    SELECT id INTO v_existing
      FROM public.job_queue
      WHERE idempotency_key = v_idem
        AND status IN ('pending','processing')
      LIMIT 1;

    IF v_existing IS NOT NULL THEN
      v_new_job_id := v_existing;
    ELSE
      INSERT INTO public.job_queue
        (job_type, status, priority, lane, worker_pool, payload, idempotency_key, meta, job_name)
      VALUES
        ('seo_pillar_page_generate','pending',8,'control','core',
         jsonb_build_object(
           'curriculum_id', r.curriculum_id,
           'retry', true,
           'source','fn_watch_and_enqueue_pillar_retry'),
         v_idem,
         jsonb_build_object('enqueue_source','pillar_retry_watcher'),
         'seo_pillar_retry')
      RETURNING id INTO v_new_job_id;
    END IF;

    UPDATE public.seo_pillar_retry_watchlist
      SET status='enqueued', last_check_at=now(),
          enqueued_job_id=v_new_job_id, enqueued_at=now(),
          last_reasons=jsonb_build_object(
            'published_spokes', v_published_spokes,
            'active_spoke_jobs', v_active_jobs,
            'recent_failed_spokes', v_recent_failed,
            'idempotency_key', v_idem)
      WHERE curriculum_id = r.curriculum_id;

    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, result_status, metadata, trigger_source)
    VALUES
      ('pillar_retry_enqueued','curriculum',r.curriculum_id,'ok',
       jsonb_build_object(
         'job_id', v_new_job_id,
         'idempotency_key', v_idem,
         'reused', (v_existing IS NOT NULL),
         'published_spokes', v_published_spokes),
       'fn_watch_and_enqueue_pillar_retry');
    v_enqueued := v_enqueued + 1;
  END LOOP;

  SELECT count(*) INTO v_remaining
    FROM public.seo_pillar_retry_watchlist WHERE status='watching';

  RETURN jsonb_build_object(
    'processed', v_processed,
    'enqueued', v_enqueued,
    'deferred', v_deferred,
    'timed_out', v_timed_out,
    'remaining_watching', v_remaining,
    'ran_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.fn_watch_and_enqueue_pillar_retry() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_watch_and_enqueue_pillar_retry() TO service_role;

-- 3) Seed watchlist with current targets ----------------------------
INSERT INTO public.seo_pillar_retry_watchlist (curriculum_id, deadline_at, notes)
VALUES
  ('53d13046-88bf-42bf-9a2e-05d5e4a4f272', now() + interval '60 minutes', 'FISI Systemintegration — pillar smoke retry after spoke backfill'),
  ('055098ff-7cb0-4373-bd87-ff1979afc646', now() + interval '60 minutes', 'Industriekaufmann — pillar smoke retry after spoke backfill')
ON CONFLICT (curriculum_id) DO UPDATE
  SET status = CASE WHEN seo_pillar_retry_watchlist.status IN ('enqueued','timeout','cancelled')
                    THEN 'watching' ELSE seo_pillar_retry_watchlist.status END,
      deadline_at = EXCLUDED.deadline_at,
      enqueued_job_id = NULL,
      enqueued_at = NULL,
      last_check_at = NULL,
      last_reasons = NULL,
      notes = EXCLUDED.notes;

-- 4) Initial smoke run ----------------------------------------------
INSERT INTO public.auto_heal_log
  (action_type, target_type, target_id, result_status, metadata, trigger_source)
VALUES
  ('pillar_retry_watcher_setup','system',NULL,'ok',
   (SELECT public.fn_watch_and_enqueue_pillar_retry()),
   'migration_seo_pillar_retry_watcher');
