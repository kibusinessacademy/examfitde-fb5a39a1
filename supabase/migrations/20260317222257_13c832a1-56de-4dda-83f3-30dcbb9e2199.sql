
-- Auto-Escalation Function: checks QC backlog and creates admin notifications
CREATE OR REPLACE FUNCTION ops_escalate_qc_backlog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  escalated int := 0;
  results jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT 
      curriculum_id,
      curriculum_title,
      review_pending,
      review_tier1_passed,
      promotable_drafts,
      total_approved,
      oldest_review_pending_hours,
      backlog_health
    FROM v_ops_qc_backlog
    WHERE backlog_health IN ('CRITICAL', 'WARNING', 'STALE_DRAFTS')
  LOOP
    -- Dedupe: only create notification if no unread one exists for this curriculum
    IF NOT EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE category = 'qc_backlog_slo'
        AND entity_id = r.curriculum_id::text
        AND is_read = false
        AND created_at > now() - interval '6 hours'
    ) THEN
      INSERT INTO admin_notifications (
        title, body, category, severity, entity_type, entity_id, metadata
      ) VALUES (
        CASE r.backlog_health
          WHEN 'CRITICAL' THEN '🔴 QC Backlog CRITICAL: ' || r.curriculum_title
          WHEN 'WARNING' THEN '⚠️ QC Backlog WARNING: ' || r.curriculum_title
          WHEN 'STALE_DRAFTS' THEN '📦 Stale Drafts: ' || r.curriculum_title
        END,
        CASE r.backlog_health
          WHEN 'CRITICAL' THEN r.review_pending || ' Fragen in review/pending, älteste ' || ROUND(COALESCE(r.oldest_review_pending_hours, 0)::numeric, 1) || 'h'
          WHEN 'WARNING' THEN r.review_pending || ' Fragen in review/pending'
          WHEN 'STALE_DRAFTS' THEN r.promotable_drafts || ' promotable Drafts warten auf Review-Promotion'
        END,
        'qc_backlog_slo',
        CASE r.backlog_health
          WHEN 'CRITICAL' THEN 'critical'
          WHEN 'WARNING' THEN 'warning'
          ELSE 'info'
        END,
        'curriculum',
        r.curriculum_id::text,
        jsonb_build_object(
          'review_pending', r.review_pending,
          'review_tier1_passed', r.review_tier1_passed,
          'promotable_drafts', r.promotable_drafts,
          'total_approved', r.total_approved,
          'oldest_hours', ROUND(COALESCE(r.oldest_review_pending_hours, 0)::numeric, 1),
          'backlog_health', r.backlog_health
        )
      );
      escalated := escalated + 1;
      results := results || jsonb_build_object(
        'curriculum', r.curriculum_title,
        'health', r.backlog_health,
        'review_pending', r.review_pending,
        'promotable_drafts', r.promotable_drafts
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'escalated', escalated,
    'checked_at', now(),
    'details', results
  );
END;
$$;
