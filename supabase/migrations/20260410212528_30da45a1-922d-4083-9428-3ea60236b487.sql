
CREATE OR REPLACE VIEW public.v_humor_delivery_kpi AS
WITH delivery_stats AS (
  SELECT
    hde.surface,
    hi.humor_type,
    hi.certification_id,
    c.title AS certification_title,
    COUNT(*) AS total_deliveries,
    COUNT(DISTINCT hde.user_id) AS unique_users,
    COUNT(*) FILTER (WHERE hde.reaction = 'liked') AS likes,
    COUNT(*) FILTER (WHERE hde.reaction = 'disliked') AS dislikes,
    COUNT(*) FILTER (WHERE hde.reaction = 'skipped') AS skips,
    COUNT(*) FILTER (WHERE hde.reaction = 'shared') AS shares,
    COUNT(*) FILTER (WHERE hde.reaction IS NOT NULL) AS total_reactions,
    COUNT(DISTINCT hde.humor_item_id) AS unique_items_shown
  FROM public.humor_delivery_events hde
  JOIN public.humor_items hi ON hi.id = hde.humor_item_id
  LEFT JOIN public.certifications c ON c.id = hi.certification_id
  GROUP BY hde.surface, hi.humor_type, hi.certification_id, c.title
)
SELECT
  surface,
  humor_type,
  certification_id,
  certification_title,
  total_deliveries,
  unique_users,
  likes,
  dislikes,
  skips,
  shares,
  total_reactions,
  unique_items_shown,
  CASE WHEN total_reactions > 0
    THEN ROUND(likes::numeric / total_reactions * 100, 1)
    ELSE 0
  END AS like_rate_pct,
  CASE WHEN total_reactions > 0
    THEN ROUND(dislikes::numeric / total_reactions * 100, 1)
    ELSE 0
  END AS dislike_rate_pct,
  CASE WHEN unique_items_shown > 0
    THEN ROUND(total_deliveries::numeric / unique_items_shown, 1)
    ELSE 0
  END AS avg_deliveries_per_item
FROM delivery_stats
ORDER BY total_deliveries DESC;
