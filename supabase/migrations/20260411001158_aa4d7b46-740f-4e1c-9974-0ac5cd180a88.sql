
CREATE OR REPLACE VIEW public.v_homepage_course_catalog AS
WITH enrollment_counts AS (
  SELECT co.curriculum_id, COUNT(ce.id) AS enroll_count
  FROM course_enrollments ce
  JOIN courses co ON co.id = ce.course_id
  GROUP BY co.curriculum_id
),
entitlement_counts AS (
  SELECT e.curriculum_id, COUNT(e.id) AS ent_count
  FROM entitlements e
  WHERE e.valid_until > NOW() OR e.valid_until IS NULL
  GROUP BY e.curriculum_id
)
SELECT
  cp.id                                    AS package_id,
  v.course_row_id                          AS course_id,
  v.curriculum_id,
  v.canonical_title                        AS title,
  v.canonical_title_norm                   AS title_norm,
  LOWER(REGEXP_REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(
      COALESCE(v.canonical_title_norm, v.canonical_title),
      'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
    '[^a-z0-9\s-]', '', 'g'
  ))                                       AS slug,
  v.beruf_id,
  v.beruf_display_name,
  b.bezeichnung_kurz                       AS beruf_kurz,
  b.bezeichnung_lang                       AS beruf_lang,
  b.taetigkeitsprofil                      AS description,
  b.zustaendigkeit,
  b.ausbildungsdauer_monate,
  b.dqr_niveau,
  cp.track::text                           AS track,
  cp.persona_profile,
  cur.track::text                          AS curriculum_track,
  CASE b.zustaendigkeit
    WHEN 'IH' THEN 'IHK'
    WHEN 'Hw' THEN 'HWK'
    WHEN 'Lw' THEN 'LWK'
    WHEN 'FB' THEN 'Freier Beruf'
    WHEN 'ÖD' THEN 'Öffentlicher Dienst'
    ELSE b.zustaendigkeit
  END                                      AS kammer,
  CASE cur.track::text
    WHEN 'AUSBILDUNG_VOLL' THEN 'ausbildung'
    WHEN 'STUDIUM' THEN 'studium'
    WHEN 'FORTBILDUNG' THEN 'fortbildung'
    WHEN 'ZERTIFIKAT' THEN 'zertifizierung'
    ELSE 'fortbildung'
  END                                      AS category,
  CASE cur.track::text
    WHEN 'AUSBILDUNG_VOLL' THEN 'Ausbildung'
    WHEN 'STUDIUM' THEN 'Studium'
    WHEN 'FORTBILDUNG' THEN 'Fortbildung'
    WHEN 'ZERTIFIKAT' THEN 'Zertifizierung'
    ELSE 'Fortbildung'
  END                                      AS category_label,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN cp.track::text IN ('AUSBILDUNG_VOLL','EXAM_FIRST_PLUS') THEN 'Schriftlich + mündlich' END,
    CASE WHEN cp.track::text = 'AUSBILDUNG_VOLL' OR cp.persona_profile = 'AZUBI_HIGH_ROI' THEN 'KI-Coach' END,
    '12 Monate Zugriff',
    CASE WHEN b.zustaendigkeit = 'IH' THEN 'IHK-nah' END,
    'Sofort verfügbar'
  ], NULL)                                 AS badges,
  LOWER(CONCAT_WS(' ',
    v.canonical_title,
    v.canonical_title_norm,
    b.bezeichnung_kurz,
    b.bezeichnung_lang,
    cur.title,
    cur.description,
    b.taetigkeitsprofil,
    CASE b.zustaendigkeit WHEN 'IH' THEN 'ihk industrie handelskammer' WHEN 'Hw' THEN 'hwk handwerkskammer' END,
    CASE 
      WHEN v.canonical_title ILIKE '%fachinformatiker%anwendung%' THEN 'fi ae fiae anwendungsentwicklung'
      WHEN v.canonical_title ILIKE '%fachinformatiker%system%' THEN 'fi si fisi systemintegration'
      WHEN v.canonical_title ILIKE '%büromanagement%' THEN 'bürokaufmann bürokauffrau büromanagement'
      WHEN v.canonical_title ILIKE '%industriekaufm%' THEN 'ik industriekaufmann industriekauffrau'
      WHEN v.canonical_title ILIKE '%einzelhandel%' THEN 'einzelhandel verkäufer verkäuferin'
      WHEN v.canonical_title ILIKE '%verkäufer%' THEN 'einzelhandel verkauf'
      WHEN v.canonical_title ILIKE '%mechatronik%' THEN 'mechatroniker'
      WHEN v.canonical_title ILIKE '%steuerfach%' THEN 'steuerfachangestellte stfa steuer'
      WHEN v.canonical_title ILIKE '%medizinische%fachangestellte%' THEN 'mfa arzthelferin'
      WHEN v.canonical_title ILIKE '%zahnmedizinische%' THEN 'zfa zahnarzthelferin'
      WHEN v.canonical_title ILIKE '%groß-%' OR v.canonical_title ILIKE '%außenhandel%' THEN 'groß außenhandel großhandel'
      ELSE ''
    END
  ))                                       AS search_text,
  COALESCE(ec.enroll_count, 0) * 100
    + COALESCE(etc.ent_count, 0) * 50
    + LEAST(EXTRACT(EPOCH FROM (NOW() - cp.published_at)) / 86400, 365)::int
                                           AS popularity_score,
  cp.published_at,
  cp.priority                              AS editorial_priority
FROM course_packages cp
JOIN v_course_display_ssot v ON v.package_id = cp.id
JOIN curricula cur ON cur.id = cp.curriculum_id
LEFT JOIN berufe b ON b.id = v.beruf_id
LEFT JOIN enrollment_counts ec ON ec.curriculum_id = cur.id
LEFT JOIN entitlement_counts etc ON etc.curriculum_id = cur.id
WHERE cp.status = 'published';

GRANT SELECT ON public.v_homepage_course_catalog TO anon, authenticated;
