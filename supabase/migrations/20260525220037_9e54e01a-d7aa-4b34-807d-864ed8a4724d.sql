
DROP TRIGGER IF EXISTS trg_berufs_ki_snapshot_version ON public.berufs_ki_workflow_definitions;
CREATE TRIGGER trg_berufs_ki_snapshot_version
  AFTER INSERT OR UPDATE ON public.berufs_ki_workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.fn_berufs_ki_snapshot_version();

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS has_workflows_pro boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_workflows_business boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_entitlements_workflows_pro
  ON public.entitlements(user_id) WHERE has_workflows_pro = true;
CREATE INDEX IF NOT EXISTS idx_entitlements_workflows_business
  ON public.entitlements(user_id) WHERE has_workflows_business = true;

INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module)
VALUES
  ('workflow_tier_blocked',     ARRAY['workflow_id','tier_required','tier_actual','user_id','reason'], 1, 'berufs_ki_monetization'),
  ('workflow_run_granted',      ARRAY['workflow_id','tier_required','tier_actual','user_id'],          1, 'berufs_ki_monetization'),
  ('workflow_seed_pro_v1',      ARRAY['workflow_slug','curriculum_id'],                                 1, 'berufs_ki_monetization'),
  ('workflow_seed_business_v1', ARRAY['workflow_slug'],                                                 1, 'berufs_ki_monetization')
ON CONFLICT (action_type) DO NOTHING;

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, curriculum_id, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('bilanzanalyse-erklaeren','Bilanzanalyse Schritt für Schritt','Erklärt eine Bilanz prüfungsgerecht mit Kennzahlen, Liquiditätsgraden und Eigenkapitalquote.',
   'fach','rechnungswesen','eef4bbe6-6c92-4969-941e-af471e86d67f'::uuid,ARRAY['azubi','fachkraft']::text[],'pro',
   '{"fields":[{"key":"bilanz_text","label":"Bilanz (Text/CSV)","type":"textarea","required":true}]}'::jsonb,
   'Du bist Prüfungs-Coach für Bilanzbuchhalter IHK. Antworte streng prüfungsnah, mit Kennzahlen-Formeln und IHK-Vokabular.',
   'Analysiere folgende Bilanz prüfungsgerecht: {{bilanz_text}}','google/gemini-2.5-flash','standard','low','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='pro', curriculum_id=EXCLUDED.curriculum_id, category='fach', updated_at=now();

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, curriculum_id, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('fachgespraech-simulieren','Fachgespräch simulieren','Simuliert ein IHK-Fachgespräch mit Rückfragen, Bewertungsraster und Verbesserungshinweisen.',
   'kommunikation','pruefungssimulation','f5e3403b-1fc6-46b3-a275-8420287f351e'::uuid,ARRAY['azubi']::text[],'pro',
   '{"fields":[{"key":"thema","label":"Thema","type":"text","required":true},{"key":"rolle","label":"Deine Rolle","type":"text","required":false}]}'::jsonb,
   'Du bist IHK-Prüfer im mündlichen Fachgespräch für Industriekaufleute. Stelle realistische Fragen, fordere Begründungen, bewerte mit Schulnoten 1-6.',
   'Starte ein Fachgespräch zum Thema: {{thema}}. Meine Rolle: {{rolle}}','google/gemini-2.5-flash','standard','low','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='pro', curriculum_id=EXCLUDED.curriculum_id, category='kommunikation', updated_at=now();

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, curriculum_id, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('kundenreklamation-beantworten','Kundenreklamation professionell beantworten','Erzeugt eine kaufmännisch korrekte, kulante Reklamationsantwort nach BGB-Mängelhaftung.',
   'kommunikation','kundenkorrespondenz','f5e3403b-1fc6-46b3-a275-8420287f351e'::uuid,ARRAY['fachkraft','azubi']::text[],'pro',
   '{"fields":[{"key":"reklamation","label":"Reklamation","type":"textarea","required":true},{"key":"kulanz","label":"Kulanzspielraum","type":"text","required":false}]}'::jsonb,
   'Du bist kaufmännischer Sachbearbeiter. Antworte rechtssicher (BGB §§ 434 ff.), kundenorientiert, mit klarer Lösungszusage.',
   'Reklamation: {{reklamation}}\nKulanz: {{kulanz}}','google/gemini-2.5-flash','standard','low','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='pro', curriculum_id=EXCLUDED.curriculum_id, category='kommunikation', updated_at=now();

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, curriculum_id, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('pruefungsgespraech-vorbereiten','IT-Prüfungsgespräch vorbereiten','Bereitet auf das mündliche Prüfungsgespräch FISI vor: typische Fragen, Argumentationsketten, Fachvokabular.',
   'fach','pruefungsvorbereitung','96d0fb31-9951-408d-a83e-b2937f5a6af8'::uuid,ARRAY['azubi']::text[],'pro',
   '{"fields":[{"key":"projekt","label":"Abschlussprojekt","type":"textarea","required":true}]}'::jsonb,
   'Du bist Prüfer im IHK-Fachgespräch für Fachinformatiker Systemintegration. Stelle technische Tiefenfragen.',
   'Mein Abschlussprojekt: {{projekt}}\nStelle mir 5 prüfungsnahe Fragen.','google/gemini-2.5-flash','standard','low','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='pro', curriculum_id=EXCLUDED.curriculum_id, category='fach', updated_at=now();

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, curriculum_id, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('geschaeftsvorfall-erklaeren','Geschäftsvorfall steuerlich erklären','Erklärt einen Geschäftsvorfall steuerrechtlich (USt, EStG, GoB) prüfungsnah.',
   'fach','steuerrecht','a9f19137-a004-4850-838a-bdc8f8a705f5'::uuid,ARRAY['azubi','fachkraft']::text[],'pro',
   '{"fields":[{"key":"vorfall","label":"Geschäftsvorfall","type":"textarea","required":true}]}'::jsonb,
   'Du bist Steuerfach-Coach. Antworte strikt nach UStG, EStG, GoB. Nenne Paragraphen.',
   'Erkläre folgenden Geschäftsvorfall: {{vorfall}}','google/gemini-2.5-flash','standard','low','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='pro', curriculum_id=EXCLUDED.curriculum_id, category='fach', updated_at=now();

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, curriculum_id, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('buchungssatz-validieren','Buchungssatz validieren','Prüft Buchungssätze auf Soll/Haben-Korrektheit, Kontenrahmen SKR03/04, USt-Behandlung.',
   'fach','buchhaltung','eef4bbe6-6c92-4969-941e-af471e86d67f'::uuid,ARRAY['azubi','fachkraft']::text[],'pro',
   '{"fields":[{"key":"buchungssatz","label":"Buchungssatz","type":"textarea","required":true},{"key":"kontenrahmen","label":"SKR03/SKR04","type":"text","required":false}]}'::jsonb,
   'Du bist Bilanzbuchhalter-Prüfer. Prüfe Buchungssätze gnadenlos auf Soll/Haben, Kontenklassen, USt.',
   'Buchungssatz: {{buchungssatz}}\nKontenrahmen: {{kontenrahmen}}','google/gemini-2.5-flash','standard','low','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='pro', curriculum_id=EXCLUDED.curriculum_id, category='fach', updated_at=now();

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('ausbildungsfeedback-generieren','Ausbildungsfeedback generieren','Erzeugt strukturiertes Ausbildungsfeedback für Auszubildende aus Leistungsdaten.',
   'organisation','ausbildung',ARRAY['ausbilder','fuehrungskraft']::text[],'business',
   '{"fields":[{"key":"azubi_name","label":"Name","type":"text","required":true},{"key":"leistungsdaten","label":"Leistungsdaten","type":"textarea","required":true}]}'::jsonb,
   'Du bist erfahrener Ausbildungsleiter. Schreibe professionelle, faire, motivierende Feedback-Bögen nach AEVO-Standards.',
   'Azubi: {{azubi_name}}\nDaten: {{leistungsdaten}}','google/gemini-2.5-pro','regulated','medium','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='business', category='organisation', updated_at=now();

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('kompetenzluecken-aggregieren','Kompetenzlücken-Report (Team)','Aggregiert Schwächen im Team auf Kompetenzcluster-Ebene mit Handlungsempfehlung.',
   'analyse','team',ARRAY['ausbilder','fuehrungskraft']::text[],'business',
   '{"fields":[{"key":"team_daten","label":"Team-Daten","type":"textarea","required":true}]}'::jsonb,
   'Du bist HR-Analyst. Identifiziere systematische Kompetenzlücken, priorisiere nach Geschäftsrelevanz.',
   'Team-Daten: {{team_daten}}','google/gemini-2.5-pro','regulated','medium','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='business', category='analyse', updated_at=now();

INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, target_roles, tier_required, input_schema, system_prompt, user_prompt_template, model_recommendation, compliance_level, risk_level, workflow_class)
VALUES
  ('team-readiness-report','Team Prüfungs-Readiness Report','Erstellt einen Readiness-Report mit Risikoampel pro Azubi und Maßnahmen.',
   'analyse','team',ARRAY['ausbilder','fuehrungskraft']::text[],'business',
   '{"fields":[{"key":"pruefungstermin","label":"Termin","type":"text","required":true},{"key":"team_status","label":"Status","type":"textarea","required":true}]}'::jsonb,
   'Du bist Bildungs-Controller. Erstelle Readiness-Reports mit Ampelsystem, Risiken, Maßnahmen pro Person.',
   'Prüfung: {{pruefungstermin}}\nStatus: {{team_status}}','google/gemini-2.5-pro','regulated','medium','official')
ON CONFLICT (slug) DO UPDATE SET tier_required='business', category='analyse', updated_at=now();

CREATE OR REPLACE VIEW public.v_workflow_daily_usage AS
SELECT r.user_id, r.workflow_id, d.slug AS workflow_slug, d.tier_required,
       (r.created_at AT TIME ZONE 'UTC')::date AS run_date, COUNT(*) AS runs_count
FROM public.berufs_ki_workflow_runs r
JOIN public.berufs_ki_workflow_definitions d ON d.id = r.workflow_id
WHERE r.status IN ('ok','running')
GROUP BY r.user_id, r.workflow_id, d.slug, d.tier_required, (r.created_at AT TIME ZONE 'UTC')::date;

REVOKE ALL ON public.v_workflow_daily_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_workflow_daily_usage TO service_role;

CREATE OR REPLACE FUNCTION public.fn_workflow_tier_check(_user_id uuid, _workflow_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tier_required text; v_workflow_slug text;
  v_has_pro boolean := false; v_has_business boolean := false;
  v_daily_limit int; v_runs_today int; v_actual_tier text;
BEGIN
  SELECT tier_required, slug INTO v_tier_required, v_workflow_slug
  FROM public.berufs_ki_workflow_definitions WHERE id=_workflow_id AND is_active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'reason','workflow_not_found_or_inactive'); END IF;

  SELECT COALESCE(bool_or(COALESCE(has_workflows_pro,false)),false),
         COALESCE(bool_or(COALESCE(has_workflows_business,false)),false)
  INTO v_has_pro, v_has_business FROM public.entitlements
  WHERE user_id=_user_id
    AND (valid_until IS NULL OR valid_until > now())
    AND (valid_from IS NULL OR valid_from <= now());

  v_actual_tier := CASE WHEN v_has_business THEN 'business' WHEN v_has_pro THEN 'pro' ELSE 'free' END;

  IF v_tier_required='business' AND v_actual_tier<>'business' THEN
    RETURN jsonb_build_object('allowed',false,'reason','tier_insufficient','tier_required',v_tier_required,'tier_actual',v_actual_tier,'upgrade_target','business','workflow_slug',v_workflow_slug);
  END IF;
  IF v_tier_required='pro' AND v_actual_tier='free' THEN
    RETURN jsonb_build_object('allowed',false,'reason','tier_insufficient','tier_required',v_tier_required,'tier_actual',v_actual_tier,'upgrade_target','pro','workflow_slug',v_workflow_slug);
  END IF;

  v_daily_limit := CASE v_actual_tier WHEN 'business' THEN 999999 WHEN 'pro' THEN 50 ELSE 3 END;
  SELECT COUNT(*) INTO v_runs_today FROM public.berufs_ki_workflow_runs
  WHERE user_id=_user_id AND workflow_id=_workflow_id AND status IN ('ok','running')
    AND created_at >= (now() AT TIME ZONE 'UTC')::date;

  IF v_runs_today >= v_daily_limit THEN
    RETURN jsonb_build_object('allowed',false,'reason','daily_limit_exceeded','tier_required',v_tier_required,'tier_actual',v_actual_tier,'runs_today',v_runs_today,'daily_limit',v_daily_limit,'upgrade_target',CASE WHEN v_actual_tier='free' THEN 'pro' ELSE 'business' END,'workflow_slug',v_workflow_slug);
  END IF;

  RETURN jsonb_build_object('allowed',true,'reason','granted','tier_required',v_tier_required,'tier_actual',v_actual_tier,'runs_today',v_runs_today,'daily_limit',v_daily_limit,'export_allowed',v_actual_tier<>'free','workflow_slug',v_workflow_slug);
END; $$;

REVOKE ALL ON FUNCTION public.fn_workflow_tier_check(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_workflow_tier_check(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_workflow_tier_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_check jsonb;
BEGIN
  IF current_setting('session_replication_role',true)='replica' THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  v_check := public.fn_workflow_tier_check(NEW.user_id, NEW.workflow_id);
  IF (v_check->>'allowed')::boolean = false THEN
    BEGIN
      PERFORM public.fn_emit_audit('workflow_tier_blocked','workflow_run',NEW.workflow_id::text,'blocked',
        jsonb_build_object('workflow_id',NEW.workflow_id,'tier_required',v_check->>'tier_required',
          'tier_actual',COALESCE(v_check->>'tier_actual','free'),'user_id',NEW.user_id,'reason',v_check->>'reason'),
        'fn_guard_workflow_tier_on_insert',NULL);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE EXCEPTION 'WORKFLOW_TIER_BLOCKED: % (required=%, actual=%)',
      v_check->>'reason', v_check->>'tier_required', COALESCE(v_check->>'tier_actual','free') USING ERRCODE='check_violation';
  END IF;
  BEGIN
    PERFORM public.fn_emit_audit('workflow_run_granted','workflow_run',NEW.workflow_id::text,'ok',
      jsonb_build_object('workflow_id',NEW.workflow_id,'tier_required',v_check->>'tier_required',
        'tier_actual',v_check->>'tier_actual','user_id',NEW.user_id),
      'fn_guard_workflow_tier_on_insert',NULL);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NEW.tier_at_run IS NULL THEN NEW.tier_at_run := v_check->>'tier_actual'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_workflow_tier ON public.berufs_ki_workflow_runs;
CREATE TRIGGER trg_guard_workflow_tier BEFORE INSERT ON public.berufs_ki_workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_workflow_tier_on_insert();

CREATE OR REPLACE FUNCTION public.admin_get_workflow_tier_summary()
RETURNS TABLE(tier_required text, workflow_count bigint, total_runs bigint, unique_users bigint, blocked_last_7d bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
  SELECT d.tier_required, COUNT(DISTINCT d.id)::bigint, COUNT(r.id)::bigint, COUNT(DISTINCT r.user_id)::bigint,
    (SELECT COUNT(*)::bigint FROM public.auto_heal_log a
       WHERE a.action_type='workflow_tier_blocked' AND a.created_at > now()-interval '7 days'
         AND a.metadata->>'tier_required'=d.tier_required) AS blocked_last_7d
  FROM public.berufs_ki_workflow_definitions d
  LEFT JOIN public.berufs_ki_workflow_runs r ON r.workflow_id=d.id
  WHERE d.is_active=true GROUP BY d.tier_required ORDER BY d.tier_required;
END; $$;

REVOKE ALL ON FUNCTION public.admin_get_workflow_tier_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_workflow_tier_summary() TO authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT slug, curriculum_id FROM public.berufs_ki_workflow_definitions
    WHERE slug IN ('bilanzanalyse-erklaeren','fachgespraech-simulieren','kundenreklamation-beantworten',
                   'pruefungsgespraech-vorbereiten','geschaeftsvorfall-erklaeren','buchungssatz-validieren') LOOP
    PERFORM public.fn_emit_audit('workflow_seed_pro_v1','workflow_definition',r.slug,'ok',
      jsonb_build_object('workflow_slug',r.slug,'curriculum_id',r.curriculum_id),'cut_bk_act_1_seed',NULL);
  END LOOP;
  FOR r IN SELECT slug FROM public.berufs_ki_workflow_definitions
    WHERE slug IN ('ausbildungsfeedback-generieren','kompetenzluecken-aggregieren','team-readiness-report') LOOP
    PERFORM public.fn_emit_audit('workflow_seed_business_v1','workflow_definition',r.slug,'ok',
      jsonb_build_object('workflow_slug',r.slug),'cut_bk_act_1_seed',NULL);
  END LOOP;
END $$;
