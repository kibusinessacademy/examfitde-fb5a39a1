
-- ============================================================
-- 1) UNIFIED EXAM TARGET: 1000 for ALL tracks
-- 2) AI Tutor limited_exam_mode for EXAM_FIRST
-- 3) track_subtype for future expansion
-- 4) german_certification_master (Seeding SSOT)
-- ============================================================

-- 1A) Update rollout_control defaults
UPDATE public.rollout_control
SET base_exam_target = 1000
WHERE base_exam_target = 600;

-- 1B) Add track_subtype to course_packages
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'course_packages' AND column_name = 'track_subtype'
  ) THEN
    ALTER TABLE public.course_packages ADD COLUMN track_subtype text;
  END IF;
END $$;

COMMENT ON COLUMN public.course_packages.track_subtype IS
  'Future: simulation_only, simulation_plus_oral, simulation_plus_case_studies, presentation_plus_oral';

-- 1C) Update derive_feature_flags: has_ai_tutor=true for EXAM_FIRST with limited_exam mode
CREATE OR REPLACE FUNCTION public.derive_feature_flags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.track IS NULL THEN
    IF NEW.certification_type = 'ausbildung' THEN
      NEW.track := 'AUSBILDUNG_VOLL';
    ELSE
      NEW.track := 'EXAM_FIRST';
    END IF;
  END IF;

  IF NEW.feature_flags IS NULL OR NEW.feature_flags = '{}'::jsonb THEN
    IF NEW.track = 'AUSBILDUNG_VOLL' THEN
      NEW.feature_flags := jsonb_build_object(
        'has_learning_course', true,
        'has_practice_course_h5p', true,
        'has_minichecks', true,
        'has_exam_trainer', true,
        'has_exam_simulation', true,
        'has_oral_exam_trainer', true,
        'has_ai_tutor', true,
        'has_handbook', true,
        'ai_tutor_mode', 'full'
      );
    ELSE
      NEW.feature_flags := jsonb_build_object(
        'has_learning_course', false,
        'has_practice_course_h5p', false,
        'has_minichecks', false,
        'has_exam_trainer', true,
        'has_exam_simulation', true,
        'has_oral_exam_trainer', false,
        'has_ai_tutor', true,
        'has_handbook', false,
        'ai_tutor_mode', 'limited_exam'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4) GERMAN CERTIFICATION MASTER
-- ============================================================
CREATE TABLE IF NOT EXISTS public.german_certification_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  cluster text NOT NULL CHECK (cluster IN (
    'ihk_aufstieg', 'sachkunde', 'meister_hwk', 'aevo', 'projektmanagement', 'tuev_branche'
  )),
  traeger text NOT NULL DEFAULT 'IHK',
  certification_type text NOT NULL DEFAULT 'fortbildung_ihk',
  track text NOT NULL DEFAULT 'EXAM_FIRST',
  track_subtype text,
  pruefungsart text NOT NULL DEFAULT 'schriftlich' CHECK (pruefungsart IN (
    'schriftlich', 'muendlich', 'gemischt', 'projekt_plus_fachgespraech'
  )),
  pruefungsteile jsonb DEFAULT '[]'::jsonb,
  gewichtung_teile jsonb DEFAULT '{}'::jsonb,
  oral_required boolean NOT NULL DEFAULT false,
  oral_structure jsonb,
  case_study_required boolean NOT NULL DEFAULT false,
  presentation_required boolean NOT NULL DEFAULT false,
  min_fragen_target integer NOT NULL DEFAULT 1000,
  exam_blueprint_config jsonb DEFAULT '{"mc_percentage":70,"case_percentage":20,"calculation_percentage":10,"difficulty_distribution":{"leicht":3,"mittel":30,"schwer":50,"sehr_schwer":17}}'::jsonb,
  oral_target_scenarios integer DEFAULT 0,
  quality_gates jsonb DEFAULT '{"duplicate_max_pct":3,"coverage_min_pct":80,"confidence_min":88,"governance_min":85,"low_confidence_max_pct":8}'::jsonb,
  marktgroesse text CHECK (marktgroesse IN ('klein', 'mittel', 'gross', 'sehr_gross')),
  jahres_teilnehmer integer,
  lehrgang_preis_range text,
  wettbewerb_level text CHECK (wettbewerb_level IN ('niedrig', 'mittel', 'hoch')),
  rezertifizierung_pflicht boolean DEFAULT false,
  rezertifizierung_intervall_monate integer,
  seeding_status text NOT NULL DEFAULT 'pending' CHECK (seeding_status IN (
    'pending', 'rahmenplan_ingested', 'blueprints_ready', 'generating', 'review', 'live'
  )),
  priority_rank integer,
  wave integer DEFAULT 1,
  package_id uuid,
  rahmenplan_url text,
  pruefungsordnung_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.german_certification_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access certification_master"
  ON public.german_certification_master FOR ALL
  USING (true) WITH CHECK (true);

-- Seed strategic certifications
INSERT INTO public.german_certification_master 
  (name, cluster, traeger, certification_type, track, pruefungsart, oral_required, case_study_required, min_fragen_target, marktgroesse, wettbewerb_level, priority_rank, wave, oral_target_scenarios)
VALUES
  ('Wirtschaftsfachwirt IHK', 'ihk_aufstieg', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 1200, 'sehr_gross', 'mittel', 1, 1, 40),
  ('Handelsfachwirt IHK', 'ihk_aufstieg', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 1200, 'sehr_gross', 'mittel', 2, 1, 40),
  ('Industriefachwirt IHK', 'ihk_aufstieg', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 1200, 'gross', 'mittel', 3, 1, 40),
  ('Technischer Fachwirt IHK', 'ihk_aufstieg', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 1200, 'gross', 'mittel', 4, 1, 40),
  ('Personalfachkaufmann IHK', 'ihk_aufstieg', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, false, 1200, 'gross', 'mittel', 5, 1, 40),
  ('Bilanzbuchhalter IHK', 'ihk_aufstieg', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'schriftlich', false, true, 1300, 'gross', 'niedrig', 6, 1, 0),
  ('Betriebswirt IHK', 'ihk_aufstieg', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 1200, 'gross', 'mittel', 7, 1, 40),
  ('Immobilienmakler §34c', 'sachkunde', 'IHK', 'sachkunde', 'EXAM_FIRST', 'schriftlich', false, false, 1000, 'sehr_gross', 'hoch', 8, 1, 0),
  ('Versicherungsvermittler §34d', 'sachkunde', 'IHK', 'sachkunde', 'EXAM_FIRST', 'schriftlich', false, false, 1000, 'gross', 'mittel', 9, 1, 0),
  ('Finanzanlagenvermittler §34f', 'sachkunde', 'IHK', 'sachkunde', 'EXAM_FIRST', 'schriftlich', false, false, 1000, 'gross', 'mittel', 10, 1, 0),
  ('Darlehensvermittler §34i', 'sachkunde', 'IHK', 'sachkunde', 'EXAM_FIRST', 'schriftlich', false, false, 1000, 'mittel', 'niedrig', 11, 1, 0),
  ('Wohnimmobilienverwalter §34c', 'sachkunde', 'IHK', 'sachkunde', 'EXAM_FIRST', 'schriftlich', false, false, 1000, 'mittel', 'niedrig', 12, 1, 0),
  ('Industriemeister Metall IHK', 'meister_hwk', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 1300, 'sehr_gross', 'mittel', 13, 2, 50),
  ('Industriemeister Elektrotechnik IHK', 'meister_hwk', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 1300, 'gross', 'mittel', 14, 2, 50),
  ('Logistikmeister IHK', 'meister_hwk', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 1300, 'gross', 'mittel', 15, 2, 50),
  ('Ausbildereignungsprüfung (AEVO)', 'aevo', 'IHK', 'fortbildung_ihk', 'EXAM_FIRST', 'gemischt', true, true, 900, 'sehr_gross', 'hoch', 16, 2, 50),
  ('Scrum Master (PSM I)', 'projektmanagement', 'Verband', 'projektmanagement', 'EXAM_FIRST', 'schriftlich', false, false, 1200, 'gross', 'hoch', 17, 3, 0),
  ('PRINCE2 Foundation', 'projektmanagement', 'Verband', 'projektmanagement', 'EXAM_FIRST', 'schriftlich', false, false, 1200, 'mittel', 'hoch', 18, 3, 0),
  ('ITIL 4 Foundation', 'projektmanagement', 'Verband', 'projektmanagement', 'EXAM_FIRST', 'schriftlich', false, false, 1200, 'gross', 'hoch', 19, 3, 0),
  ('Qualitätsmanagement-Beauftragter TÜV', 'tuev_branche', 'TÜV', 'branchenzertifikat', 'EXAM_FIRST', 'schriftlich', false, false, 1000, 'gross', 'mittel', 20, 3, 0),
  ('Datenschutzbeauftragter TÜV', 'tuev_branche', 'TÜV', 'branchenzertifikat', 'EXAM_FIRST', 'schriftlich', false, false, 1000, 'gross', 'mittel', 21, 3, 0)
ON CONFLICT DO NOTHING;

CREATE TRIGGER set_certification_master_updated_at
  BEFORE UPDATE ON public.german_certification_master
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
