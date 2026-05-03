UPDATE public.product_persona_overlays
SET
  hero_headline   = regexp_replace(hero_headline,   '\s*Umschulung\s*[–-]\s*Prüfung sicher bestehen', ' – Prüfungstraining für Berufsschulen, IHK & Kammern', 'gi'),
  hero_subline    = regexp_replace(hero_subline,    'Strukturiertes Training für Quereinsteiger und Umschulung', 'Strukturiertes Prüfungstraining für Klassen, Lerngruppen und Kammer-Vorbereitung', 'gi'),
  primary_cta     = CASE WHEN primary_cta ~* 'Umschulung' THEN 'Gruppen-Diagnose-Check starten' ELSE primary_cta END,
  seo_title       = regexp_replace(seo_title,       '\s*Umschulung\s*[–-]\s*Prüfungsvorbereitung', ' für Berufsschulen & Kammern – Prüfungsvorbereitung', 'gi'),
  seo_description = regexp_replace(
                      regexp_replace(seo_description, 'für Umschüler:innen', 'für Berufsschulen, IHK & Kammern', 'gi'),
                      'Aufbau ohne Vorwissen', 'Klassen-Lizenzen, Reporting', 'gi'
                    ),
  updated_at      = now()
WHERE persona_type = 'institution'
  AND active = true
  AND (
       hero_headline   ~* 'umschul'
    OR hero_subline    ~* 'umschul'
    OR primary_cta     ~* 'umschul'
    OR seo_title       ~* 'umschul'
    OR seo_description ~* 'umschul'
  );

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'institution_overlay_copy_refactor_v1',
  'overlay',
  'done',
  jsonb_build_object(
    'rows_total_active', (SELECT count(*) FROM public.product_persona_overlays WHERE persona_type='institution' AND active=true),
    'rows_remaining_with_umschul', (
      SELECT count(*) FROM public.product_persona_overlays
       WHERE persona_type='institution' AND active=true
         AND (hero_headline ~* 'umschul' OR hero_subline ~* 'umschul' OR primary_cta ~* 'umschul'
              OR seo_title ~* 'umschul' OR seo_description ~* 'umschul')
    ),
    'note', 'Replaced Umschulung-Copy with Berufsschulen/IHK/Kammern wording'
  )
);