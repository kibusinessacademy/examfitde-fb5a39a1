
DROP VIEW IF EXISTS public.v_homepage_course_catalog;

CREATE VIEW public.v_homepage_course_catalog AS
WITH enrollment_counts AS (
  SELECT co.curriculum_id, count(ce.id) AS enroll_count
  FROM course_enrollments ce
  JOIN courses co ON co.id = ce.course_id
  GROUP BY co.curriculum_id
), entitlement_counts AS (
  SELECT e.curriculum_id, count(e.id) AS ent_count
  FROM entitlements e
  WHERE e.valid_until > now() OR e.valid_until IS NULL
  GROUP BY e.curriculum_id
)
SELECT 
  cp.id AS package_id,
  v.course_row_id AS course_id,
  v.curriculum_id,
  v.canonical_title AS title,
  v.canonical_title_norm AS title_norm,
  regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(
          replace(replace(replace(replace(
            COALESCE(v.canonical_title_norm, v.canonical_title),
            'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
        ),
        '[^a-z0-9\s-]', '', 'g'
      ),
      '\s+', '-', 'g'
    ),
    '-+', '-', 'g'
  ) AS slug,
  v.beruf_id,
  v.beruf_display_name,
  b.bezeichnung_kurz AS beruf_kurz,
  b.bezeichnung_lang AS beruf_lang,
  b.taetigkeitsprofil AS description,
  CASE
    WHEN b.bezeichnung_kurz IS NOT NULL THEN
      'Trainiere gezielt für deine ' ||
      CASE b.zustaendigkeit
        WHEN 'IH' THEN 'IHK'
        WHEN 'Hw' THEN 'HWK'
        ELSE COALESCE(b.zustaendigkeit, '')
      END || '-Abschlussprüfung als ' || b.bezeichnung_kurz || ' – mit Simulation, KI-Coach und Schwächenanalyse.'
    ELSE 'Prüfungstraining mit Simulation, KI-Coach und adaptiver Schwächenanalyse.'
  END AS discovery_teaser,
  b.zustaendigkeit,
  b.ausbildungsdauer_monate,
  b.dqr_niveau,
  cp.track::text AS track,
  cp.persona_profile,
  cur.track::text AS curriculum_track,
  CASE b.zustaendigkeit
    WHEN 'IH' THEN 'IHK'
    WHEN 'Hw' THEN 'HWK'
    WHEN 'Lw' THEN 'LWK'
    WHEN 'FB' THEN 'Freier Beruf'
    WHEN 'ÖD' THEN 'Öffentlicher Dienst'
    ELSE b.zustaendigkeit
  END AS kammer,
  CASE cur.track::text
    WHEN 'AUSBILDUNG_VOLL' THEN 'ausbildung'
    WHEN 'STUDIUM' THEN 'studium'
    WHEN 'FORTBILDUNG' THEN 'fortbildung'
    WHEN 'ZERTIFIKAT' THEN 'zertifizierung'
    ELSE 'fortbildung'
  END AS category,
  CASE cur.track::text
    WHEN 'AUSBILDUNG_VOLL' THEN 'Ausbildung'
    WHEN 'STUDIUM' THEN 'Studium'
    WHEN 'FORTBILDUNG' THEN 'Fortbildung'
    WHEN 'ZERTIFIKAT' THEN 'Zertifizierung'
    ELSE 'Fortbildung'
  END AS category_label,
  array_remove(ARRAY[
    CASE WHEN cp.track::text = ANY(ARRAY['AUSBILDUNG_VOLL','EXAM_FIRST_PLUS']) THEN 'Schriftlich + mündlich' ELSE NULL END,
    CASE WHEN cp.track::text = 'AUSBILDUNG_VOLL' OR cp.persona_profile = 'AZUBI_HIGH_ROI' THEN 'KI-Coach' ELSE NULL END,
    '12 Monate Zugriff',
    CASE WHEN b.zustaendigkeit = 'IH' THEN 'IHK-nah' ELSE NULL END,
    'Sofort verfügbar'
  ], NULL) AS badges,
  lower(concat_ws(' ', v.canonical_title, v.canonical_title_norm, b.bezeichnung_kurz, b.bezeichnung_lang, cur.title, cur.description, b.taetigkeitsprofil,
    CASE b.zustaendigkeit WHEN 'IH' THEN 'ihk industrie handelskammer' WHEN 'Hw' THEN 'hwk handwerkskammer' ELSE NULL END,
    CASE
      WHEN v.canonical_title ~~* '%fachinformatiker%anwendung%' THEN 'fi ae fiae anwendungsentwicklung'
      WHEN v.canonical_title ~~* '%fachinformatiker%system%' THEN 'fi si fisi systemintegration'
      WHEN v.canonical_title ~~* '%büromanagement%' THEN 'bürokaufmann bürokauffrau büromanagement'
      WHEN v.canonical_title ~~* '%industriekaufm%' THEN 'ik industriekaufmann industriekauffrau'
      WHEN v.canonical_title ~~* '%einzelhandel%' THEN 'einzelhandel verkäufer verkäuferin'
      WHEN v.canonical_title ~~* '%verkäufer%' THEN 'einzelhandel verkauf'
      ELSE NULL
    END
  )) AS search_text,
  COALESCE(ec.enroll_count, 0) + COALESCE(ent.ent_count, 0) * 3 +
    CASE WHEN cp.published_at IS NOT NULL THEN 10 ELSE 0 END AS popularity_score,
  cp.published_at,
  NULL::int AS editorial_priority
FROM course_packages cp
JOIN v_course_display_ssot v ON v.id = cp.id
JOIN curricula cur ON cur.id = cp.curriculum_id
LEFT JOIN berufe b ON b.id = v.beruf_id
LEFT JOIN enrollment_counts ec ON ec.curriculum_id = cp.curriculum_id
LEFT JOIN entitlement_counts ent ON ent.curriculum_id = cp.curriculum_id
WHERE cp.status = 'published';

-- Reset Immobilienmakler stale processing jobs
UPDATE job_queue 
SET status = 'pending', locked_at = NULL, locked_by = NULL
WHERE package_id = 'fa931e34-52ee-4296-889f-303575b088d5'
  AND status = 'processing';
