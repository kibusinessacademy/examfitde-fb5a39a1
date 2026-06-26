
CREATE OR REPLACE VIEW public.v_full_course_catalog AS
WITH beruf_sellable AS (
  SELECT v.beruf_id, bool_or(s.is_sellable) AS any_sellable,
         max(v.id::text) AS package_id_text
  FROM v_public_sellable_courses s
  JOIN v_course_display_ssot v ON v.curriculum_id = s.curriculum_id
  WHERE v.beruf_id IS NOT NULL
  GROUP BY v.beruf_id
),
beruf_rows AS (
  SELECT
    b.id AS beruf_id,
    b.bezeichnung_kurz AS title,
    b.bezeichnung_lang AS title_long,
    b.zustaendigkeit,
    b.ausbildungsdauer_monate,
    b.dqr_niveau,
    lower(regexp_replace(regexp_replace(b.bezeichnung_kurz, '[^a-zA-Z0-9äöüÄÖÜß\s-]'::text, ''::text, 'g'::text), '\s+'::text, '-'::text, 'g'::text)) AS slug,
    CASE b.zustaendigkeit
      WHEN 'IH' THEN 'IHK'
      WHEN 'Hw' THEN 'HWK'
      ELSE b.zustaendigkeit
    END AS kammer,
    hc.package_id,
    COALESCE(bs.any_sellable, false) AS is_published,
    COALESCE(hc.category, 'ausbildung') AS category,
    COALESCE(hc.category_label, 'Ausbildung') AS category_label,
    NULLIF(b.taetigkeitsprofil, '') AS description,
    -- USP-Teaser: nutzt taetigkeitsprofil wenn vorhanden, sonst kammer-spezifisch
    CASE
      WHEN NULLIF(b.taetigkeitsprofil, '') IS NOT NULL
        THEN left(b.taetigkeitsprofil, 140) ||
             CASE WHEN length(b.taetigkeitsprofil) > 140 THEN '…' ELSE '' END
      ELSE
        'Bestehe die ' ||
        CASE b.zustaendigkeit WHEN 'IH' THEN 'IHK' WHEN 'Hw' THEN 'HWK' ELSE COALESCE(b.zustaendigkeit, 'Abschluss') END ||
        '-Prüfung als ' || b.bezeichnung_kurz ||
        ': adaptiver Lernpfad, KI-Coach & Simulationsprüfungen — 12 Monate Zugriff.'
    END AS discovery_teaser,
    hc.popularity_score,
    COALESCE(hc.slug, lower(regexp_replace(regexp_replace(b.bezeichnung_kurz, '[^a-zA-Z0-9äöüÄÖÜß\s-]'::text, ''::text, 'g'::text), '\s+'::text, '-'::text, 'g'::text))) AS published_slug
  FROM berufe b
  LEFT JOIN v_homepage_course_catalog hc ON hc.beruf_id = b.id
  LEFT JOIN beruf_sellable bs ON bs.beruf_id = b.id
  WHERE b.ist_aktiv = true
),
extra_products AS (
  -- Verkaufbare Produkte ohne Berufe-Zuordnung (Fortbildung, Studium, Zertifikat)
  SELECT DISTINCT ON (s.product_id)
    s.product_id AS beruf_id,
    s.product_title AS title,
    NULL::text AS title_long,
    NULL::text AS zustaendigkeit,
    NULL::integer AS ausbildungsdauer_monate,
    NULL::integer AS dqr_niveau,
    s.product_slug AS slug,
    CASE cur.track::text
      WHEN 'FORTBILDUNG' THEN 'IHK'
      ELSE NULL
    END AS kammer,
    NULL::uuid AS package_id,
    true AS is_published,
    CASE cur.track::text
      WHEN 'STUDIUM' THEN 'studium'
      WHEN 'FORTBILDUNG' THEN 'fortbildung'
      WHEN 'ZERTIFIKAT' THEN 'zertifizierung'
      ELSE 'fortbildung'
    END AS category,
    CASE cur.track::text
      WHEN 'STUDIUM' THEN 'Studium'
      WHEN 'FORTBILDUNG' THEN 'Fortbildung'
      WHEN 'ZERTIFIKAT' THEN 'Zertifizierung'
      ELSE 'Fortbildung'
    END AS category_label,
    NULL::text AS description,
    'Prüfungstraining ' || s.product_title ||
      ': adaptiver Lernpfad, KI-Coach & Simulationsprüfungen — sofort startklar, 12 Monate Zugriff.' AS discovery_teaser,
    NULL::bigint AS popularity_score,
    s.product_slug AS published_slug
  FROM v_public_sellable_courses s
  JOIN curricula cur ON cur.id = s.curriculum_id
  LEFT JOIN v_course_display_ssot v ON v.curriculum_id = s.curriculum_id
  WHERE s.is_sellable
    AND v.beruf_id IS NULL
)
SELECT * FROM beruf_rows
UNION ALL
SELECT * FROM extra_products
ORDER BY title;

GRANT SELECT ON public.v_full_course_catalog TO anon, authenticated, service_role;
