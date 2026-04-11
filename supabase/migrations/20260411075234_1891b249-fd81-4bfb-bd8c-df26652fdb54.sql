
-- 1. Override table for manual product page customization
CREATE TABLE IF NOT EXISTS public.product_page_overrides (
  curriculum_id uuid PRIMARY KEY REFERENCES curricula(id) ON DELETE CASCADE,
  hero_headline text,
  hero_subline text,
  hero_kicker text,
  product_intro text,
  pain_headline text,
  pain_copy text,
  usp_headline text,
  usp_copy text,
  how_it_works_headline text,
  how_it_works_copy text,
  profession_fit_headline text,
  profession_fit_copy text,
  final_cta_headline text,
  final_cta_copy text,
  discovery_teaser text,
  short_sales_teaser text,
  seo_title text,
  meta_description text,
  og_title text,
  og_description text,
  og_image_url text,
  hero_image_url text,
  hero_image_alt text,
  faq_items_override jsonb,
  module_items_override jsonb,
  badges_override jsonb,
  trust_items_override jsonb,
  price_amount numeric,
  price_currency text DEFAULT 'EUR',
  price_label text,
  access_duration_months int DEFAULT 12,
  is_subscription boolean DEFAULT false,
  offer_highlight text,
  cta_primary_label text,
  cta_secondary_label text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.product_page_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage product page overrides"
  ON public.product_page_overrides FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. The comprehensive v_product_page_ssot view
CREATE OR REPLACE VIEW public.v_product_page_ssot AS
WITH base AS (
  SELECT
    cp.id AS package_id,
    cp.course_id,
    cp.curriculum_id,
    cp.status,
    cp.track::text AS track,
    cp.persona_profile,
    cp.chamber_type,
    cp.exam_structure,
    cp.feature_flags,
    cp.published_at,
    cp.updated_at,
    cp.product_id,
    cur.id AS cur_id,
    cur.title AS curriculum_title,
    cur.track::text AS curriculum_track,
    b.id AS beruf_id,
    b.bezeichnung_kurz,
    b.bezeichnung_lang,
    b.zustaendigkeit,
    b.taetigkeitsprofil,
    b.ausbildungsdauer_monate,
    b.dqr_niveau,
    p.slug AS product_slug,
    p.product_type,
    p.title AS product_title,
    p.subtitle AS product_subtitle,
    p.description AS product_description,
    ov.hero_headline AS ov_hero_headline,
    ov.hero_subline AS ov_hero_subline,
    ov.hero_kicker AS ov_hero_kicker,
    ov.product_intro AS ov_product_intro,
    ov.pain_headline AS ov_pain_headline,
    ov.pain_copy AS ov_pain_copy,
    ov.usp_headline AS ov_usp_headline,
    ov.usp_copy AS ov_usp_copy,
    ov.how_it_works_headline AS ov_how_it_works_headline,
    ov.how_it_works_copy AS ov_how_it_works_copy,
    ov.profession_fit_headline AS ov_profession_fit_headline,
    ov.profession_fit_copy AS ov_profession_fit_copy,
    ov.final_cta_headline AS ov_final_cta_headline,
    ov.final_cta_copy AS ov_final_cta_copy,
    ov.discovery_teaser AS ov_discovery_teaser,
    ov.short_sales_teaser AS ov_short_sales_teaser,
    ov.seo_title AS ov_seo_title,
    ov.meta_description AS ov_meta_description,
    ov.og_title AS ov_og_title,
    ov.og_description AS ov_og_description,
    ov.og_image_url AS ov_og_image_url,
    ov.hero_image_url AS ov_hero_image_url,
    ov.hero_image_alt AS ov_hero_image_alt,
    ov.faq_items_override,
    ov.module_items_override,
    ov.badges_override,
    ov.trust_items_override,
    ov.price_amount AS ov_price,
    ov.price_currency AS ov_currency,
    ov.price_label AS ov_price_label,
    ov.access_duration_months AS ov_access_months,
    ov.is_subscription AS ov_is_subscription,
    ov.offer_highlight AS ov_offer_highlight,
    ov.cta_primary_label AS ov_cta_primary,
    ov.cta_secondary_label AS ov_cta_secondary
  FROM course_packages cp
  LEFT JOIN courses c ON c.id = cp.course_id
  LEFT JOIN curricula cur ON cur.id = cp.curriculum_id
  LEFT JOIN berufe b ON b.id = cur.beruf_id
  LEFT JOIN products p ON p.id = cp.product_id
  LEFT JOIN product_page_overrides ov ON ov.curriculum_id = cp.curriculum_id
  WHERE cp.status NOT IN ('archived')
),
display AS (
  SELECT
    v.package_id,
    v.canonical_title,
    v.canonical_title_norm,
    v.beruf_display_name
  FROM v_course_display_ssot v
),
resolved AS (
  SELECT
    b.*,
    d.canonical_title,
    d.canonical_title_norm,
    COALESCE(d.beruf_display_name, b.bezeichnung_kurz) AS beruf_display_name,
    -- Kammer resolution
    CASE b.zustaendigkeit
      WHEN 'IH' THEN 'IHK'
      WHEN 'Hw' THEN 'HWK'
      WHEN 'Lw' THEN 'LWK'
      WHEN 'FB' THEN 'Freier Beruf'
      WHEN 'ÖD' THEN 'Öffentlicher Dienst'
      ELSE COALESCE(b.zustaendigkeit, 'IHK')
    END AS kammer,
    -- Feature availability
    b.track IN ('AUSBILDUNG_VOLL', 'EXAM_FIRST_PLUS') AS oral_mode_available,
    b.track IN ('AUSBILDUNG_VOLL') OR b.persona_profile = 'AZUBI_HIGH_ROI' AS ai_tutor_available,
    b.track IN ('AUSBILDUNG_VOLL') OR b.persona_profile = 'AZUBI_HIGH_ROI' AS handbook_available,
    b.track IN ('AUSBILDUNG_VOLL') OR b.persona_profile = 'AZUBI_HIGH_ROI' AS minichecks_available,
    TRUE AS exam_mode_available
  FROM base b
  LEFT JOIN display d ON d.package_id = b.package_id
)
SELECT
  -- ============ BLOCK 1: Identität & Routing ============
  r.package_id,
  r.course_id,
  r.curriculum_id,
  r.beruf_id,
  COALESCE(
    r.product_slug,
    lower(regexp_replace(
      replace(replace(replace(replace(
        COALESCE(r.canonical_title_norm, r.canonical_title, r.bezeichnung_kurz, 'kurs'),
        'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
      '[^a-z0-9\s-]','','g'))
  ) AS canonical_slug,
  'https://examfit.de/pruefungstraining/' || COALESCE(
    r.product_slug,
    lower(regexp_replace(
      replace(replace(replace(replace(
        COALESCE(r.canonical_title_norm, r.canonical_title, r.bezeichnung_kurz, 'kurs'),
        'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
      '[^a-z0-9\s-]','','g'))
  ) AS canonical_url,
  COALESCE(r.canonical_title, r.bezeichnung_kurz) AS canonical_title,
  r.canonical_title_norm,
  COALESCE(r.product_type, 'pruefungstraining') AS product_type,
  r.status,
  r.published_at,
  r.updated_at,

  -- ============ BLOCK 2: Berufs- & Prüfungsbezug ============
  r.beruf_display_name,
  r.bezeichnung_kurz AS beruf_kurz,
  r.bezeichnung_lang AS beruf_lang,
  r.kammer,
  r.track,
  r.curriculum_track,
  r.persona_profile,
  CASE
    WHEN r.oral_mode_available THEN 'schriftlich_und_muendlich'
    ELSE 'schriftlich'
  END AS exam_focus,
  r.exam_mode_available,
  r.oral_mode_available,
  r.ai_tutor_available,
  r.handbook_available,
  r.minichecks_available,

  -- ============ BLOCK 3: Conversion-Copy ============
  COALESCE(r.ov_hero_headline,
    'Bestehe deine ' || r.kammer || '-Prüfung als ' || COALESCE(r.beruf_display_name, 'Fachkraft') || ' mit systematischem Prüfungstraining'
  ) AS hero_headline,
  COALESCE(r.ov_hero_subline,
    CASE WHEN r.oral_mode_available
      THEN 'Trainiere schriftliche und mündliche Prüfungssituationen mit prüfungsnahen Aufgaben, Simulationen, KI-Coach und klarer Schwächenanalyse.'
      ELSE 'Trainiere prüfungsnahe Aufgaben, Simulationen, KI-Coach und klare Schwächenanalyse für deine Abschlussprüfung.'
    END
  ) AS hero_subline,
  COALESCE(r.ov_hero_kicker,
    'Prüfungsnah trainieren · Fortschritt sehen · sicherer bestehen'
  ) AS hero_kicker,
  COALESCE(r.ov_product_intro,
    'Dieses Prüfungstraining unterstützt dich dabei, dich gezielt auf die ' || r.kammer || '-Prüfung als ' || COALESCE(r.beruf_display_name, 'Fachkraft') || ' vorzubereiten – mit Simulationen, KI-Feedback, kompaktem Prüfungswissen und klarer Schwächenanalyse.'
  ) AS product_intro,
  COALESCE(r.ov_pain_headline,
    'Viele lernen viel – aber nicht das, was in der Prüfung wirklich zählt'
  ) AS pain_headline,
  COALESCE(r.ov_pain_copy,
    'Gerade in der Vorbereitung auf die ' || COALESCE(r.beruf_display_name, '') || '-Prüfung reicht allgemeine Theorie oft nicht aus. Entscheidend ist, typische Aufgabenformate zu trainieren, Schwächen zu erkennen und prüfungsnah zu üben.'
  ) AS pain_copy,
  COALESCE(r.ov_usp_headline,
    'ExamFit ist kein klassischer Vorbereitungskurs'
  ) AS usp_headline,
  COALESCE(r.ov_usp_copy,
    'ExamFit ist ein intelligentes Prüfungstrainings-System für deine Abschlussprüfung. Du trainierst nicht wahllos Inhalte, sondern genau die Aufgabenarten, Themen und Prüfungssituationen, die für deinen Beruf relevant sind.'
  ) AS usp_copy,
  COALESCE(r.ov_how_it_works_headline,
    'So funktioniert dein Prüfungstraining'
  ) AS how_it_works_headline,
  '' AS how_it_works_copy,
  COALESCE(r.ov_profession_fit_headline,
    'Warum ExamFit für ' || COALESCE(r.beruf_display_name, 'deinen Beruf') || ' besonders sinnvoll ist'
  ) AS profession_fit_headline,
  COALESCE(r.ov_profession_fit_copy,
    'Für ' || COALESCE(r.beruf_display_name, 'deinen Beruf') || ' ist nicht nur Wissen entscheidend, sondern auch der sichere Umgang mit typischen Prüfungsformaten und Aufgabentypen. Genau dafür kombiniert ExamFit prüfungsnahe Aufgaben, Simulationen und gezieltes Feedback.'
  ) AS profession_fit_copy,
  COALESCE(r.ov_final_cta_headline,
    'Komplett-Zugang für deine Prüfungsvorbereitung'
  ) AS final_cta_headline,
  COALESCE(r.ov_final_cta_copy,
    COALESCE(r.ov_price::text, '24.90') || ' € einmalig · ' || COALESCE(r.ov_access_months, 12)::text || ' Monate Zugriff · kein Abo'
  ) AS final_cta_copy,
  COALESCE(r.ov_discovery_teaser,
    'Trainiere gezielt für deine ' || r.kammer || '-Abschlussprüfung als ' || COALESCE(r.beruf_display_name, 'Fachkraft') || ' – mit Simulation, KI-Coach und Schwächenanalyse.'
  ) AS discovery_teaser,
  COALESCE(r.ov_short_sales_teaser,
    'Prüfungstraining für ' || COALESCE(r.beruf_display_name, 'deinen Beruf') || ' mit Simulation und KI-Coach.'
  ) AS short_sales_teaser,

  -- ============ BLOCK 4: Trust, Badges, Preis ============
  COALESCE(r.badges_override,
    jsonb_build_array(
      CASE WHEN r.oral_mode_available THEN 'Schriftlich + mündlich' ELSE 'Schriftliche Prüfung' END,
      CASE WHEN r.ai_tutor_available THEN 'KI-Coach' ELSE 'Prüfungstraining' END,
      COALESCE(r.ov_access_months, 12)::text || ' Monate Zugriff',
      CASE WHEN r.kammer = 'IHK' THEN 'IHK-nah' WHEN r.kammer = 'HWK' THEN 'HWK-nah' ELSE r.kammer || '-nah' END,
      'Sofort verfügbar'
    )
  ) AS badges,
  COALESCE(r.trust_items_override,
    '["Einmalzahlung","Kein Abo","12 Monate Zugriff","Sofortiger Zugang"]'::jsonb
  ) AS trust_items,
  COALESCE(r.ov_price, 24.90) AS price_amount,
  COALESCE(r.ov_currency, 'EUR') AS price_currency,
  COALESCE(r.ov_price_label, COALESCE(r.ov_price::text, '24.90') || ' €') AS price_label,
  COALESCE(r.ov_access_months, 12) AS access_duration_months,
  COALESCE(r.ov_is_subscription, false) AS is_subscription,
  r.ov_offer_highlight AS offer_highlight,
  COALESCE(r.ov_cta_primary, 'Jetzt Prüfungstraining starten') AS cta_primary_label,
  COALESCE(r.ov_cta_secondary, 'Prüfungsreife testen') AS cta_secondary_label,
  'https://examfit.de/pruefungstraining/' || COALESCE(
    r.product_slug,
    lower(regexp_replace(
      replace(replace(replace(replace(
        COALESCE(r.canonical_title_norm, r.canonical_title, r.bezeichnung_kurz, 'kurs'),
        'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
      '[^a-z0-9\s-]','','g'))
  ) || '#start' AS cta_primary_url,
  'https://examfit.de/pruefungstraining/' || COALESCE(
    r.product_slug,
    lower(regexp_replace(
      replace(replace(replace(replace(
        COALESCE(r.canonical_title_norm, r.canonical_title, r.bezeichnung_kurz, 'kurs'),
        'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
      '[^a-z0-9\s-]','','g'))
  ) || '#test' AS cta_secondary_url,
  COALESCE(r.ov_cta_primary, 'Jetzt starten – ' || COALESCE(r.ov_price::text, '24.90') || ' €') AS sticky_cta_label,
  COALESCE(r.ov_price::text, '24.90') || ' € · ' || COALESCE(r.ov_access_months, 12)::text || ' Monate' AS sticky_cta_price_label,

  -- ============ BLOCK 5: Inhaltsmodule ============
  COALESCE(r.module_items_override, (
    SELECT jsonb_agg(m ORDER BY m->>'key')
    FROM (
      SELECT jsonb_build_object('key','written_exam','title','Schriftliche Prüfungssimulation','copy','Trainiere unter realistischen Bedingungen mit Zeitlimit, Bewertung und direktem Feedback.','icon','ClipboardCheck') AS m
      UNION ALL
      SELECT jsonb_build_object('key','oral_exam','title','Mündliche Prüfung trainieren','copy','Übe typische Prüfungssituationen mit strukturiertem KI-Feedback.','icon','Mic') WHERE r.oral_mode_available
      UNION ALL
      SELECT jsonb_build_object('key','ai_tutor','title','KI-Prüfungscoach','copy','Lass dir schwierige Themen verständlich erklären und arbeite gezielt an Unsicherheiten.','icon','MessageSquare') WHERE r.ai_tutor_available
      UNION ALL
      SELECT jsonb_build_object('key','handbook','title','Kompaktes Prüfungswissen','copy','Alle prüfungsrelevanten Inhalte strukturiert und auf den Punkt – ideal zum Nachschlagen.','icon','BookOpen') WHERE r.handbook_available
      UNION ALL
      SELECT jsonb_build_object('key','minichecks','title','MiniChecks','copy','Kurze Wissenstests nach jedem Lernabschnitt zur Selbsteinschätzung.','icon','CheckCircle') WHERE r.minichecks_available
      UNION ALL
      SELECT jsonb_build_object('key','analysis','title','Schwächenanalyse','copy','Erkenne genau, in welchen Themenbereichen du noch Lücken hast.','icon','BarChart3')
    ) modules
  )) AS module_items_json,

  jsonb_build_array(
    jsonb_build_object('title','Prüfungsnah statt theorielastig','copy','Aufgaben und Formate wie in der echten Prüfung.'),
    jsonb_build_object('title','Gezieltes Feedback','copy','Nach jeder Aufgabe weißt du, wo du stehst.'),
    jsonb_build_object('title','Adaptive Schwächenanalyse','copy','Das System erkennt deine Lücken und empfiehlt passende Übungen.'),
    jsonb_build_object('title','Flexibel und selbstbestimmt','copy','Lerne wann und wo du willst – ohne feste Termine.')
  ) AS usp_items_json,

  jsonb_build_array(
    jsonb_build_object('step',1,'title','Prüfungstraining starten','copy','Du startest mit dem passenden Training für deinen Beruf und deine Prüfung.'),
    jsonb_build_object('step',2,'title','Prüfungsnah üben','copy','Du bearbeitest Aufgaben, Simulationen und MiniChecks mit direktem Feedback.'),
    jsonb_build_object('step',3,'title','Schwächen gezielt verbessern','copy','Du siehst, welche Themen und Aufgabentypen du noch trainieren solltest.'),
    jsonb_build_object('step',4,'title','Sicherer in die Prüfung gehen','copy','Du baust Routine auf und bereitest dich strukturierter auf die Abschlussprüfung vor.')
  ) AS how_it_works_steps_json,

  jsonb_build_array(
    jsonb_build_object('title','Trainiere typische Aufgabenformate für deinen Beruf statt allgemeiner Theorie.'),
    jsonb_build_object('title','Erkenne schnell, in welchen Themenbereichen du noch Lücken hast.'),
    jsonb_build_object('title','Bereite dich strukturierter auf schriftliche' || CASE WHEN r.oral_mode_available THEN ' und mündliche' ELSE '' END || ' Prüfungssituationen vor.')
  ) AS role_fit_items_json,

  COALESCE(r.faq_items_override, jsonb_build_array(
    jsonb_build_object('question','Für welche Prüfung ist dieses Training gedacht?','answer','Dieses Prüfungstraining ist für die Vorbereitung auf die ' || r.kammer || '-Prüfung als ' || COALESCE(r.beruf_display_name,'Fachkraft') || ' ausgelegt.'),
    jsonb_build_object('question','Was ist im Preis enthalten?','answer','Du erhältst Zugriff auf dein Prüfungstraining mit prüfungsnahen Aufgaben, Simulationen, KI-Coach, Schwächenanalyse und weiteren prüfungsrelevanten Modulen.'),
    jsonb_build_object('question','Ist das ein Abo?','answer','Nein. Du zahlst einmalig und erhältst ' || COALESCE(r.ov_access_months,12)::text || ' Monate Zugriff.'),
    jsonb_build_object('question','Kann ich schriftliche und mündliche Prüfung trainieren?','answer',CASE WHEN r.oral_mode_available THEN 'Ja. Du kannst sowohl die schriftliche als auch die mündliche Prüfung gezielt trainieren.' ELSE 'Das Training fokussiert sich auf die schriftliche Prüfungsvorbereitung mit prüfungsnahen Aufgaben und Simulationen.' END),
    jsonb_build_object('question','Für wen ist das Training geeignet?','answer','Das Training eignet sich sowohl für die gezielte Vorbereitung kurz vor der Prüfung als auch für eine strukturierte Begleitung über einen längeren Zeitraum.'),
    jsonb_build_object('question','Was unterscheidet ExamFit von normalen Vorbereitungskursen?','answer','ExamFit ist kein klassischer Kurs, sondern ein Prüfungstrainings-System mit Simulation, Feedback und gezielter Ausrichtung auf deine Abschlussprüfung.')
  )) AS faq_items_json,

  '[]'::jsonb AS related_courses_json,
  '[]'::jsonb AS internal_links_json,

  -- ============ BLOCK 6: SEO & Metadaten ============
  COALESCE(r.ov_seo_title,
    COALESCE(r.beruf_display_name,'Prüfungstraining') || ' Prüfung bestehen – Prüfungstraining & Simulation | ExamFit'
  ) AS seo_title,
  COALESCE(r.ov_meta_description,
    'Bestehe deine ' || COALESCE(r.beruf_display_name,'') || '-Prüfung sicher. Trainiere mit Prüfungssimulation, KI-Coach, Schwächenanalyse und gezielter Vorbereitung auf deine ' || r.kammer || '-Abschlussprüfung.'
  ) AS meta_description,
  ARRAY[
    COALESCE(r.beruf_display_name,'') || ' Prüfung',
    COALESCE(r.beruf_display_name,'') || ' Prüfungsvorbereitung',
    r.kammer || ' Abschlussprüfung',
    'Prüfungstraining'
  ] AS meta_keywords,
  COALESCE(r.ov_og_title,
    COALESCE(r.beruf_display_name,'Prüfungstraining') || ' Prüfung bestehen | ExamFit'
  ) AS og_title,
  COALESCE(r.ov_og_description,
    'Prüfungsnah trainieren statt nur Theorie lernen: Mit Simulation, KI-Coach und klarer Schwächenanalyse für ' || COALESCE(r.beruf_display_name,'deinen Beruf') || '.'
  ) AS og_description,
  COALESCE(r.ov_og_image_url, '/og-image.png') AS og_image_url,
  COALESCE(r.ov_og_title,
    COALESCE(r.beruf_display_name,'Prüfungstraining') || ' Prüfung bestehen | ExamFit'
  ) AS twitter_title,
  COALESCE(r.ov_og_description,
    'Prüfungsnah trainieren statt nur Theorie lernen: Mit Simulation, KI-Coach und klarer Schwächenanalyse für ' || COALESCE(r.beruf_display_name,'deinen Beruf') || '.'
  ) AS twitter_description,
  COALESCE(r.ov_og_image_url, '/og-image.png') AS twitter_image_url,
  CASE WHEN r.status = 'published' THEN 'index,follow' ELSE 'noindex,nofollow' END AS robots,

  -- Schema.org Product
  jsonb_build_object(
    '@context','https://schema.org',
    '@type','Product',
    'name','Prüfungstraining ' || COALESCE(r.beruf_display_name,''),
    'description','Prüfungstraining mit Simulation, KI-Coach und Schwächenanalyse für die ' || r.kammer || '-Abschlussprüfung.',
    'brand',jsonb_build_object('@type','Brand','name','ExamFit'),
    'offers',jsonb_build_object(
      '@type','Offer',
      'priceCurrency',COALESCE(r.ov_currency,'EUR'),
      'price',COALESCE(r.ov_price,24.90)::text,
      'availability','https://schema.org/InStock',
      'url','https://examfit.de/pruefungstraining/' || COALESCE(
        r.product_slug,
        lower(regexp_replace(replace(replace(replace(replace(
          COALESCE(r.canonical_title_norm, r.canonical_title, r.bezeichnung_kurz, 'kurs'),
          'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
          '[^a-z0-9\s-]','','g'))
      )
    )
  ) AS schema_product_json,

  -- Schema.org FAQ
  jsonb_build_object(
    '@context','https://schema.org',
    '@type','FAQPage',
    'mainEntity', jsonb_build_array(
      jsonb_build_object('@type','Question','name','Für welche Prüfung ist dieses Training gedacht?','acceptedAnswer',jsonb_build_object('@type','Answer','text','Dieses Prüfungstraining ist für die Vorbereitung auf die ' || r.kammer || '-Prüfung als ' || COALESCE(r.beruf_display_name,'Fachkraft') || ' ausgelegt.')),
      jsonb_build_object('@type','Question','name','Ist das ein Abo?','acceptedAnswer',jsonb_build_object('@type','Answer','text','Nein. Du zahlst einmalig und erhältst ' || COALESCE(r.ov_access_months,12)::text || ' Monate Zugriff.')),
      jsonb_build_object('@type','Question','name','Was unterscheidet ExamFit von normalen Vorbereitungskursen?','acceptedAnswer',jsonb_build_object('@type','Answer','text','ExamFit ist kein klassischer Kurs, sondern ein Prüfungstrainings-System mit Simulation, Feedback und gezielter Ausrichtung auf deine Abschlussprüfung.'))
    )
  ) AS schema_faq_json,

  -- Schema.org Breadcrumb
  jsonb_build_object(
    '@context','https://schema.org',
    '@type','BreadcrumbList',
    'itemListElement', jsonb_build_array(
      jsonb_build_object('@type','ListItem','position',1,'name','Startseite','item','https://examfit.de/'),
      jsonb_build_object('@type','ListItem','position',2,'name','Prüfungstraining','item','https://examfit.de/pruefungstraining'),
      jsonb_build_object('@type','ListItem','position',3,'name',COALESCE(r.beruf_display_name, r.canonical_title),'item','https://examfit.de/pruefungstraining/' || COALESCE(
        r.product_slug,
        lower(regexp_replace(replace(replace(replace(replace(
          COALESCE(r.canonical_title_norm, r.canonical_title, r.bezeichnung_kurz, 'kurs'),
          'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
          '[^a-z0-9\s-]','','g'))
      ))
    )
  ) AS schema_breadcrumb_json,

  -- ============ BLOCK 7: Bilder & Alt-Texte ============
  COALESCE(r.ov_hero_image_url, '/images/hero-default.jpg') AS hero_image_url,
  COALESCE(r.ov_hero_image_alt, 'Prüfungstraining für ' || COALESCE(r.beruf_display_name,'') || ' mit Simulation und Fortschrittsanzeige') AS hero_image_alt,
  '/images/preview-default.jpg' AS preview_image_url,
  'Vorschau des Prüfungstrainings für ' || COALESCE(r.beruf_display_name,'') AS preview_image_alt,
  '/images/simulation-default.jpg' AS simulation_image_url,
  'Schriftliche Prüfungssimulation für ' || COALESCE(r.beruf_display_name,'') AS simulation_image_alt,
  '/images/analysis-default.jpg' AS analysis_image_url,
  'Schwächenanalyse zur Vorbereitung auf die ' || COALESCE(r.beruf_display_name,'') || '-Prüfung' AS analysis_image_alt,
  '/images/ai-feedback-default.jpg' AS ai_feedback_image_url,
  'KI-Feedback nach einer Prüfungssimulation für ' || COALESCE(r.beruf_display_name,'') AS ai_feedback_image_alt,

  -- ============ BLOCK 8: Such- und Verlinkungslogik ============
  lower(concat_ws(' ',
    r.canonical_title, r.canonical_title_norm,
    r.bezeichnung_kurz, r.bezeichnung_lang,
    r.curriculum_title, r.taetigkeitsprofil,
    CASE r.zustaendigkeit WHEN 'IH' THEN 'ihk industrie handelskammer' WHEN 'Hw' THEN 'hwk handwerkskammer' ELSE NULL END
  )) AS search_text,
  COALESCE(r.beruf_display_name,'') || ' Prüfung' AS keyword_primary,
  ARRAY[
    COALESCE(r.beruf_display_name,'') || ' Prüfungsvorbereitung',
    COALESCE(r.beruf_display_name,'') || ' Abschlussprüfung',
    r.kammer || ' ' || COALESCE(r.beruf_display_name,'')
  ] AS keyword_secondary,
  ARRAY[
    COALESCE(r.beruf_display_name,'') || ' Prüfung bestehen',
    COALESCE(r.beruf_display_name,'') || ' Prüfungstraining online',
    r.kammer || ' Prüfung ' || COALESCE(r.beruf_display_name,'') || ' vorbereiten'
  ] AS keyword_longtail,
  CASE r.curriculum_track
    WHEN 'AUSBILDUNG_VOLL' THEN 'ausbildung'
    WHEN 'STUDIUM' THEN 'studium'
    WHEN 'FORTBILDUNG' THEN 'fortbildung'
    WHEN 'ZERTIFIKAT' THEN 'zertifizierung'
    ELSE 'fortbildung'
  END AS domain_key,
  CASE r.curriculum_track
    WHEN 'AUSBILDUNG_VOLL' THEN 'Ausbildung'
    WHEN 'STUDIUM' THEN 'Studium'
    WHEN 'FORTBILDUNG' THEN 'Fortbildung'
    WHEN 'ZERTIFIKAT' THEN 'Zertifizierung'
    ELSE 'Fortbildung'
  END AS domain_label,
  ARRAY[]::text[] AS related_professions,
  ARRAY[]::text[] AS related_topics

FROM resolved r;

-- Grant read access
GRANT SELECT ON public.v_product_page_ssot TO anon, authenticated;
