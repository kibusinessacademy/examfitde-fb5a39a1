
-- 1) Schema-Erweiterung
ALTER TABLE public.vertical_dna
  ADD COLUMN IF NOT EXISTS processes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS escalations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS persona_seeds jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2) Deep DNA Seeding — HR
UPDATE public.vertical_dna SET
  roles = ARRAY['HR Business Partner','Recruiter','People Operations Manager','Personalreferent','Personalfachkaufmann/-frau','Ausbilder/Trainer','Betriebsrat-Koordination','Leitung HR'],
  kpis = '[
    {"key":"time_to_hire","label":"Time-to-Hire","unit":"Tage"},
    {"key":"quality_of_hire","label":"Quality-of-Hire (90d)","unit":"%"},
    {"key":"offer_accept_rate","label":"Offer-Acceptance-Rate","unit":"%"},
    {"key":"onboarding_completion","label":"Onboarding-Completion 30d","unit":"%"},
    {"key":"voluntary_attrition","label":"Freiwillige Fluktuation","unit":"%"},
    {"key":"engagement_score","label":"Engagement Score","unit":"pt"},
    {"key":"documentation_compliance","label":"Personalakten-Vollständigkeit","unit":"%"}
  ]'::jsonb,
  pain_points = '[
    {"key":"long_hiring_cycles","label":"Zu lange Recruiting-Zyklen","severity":"high"},
    {"key":"interview_inconsistency","label":"Uneinheitliche Interviewführung","severity":"medium"},
    {"key":"documentation_gaps","label":"Lückenhafte Personalakten / DSGVO-Risiko","severity":"high"},
    {"key":"performance_review_chaos","label":"Performance-Reviews unstrukturiert","severity":"medium"},
    {"key":"works_council_friction","label":"Reibung mit Betriebsrat","severity":"medium"},
    {"key":"onboarding_fragmented","label":"Fragmentiertes Onboarding","severity":"medium"},
    {"key":"conflict_escalation","label":"Konfliktgespräche ohne Dokumentation","severity":"high"}
  ]'::jsonb,
  risks = '[
    {"key":"discrimination_claims","label":"Diskriminierungsrisiko (AGG)","severity":"high"},
    {"key":"data_protection","label":"DSGVO bei Bewerbungs- und Mitarbeiterdaten","severity":"high"},
    {"key":"works_council_codetermination","label":"Mitbestimmungsverletzung (BetrVG)","severity":"high"},
    {"key":"misclassification","label":"Scheinselbständigkeit / Statusfeststellung","severity":"medium"},
    {"key":"termination_legality","label":"Unwirksame Kündigung (KSchG)","severity":"high"}
  ]'::jsonb,
  processes = '[
    {"key":"recruiting","label":"Recruiting & Sourcing"},
    {"key":"interviewing","label":"Strukturierte Interviewführung"},
    {"key":"skill_assessment","label":"Skill- und Kompetenzbewertung"},
    {"key":"offer_management","label":"Angebots- und Vertragsmanagement"},
    {"key":"onboarding","label":"Onboarding (0/30/60/90)"},
    {"key":"performance_review","label":"Performance- und Entwicklungsgespräche"},
    {"key":"conflict_management","label":"Konfliktgespräche & Mediation"},
    {"key":"termination","label":"Trennungsprozesse & Offboarding"},
    {"key":"works_council_liaison","label":"Betriebsratskommunikation"},
    {"key":"compensation_review","label":"Compensation- und Benefits-Review"}
  ]'::jsonb,
  documents = '[
    {"key":"job_description","label":"Stellenbeschreibung"},
    {"key":"interview_protocol","label":"Interview-Protokoll"},
    {"key":"employment_contract","label":"Arbeitsvertrag"},
    {"key":"performance_review_doc","label":"Beurteilungsbogen"},
    {"key":"conflict_memo","label":"Konfliktgesprächs-Memo"},
    {"key":"warning_letter","label":"Abmahnung"},
    {"key":"termination_notice","label":"Kündigungsschreiben"},
    {"key":"works_council_consultation","label":"BR-Anhörung §99/§102 BetrVG"},
    {"key":"personnel_file","label":"Personalakte"},
    {"key":"reference_letter","label":"Arbeitszeugnis"}
  ]'::jsonb,
  workflow_types = '[
    {"key":"hiring_loop","label":"Hiring-Loop (Sourcing → Offer)"},
    {"key":"onboarding_journey","label":"Onboarding-Journey"},
    {"key":"performance_cycle","label":"Performance-Zyklus"},
    {"key":"conflict_resolution","label":"Konfliktlösungs-Workflow"},
    {"key":"separation_workflow","label":"Trennungs-Workflow inkl. BR"},
    {"key":"compliance_audit","label":"Personalakten-Audit"}
  ]'::jsonb,
  escalations = '[
    {"key":"agg_complaint","label":"AGG-Beschwerde","route":"Compliance + Legal"},
    {"key":"works_council_objection","label":"BR-Widerspruch §99","route":"Legal + HR-Leitung"},
    {"key":"performance_pip","label":"PIP nach 2 negativen Reviews","route":"HRBP + Manager"},
    {"key":"data_breach","label":"Personaldaten-Leak","route":"DSB + IT-Security"},
    {"key":"termination_dispute","label":"Kündigungsschutzklage","route":"Legal"}
  ]'::jsonb,
  outcomes = '[
    {"key":"time_to_hire_reduction","label":"Time-to-Hire Reduktion","impact":"hoch"},
    {"key":"interview_quality_lift","label":"Interview-Qualität & Konsistenz","impact":"hoch"},
    {"key":"documentation_quality","label":"Dokumentationsqualität (audit-fest)","impact":"hoch"},
    {"key":"compliance_safety","label":"Compliance-Sicherheit (AGG/BetrVG/DSGVO)","impact":"hoch"},
    {"key":"workflow_speed","label":"Workflow-Beschleunigung HR-Operations","impact":"mittel"},
    {"key":"employee_experience","label":"Employee Experience","impact":"mittel"}
  ]'::jsonb,
  persona_seeds = '[
    {"key":"hrbp_mid","label":"HR Business Partner — Mittelstand 200-500 MA","context":"Drei Standorte, BR aktiv, KPI-getrieben"},
    {"key":"recruiter_volume","label":"Recruiter — Volumen-Hiring","context":"40+ offene Stellen, hoher Druck auf Time-to-Hire"},
    {"key":"hr_lead_konzern","label":"HR-Leitung Konzerntochter","context":"Compliance-Fokus, Tarifvertrag, Mitbestimmung"},
    {"key":"people_ops_startup","label":"People Ops — Scale-up 50-150 MA","context":"Aufbauphase, noch wenig Prozess-Struktur"}
  ]'::jsonb
WHERE vertical_slug = 'hr';

-- 3) Deep DNA — Education
UPDATE public.vertical_dna SET
  roles = ARRAY['Ausbilder/-in (AEVO)','Berufsschullehrer/-in','Trainer/Dozent','Bildungsreferent','Lernbegleiter','Prüfer/-in IHK/HWK','Bildungsmanager','Pädagogische Leitung'],
  kpis = '[
    {"key":"learner_progress","label":"Lernfortschritt pro Lernfeld","unit":"%"},
    {"key":"exam_pass_rate","label":"Bestehensquote Prüfung","unit":"%"},
    {"key":"competency_coverage","label":"Kompetenzabdeckung","unit":"%"},
    {"key":"dropout_rate","label":"Abbruchquote","unit":"%"},
    {"key":"feedback_score","label":"Lehrgangs-Feedback","unit":"pt"},
    {"key":"time_to_competency","label":"Time-to-Competency","unit":"Wochen"}
  ]'::jsonb,
  pain_points = '[
    {"key":"heterogenous_levels","label":"Heterogene Lernniveaus in Gruppen","severity":"medium"},
    {"key":"curriculum_alignment","label":"Curriculum vs. Realität verschiebt sich","severity":"medium"},
    {"key":"individual_feedback_load","label":"Individuelles Feedback skaliert nicht","severity":"high"},
    {"key":"dropout_warning_late","label":"Drop-Out-Signale zu spät erkannt","severity":"high"},
    {"key":"exam_alignment","label":"Lehrinhalt ↔ Prüfungsanforderungen","severity":"high"},
    {"key":"documentation_burden","label":"Ausbildungsnachweis-Pflicht","severity":"medium"}
  ]'::jsonb,
  risks = '[
    {"key":"didactic_quality","label":"Didaktische Qualitätsmängel","severity":"medium"},
    {"key":"recognition_loss","label":"Verlust der Anerkennung (Träger/Kammer)","severity":"high"},
    {"key":"data_protection_minors","label":"DSGVO bei Minderjährigen","severity":"high"},
    {"key":"plagiarism","label":"Plagiat / AI-Nutzung undokumentiert","severity":"medium"}
  ]'::jsonb,
  processes = '[
    {"key":"curriculum_planning","label":"Curriculum- & Lernfeld-Planung"},
    {"key":"lesson_design","label":"Unterrichts-/Modul-Design"},
    {"key":"competency_assessment","label":"Kompetenz-Assessment"},
    {"key":"feedback_cycle","label":"Feedback- und Coaching-Zyklus"},
    {"key":"exam_preparation","label":"Prüfungsvorbereitung"},
    {"key":"progress_documentation","label":"Lernfortschritts-Dokumentation"},
    {"key":"recognition_process","label":"Anerkennungs-/Zertifizierungsprozess"}
  ]'::jsonb,
  documents = '[
    {"key":"curriculum","label":"Lehrplan / Curriculum"},
    {"key":"lesson_plan","label":"Unterrichts-/Modulplan"},
    {"key":"assessment_rubric","label":"Bewertungsraster"},
    {"key":"learning_progress_record","label":"Lernfortschrittsbericht"},
    {"key":"ausbildungsnachweis","label":"Ausbildungsnachweis (Berichtsheft)"},
    {"key":"exam_protocol","label":"Prüfungsprotokoll"},
    {"key":"certificate","label":"Zertifikat / Zeugnis"}
  ]'::jsonb,
  workflow_types = '[
    {"key":"cohort_launch","label":"Kohorten-Launch"},
    {"key":"weekly_teaching_cycle","label":"Wochen-Lehrzyklus"},
    {"key":"exam_prep_intensive","label":"Prüfungs-Endspurt"},
    {"key":"individual_coaching","label":"Individual-Coaching-Workflow"},
    {"key":"drop_out_intervention","label":"Drop-Out-Intervention"},
    {"key":"certification_pipeline","label":"Zertifizierungs-Pipeline"}
  ]'::jsonb,
  escalations = '[
    {"key":"dropout_risk","label":"Drop-Out-Risiko erkannt","route":"Lernbegleitung + Eltern/Betrieb"},
    {"key":"failed_assessment","label":"Wiederholt nicht bestanden","route":"Pädagogische Leitung"},
    {"key":"misconduct","label":"Plagiat/Täuschung","route":"Prüfungsausschuss"},
    {"key":"missing_nachweis","label":"Fehlender Ausbildungsnachweis","route":"Ausbildungsleitung"}
  ]'::jsonb,
  outcomes = '[
    {"key":"pass_rate_lift","label":"Höhere Bestehensquote","impact":"hoch"},
    {"key":"competency_coverage","label":"Bessere Kompetenzabdeckung","impact":"hoch"},
    {"key":"time_to_competency","label":"Schnellere Time-to-Competency","impact":"hoch"},
    {"key":"individual_feedback_scale","label":"Skalierbares Individual-Feedback","impact":"hoch"},
    {"key":"documentation_quality","label":"Dokumentationsqualität","impact":"mittel"},
    {"key":"dropout_reduction","label":"Drop-Out-Reduktion","impact":"hoch"}
  ]'::jsonb,
  persona_seeds = '[
    {"key":"ausbilder_handwerk","label":"Ausbilder/-in Handwerksbetrieb","context":"AEVO, 3-5 Azubis, knappe Zeit"},
    {"key":"trainer_b2b","label":"B2B-Trainer/Dozent","context":"Inhouse-Trainings, gemischte Vorerfahrung"},
    {"key":"berufsschullehrer","label":"Berufsschullehrer/-in","context":"Vollzeitklasse, Curriculum-Druck"},
    {"key":"bildungsmanager","label":"Bildungsmanager Bildungsträger","context":"Mehrere Kohorten parallel, Förder-Reporting"}
  ]'::jsonb
WHERE vertical_slug = 'education';

-- 4) Deep DNA — Support
UPDATE public.vertical_dna SET
  roles = ARRAY['Support Agent (1st Level)','Senior Support (2nd Level)','Tech Lead Support','Teamleitung Support','Quality Manager','Knowledge Manager','Customer Success Manager','Eskalationsmanager'],
  kpis = '[
    {"key":"first_response_time","label":"First-Response-Time","unit":"min"},
    {"key":"resolution_time","label":"Resolution-Time","unit":"h"},
    {"key":"first_contact_resolution","label":"First-Contact-Resolution","unit":"%"},
    {"key":"csat","label":"CSAT","unit":"pt"},
    {"key":"sla_compliance","label":"SLA-Einhaltung","unit":"%"},
    {"key":"escalation_rate","label":"Eskalationsquote","unit":"%"},
    {"key":"ticket_backlog","label":"Ticket-Backlog","unit":"Tickets"},
    {"key":"deflection_rate","label":"Self-Service-Deflection","unit":"%"}
  ]'::jsonb,
  pain_points = '[
    {"key":"repetitive_tickets","label":"Hoher Anteil repetitiver Tickets","severity":"high"},
    {"key":"knowledge_silos","label":"Wissens-Silos zwischen Levels","severity":"high"},
    {"key":"sla_misses","label":"SLA-Verfehlungen bei Peak","severity":"high"},
    {"key":"inconsistent_answers","label":"Inkonsistente Antworten","severity":"medium"},
    {"key":"escalation_overhead","label":"Eskalation-Overhead L1→L2","severity":"medium"},
    {"key":"documentation_drift","label":"Knowledge-Base veraltet","severity":"high"}
  ]'::jsonb,
  risks = '[
    {"key":"sla_penalty","label":"SLA-Pönalen / Vertragsstrafen","severity":"high"},
    {"key":"churn","label":"Kundenchurn durch schlechten Support","severity":"high"},
    {"key":"data_leak","label":"Versehentliche Datenoffenlegung","severity":"high"},
    {"key":"misadvice","label":"Falschauskunft mit Haftungsfolge","severity":"medium"}
  ]'::jsonb,
  processes = '[
    {"key":"ticket_triage","label":"Ticket-Triage & Routing"},
    {"key":"first_response","label":"First-Response-Workflow"},
    {"key":"diagnosis","label":"Diagnose & Root-Cause"},
    {"key":"resolution","label":"Lösungs-Erstellung"},
    {"key":"escalation","label":"Eskalation L1→L2→L3"},
    {"key":"knowledge_capture","label":"Knowledge-Capture nach Lösung"},
    {"key":"qa_review","label":"QA-Review von Tickets"},
    {"key":"sla_monitoring","label":"SLA-Monitoring"}
  ]'::jsonb,
  documents = '[
    {"key":"ticket","label":"Ticket / Fall"},
    {"key":"response_template","label":"Antwort-Template"},
    {"key":"kb_article","label":"Knowledge-Base-Artikel"},
    {"key":"runbook","label":"Runbook"},
    {"key":"escalation_brief","label":"Eskalations-Brief"},
    {"key":"post_mortem","label":"Incident Post-Mortem"},
    {"key":"sla_report","label":"SLA-Report"}
  ]'::jsonb,
  workflow_types = '[
    {"key":"daily_triage","label":"Daily Triage Loop"},
    {"key":"high_volume_response","label":"High-Volume-Response (Standard)"},
    {"key":"complex_diagnosis","label":"Komplexe Diagnose"},
    {"key":"escalation_handoff","label":"Eskalations-Handoff"},
    {"key":"kb_refresh","label":"Knowledge-Refresh"},
    {"key":"qa_loop","label":"QA-Review-Loop"}
  ]'::jsonb,
  escalations = '[
    {"key":"sla_breach_imminent","label":"SLA-Bruch droht","route":"Teamleitung + Customer Success"},
    {"key":"vip_customer","label":"VIP/Key-Account-Issue","route":"CSM + Eskalationsmanager"},
    {"key":"security_incident","label":"Security-relevanter Vorfall","route":"Security-Team"},
    {"key":"legal_complaint","label":"Rechtliche Drohung","route":"Legal"}
  ]'::jsonb,
  outcomes = '[
    {"key":"support_reduction","label":"Support-Volumen-Reduktion","impact":"hoch"},
    {"key":"sla_optimization","label":"SLA-Optimierung","impact":"hoch"},
    {"key":"first_contact_resolution","label":"FCR-Steigerung","impact":"hoch"},
    {"key":"documentation_quality","label":"KB-Qualität & Aktualität","impact":"hoch"},
    {"key":"workflow_speed","label":"Workflow-Speed pro Ticket","impact":"hoch"},
    {"key":"customer_satisfaction","label":"CSAT-Anstieg","impact":"hoch"},
    {"key":"escalation_reduction","label":"Eskalationsreduktion","impact":"mittel"}
  ]'::jsonb,
  persona_seeds = '[
    {"key":"l1_agent","label":"L1 Support Agent","context":"Hoher Volumen-Druck, viele Standardfälle"},
    {"key":"l2_senior","label":"Senior Support (L2)","context":"Komplexe Fälle, Knowledge-Owner"},
    {"key":"support_lead","label":"Teamleitung Support 8-20 Agents","context":"SLA-Verantwortung, Backlog-Druck"},
    {"key":"csm_enterprise","label":"Customer Success Manager Enterprise","context":"VIP-Account, Eskalations-Owner"}
  ]'::jsonb
WHERE vertical_slug = 'support';

-- 5) Deep DNA — Banking
UPDATE public.vertical_dna SET
  roles = ARRAY['Bankkaufmann/-frau','Kundenberater Privatkunden','Firmenkundenbetreuer','Kreditanalyst','Compliance Officer','Risk Manager','Geldwäsche-Beauftragter (GWB)','Auditor / Innenrevision','Wertpapierberater','Investmentfondskaufmann'],
  kpis = '[
    {"key":"loan_decision_time","label":"Kreditentscheidungs-Zeit","unit":"Tage"},
    {"key":"risk_rating_quality","label":"Risiko-Rating-Qualität","unit":"pt"},
    {"key":"compliance_findings","label":"Compliance-Findings pro Audit","unit":"Anzahl"},
    {"key":"kyc_completion","label":"KYC-Vollständigkeit","unit":"%"},
    {"key":"aml_alert_resolution","label":"AML-Alert-Bearbeitung","unit":"h"},
    {"key":"customer_advisory_quality","label":"Beratungs-Qualität (WpHG)","unit":"pt"},
    {"key":"npl_ratio","label":"Non-Performing-Loan-Quote","unit":"%"},
    {"key":"audit_trail_completeness","label":"Audit-Trail-Vollständigkeit","unit":"%"}
  ]'::jsonb,
  pain_points = '[
    {"key":"regulatory_complexity","label":"BaFin/MaRisk/WpHG-Komplexität","severity":"high"},
    {"key":"documentation_burden","label":"Dokumentationspflicht-Last","severity":"high"},
    {"key":"kyc_friction","label":"KYC-Onboarding-Friction","severity":"high"},
    {"key":"approval_chains","label":"Lange Genehmigungs-Ketten","severity":"medium"},
    {"key":"manual_compliance_checks","label":"Manuelle Compliance-Prüfungen","severity":"high"},
    {"key":"siloed_risk_data","label":"Risiko-Daten in Silos","severity":"medium"}
  ]'::jsonb,
  risks = '[
    {"key":"aml_violation","label":"Geldwäsche-Verstoß (GwG)","severity":"high"},
    {"key":"bafin_finding","label":"BaFin-Beanstandung","severity":"high"},
    {"key":"missold_advice","label":"Falschberatung (WpHG)","severity":"high"},
    {"key":"data_breach","label":"Bankgeheimnis-Verletzung","severity":"high"},
    {"key":"credit_default","label":"Kreditausfall durch fehlerhafte Bonität","severity":"high"},
    {"key":"sanction_breach","label":"Sanktions-Listen-Verstoß","severity":"high"}
  ]'::jsonb,
  processes = '[
    {"key":"kyc_onboarding","label":"KYC-Kunden-Onboarding"},
    {"key":"loan_application","label":"Kreditantragsprozess"},
    {"key":"credit_decision","label":"Kreditentscheidung & Vier-Augen-Prinzip"},
    {"key":"investment_advisory","label":"Anlageberatung (WpHG-konform)"},
    {"key":"aml_monitoring","label":"AML-Transaktionsmonitoring"},
    {"key":"sanctions_screening","label":"Sanktions-Screening"},
    {"key":"compliance_review","label":"Compliance-Review & Audit"},
    {"key":"risk_assessment","label":"Risikobewertung Engagement"},
    {"key":"regulatory_reporting","label":"Aufsichtsrechtliches Reporting"}
  ]'::jsonb,
  documents = '[
    {"key":"kyc_file","label":"KYC-Akte"},
    {"key":"loan_application","label":"Kreditantrag"},
    {"key":"credit_decision_memo","label":"Kreditentscheidungs-Vorlage"},
    {"key":"risk_rating","label":"Risiko-Rating-Bericht"},
    {"key":"advisory_protocol","label":"Beratungsprotokoll (WpHG)"},
    {"key":"aml_sar","label":"Verdachtsmeldung (SAR/GwG)"},
    {"key":"audit_finding","label":"Audit-Finding"},
    {"key":"governance_policy","label":"Governance-/Compliance-Policy"}
  ]'::jsonb,
  workflow_types = '[
    {"key":"kyc_loop","label":"KYC-Loop"},
    {"key":"loan_approval_chain","label":"Kreditgenehmigungs-Kette"},
    {"key":"advisory_session","label":"Beratungs-Session WpHG"},
    {"key":"aml_alert_triage","label":"AML-Alert-Triage"},
    {"key":"compliance_audit","label":"Compliance-Audit-Workflow"},
    {"key":"regulatory_report","label":"Regulatorisches Reporting"}
  ]'::jsonb,
  escalations = '[
    {"key":"aml_sar_trigger","label":"AML-Verdacht → SAR","route":"GWB + FIU-Meldung"},
    {"key":"sanctions_hit","label":"Sanktions-Treffer","route":"Compliance + Vorstand"},
    {"key":"bafin_inquiry","label":"BaFin-Anfrage","route":"Compliance + Legal"},
    {"key":"credit_default_signal","label":"Frühwarn-Signal Kreditausfall","route":"Risk + Kreditrevision"},
    {"key":"advisory_complaint","label":"Anlegerbeschwerde","route":"Ombudsmann/Legal"}
  ]'::jsonb,
  outcomes = '[
    {"key":"compliance_safety","label":"Compliance-Sicherheit","impact":"hoch"},
    {"key":"audit_trail_quality","label":"Audit-Trail-Qualität","impact":"hoch"},
    {"key":"governance_clarity","label":"Governance-Klarheit","impact":"hoch"},
    {"key":"loan_decision_speed","label":"Schnellere Kreditentscheidungen","impact":"hoch"},
    {"key":"risk_visibility","label":"Risikotransparenz","impact":"hoch"},
    {"key":"documentation_quality","label":"Dokumentationsqualität","impact":"hoch"},
    {"key":"regulatory_readiness","label":"Aufsichts-Readiness","impact":"hoch"}
  ]'::jsonb,
  persona_seeds = '[
    {"key":"privatkundenberater","label":"Privatkundenberater Filialbank","context":"Beratungspflichten, hohe Frequenz"},
    {"key":"firmenkundenbetreuer","label":"Firmenkundenbetreuer","context":"Mittelstandskredite, Bonitätsanalyse"},
    {"key":"compliance_officer","label":"Compliance Officer","context":"BaFin-Audit-Vorbereitung, MaRisk"},
    {"key":"risk_manager","label":"Risk Manager","context":"Portfolio-Steuerung, NPL-Reporting"},
    {"key":"gwb","label":"Geldwäsche-Beauftragter","context":"AML-Alert-Backlog, SAR-Pipeline"}
  ]'::jsonb
WHERE vertical_slug = 'banking';

-- 6) Deep DNA — Consulting
UPDATE public.vertical_dna SET
  roles = ARRAY['Junior Consultant','Senior Consultant','Manager','Engagement Manager','Partner','Subject Matter Expert','Projektleiter','Business Analyst','Quality Reviewer'],
  kpis = '[
    {"key":"utilization","label":"Utilization Rate","unit":"%"},
    {"key":"realization","label":"Realization Rate","unit":"%"},
    {"key":"project_margin","label":"Projektmarge","unit":"%"},
    {"key":"client_satisfaction","label":"Client Satisfaction","unit":"pt"},
    {"key":"proposal_win_rate","label":"Proposal-Win-Rate","unit":"%"},
    {"key":"on_time_delivery","label":"On-Time-Delivery","unit":"%"},
    {"key":"deliverable_quality","label":"Deliverable-Qualität (QA)","unit":"pt"},
    {"key":"knowledge_reuse","label":"Wissenswiederverwendung","unit":"%"}
  ]'::jsonb,
  pain_points = '[
    {"key":"scope_creep","label":"Scope-Creep","severity":"high"},
    {"key":"knowledge_loss","label":"Wissen verlässt mit Mitarbeitenden","severity":"high"},
    {"key":"deliverable_inconsistency","label":"Inkonsistente Deliverable-Qualität","severity":"medium"},
    {"key":"proposal_overhead","label":"Hoher Proposal-Aufwand","severity":"medium"},
    {"key":"qa_bottleneck","label":"QA-Bottleneck bei Partner","severity":"medium"},
    {"key":"timesheet_friction","label":"Timesheet-Disziplin"},
    {"key":"context_switch","label":"Hoher Context-Switch zwischen Mandaten","severity":"medium"}
  ]'::jsonb,
  risks = '[
    {"key":"liability_claim","label":"Beraterhaftung","severity":"high"},
    {"key":"confidentiality_breach","label":"NDA-Bruch","severity":"high"},
    {"key":"conflict_of_interest","label":"Interessenkonflikt zwischen Mandaten","severity":"high"},
    {"key":"reputation_damage","label":"Reputationsschaden bei Fehl-Deliverable","severity":"high"}
  ]'::jsonb,
  processes = '[
    {"key":"opportunity_qualification","label":"Opportunity-Qualifizierung"},
    {"key":"proposal_creation","label":"Proposal-Erstellung"},
    {"key":"engagement_setup","label":"Engagement-Setup"},
    {"key":"discovery","label":"Discovery & Interviews"},
    {"key":"analysis","label":"Analyse & Hypothesen"},
    {"key":"deliverable_production","label":"Deliverable-Produktion"},
    {"key":"qa_review","label":"QA-Review (Partner-Check)"},
    {"key":"client_presentation","label":"Client-Präsentation"},
    {"key":"engagement_closeout","label":"Engagement-Closeout & Knowledge-Capture"}
  ]'::jsonb,
  documents = '[
    {"key":"proposal","label":"Proposal / SOW"},
    {"key":"engagement_letter","label":"Engagement Letter"},
    {"key":"interview_notes","label":"Interview-Notes"},
    {"key":"workstream_status","label":"Workstream-Status"},
    {"key":"deliverable_deck","label":"Deliverable-Deck"},
    {"key":"qa_checklist","label":"QA-Checkliste"},
    {"key":"steerco_minutes","label":"SteerCo-Minutes"},
    {"key":"final_report","label":"Final Report"},
    {"key":"lessons_learned","label":"Lessons-Learned-Doc"}
  ]'::jsonb,
  workflow_types = '[
    {"key":"proposal_loop","label":"Proposal-Loop"},
    {"key":"discovery_sprint","label":"Discovery-Sprint"},
    {"key":"analysis_cycle","label":"Analyse-Zyklus"},
    {"key":"deliverable_factory","label":"Deliverable-Factory"},
    {"key":"steerco_cycle","label":"SteerCo-Zyklus"},
    {"key":"knowledge_harvest","label":"Knowledge-Harvest nach Engagement"}
  ]'::jsonb,
  escalations = '[
    {"key":"scope_change_request","label":"Scope-Change > Schwellwert","route":"Engagement Manager + Partner"},
    {"key":"client_dissatisfaction","label":"Client-Unzufriedenheit","route":"Partner"},
    {"key":"deliverable_quality_fail","label":"QA fällt durch","route":"Senior + Partner"},
    {"key":"conflict_of_interest","label":"COI erkannt","route":"Risk/Legal"},
    {"key":"timeline_slip","label":"Timeline-Slip > 10%","route":"Engagement Manager"}
  ]'::jsonb,
  outcomes = '[
    {"key":"workflow_speed","label":"Workflow-Beschleunigung","impact":"hoch"},
    {"key":"deliverable_quality","label":"Deliverable-Qualität","impact":"hoch"},
    {"key":"knowledge_reuse","label":"Wissens-Wiederverwendung","impact":"hoch"},
    {"key":"proposal_speed","label":"Proposal-Beschleunigung","impact":"hoch"},
    {"key":"utilization_lift","label":"Utilization-Lift","impact":"mittel"},
    {"key":"margin_protection","label":"Marge-Schutz vs. Scope-Creep","impact":"hoch"},
    {"key":"outcome_visibility","label":"Outcome-Transparenz beim Mandant","impact":"hoch"}
  ]'::jsonb,
  persona_seeds = '[
    {"key":"senior_consultant","label":"Senior Consultant","context":"Workstream-Lead, 2-3 Mandate parallel"},
    {"key":"engagement_manager","label":"Engagement Manager","context":"Multi-Workstream-Steuerung, P&L pro Engagement"},
    {"key":"partner","label":"Partner","context":"Mehrere Engagements, QA-Verantwortung, Sales"},
    {"key":"boutique_owner","label":"Boutique-Inhaber 5-15 Berater","context":"Operationale Nähe, Knowledge-Owner"}
  ]'::jsonb
WHERE vertical_slug = 'consulting';

-- 7) Additive DNA — Gartenbau (bestehend tiefer + neue Felder)
UPDATE public.vertical_dna SET
  processes = '[
    {"key":"site_assessment","label":"Objekt-/Baustellen-Aufnahme"},
    {"key":"offer_creation","label":"Angebotserstellung"},
    {"key":"deployment_planning","label":"Einsatzplanung (Wetter, Team, Maschinen)"},
    {"key":"material_logistics","label":"Material- und Pflanzenlogistik"},
    {"key":"machine_operation","label":"Maschineneinsatz"},
    {"key":"execution","label":"Baustellenausführung"},
    {"key":"customer_communication","label":"Kundenkommunikation"},
    {"key":"seasonal_planning","label":"Saisonplanung (Frühjahr/Herbst/Winterdienst)"},
    {"key":"post_calculation","label":"Nachkalkulation"},
    {"key":"warranty_handling","label":"Anwuchs-/Gewährleistung"}
  ]'::jsonb,
  documents = '[
    {"key":"site_protocol","label":"Aufmaß-/Aufnahmeprotokoll"},
    {"key":"offer","label":"Angebot"},
    {"key":"deployment_plan","label":"Einsatz-/Wochenplan"},
    {"key":"delivery_note","label":"Lieferschein Pflanzen/Material"},
    {"key":"machine_logbook","label":"Maschinen-Logbuch"},
    {"key":"site_diary","label":"Baustellen-/Tagesbericht"},
    {"key":"invoice","label":"Rechnung & Nachkalkulation"},
    {"key":"warranty_claim","label":"Anwuchs-Reklamation"}
  ]'::jsonb,
  workflow_types = '[
    {"key":"daily_dispatch","label":"Tages-Disposition"},
    {"key":"weather_replan","label":"Wetter-Replanning"},
    {"key":"offer_loop","label":"Angebots-Loop"},
    {"key":"site_execution","label":"Baustellenausführung"},
    {"key":"seasonal_kickoff","label":"Saison-Kickoff Frühjahr"},
    {"key":"winter_service","label":"Winterdienst-Workflow"},
    {"key":"post_calc","label":"Nachkalkulations-Workflow"}
  ]'::jsonb,
  escalations = '[
    {"key":"weather_stop","label":"Wetterbedingter Stopp","route":"Bauleitung + Kunde"},
    {"key":"machine_breakdown","label":"Maschinenausfall","route":"Werkstatt + Dispo"},
    {"key":"customer_complaint","label":"Kundenreklamation","route":"Bauleitung + Geschäftsführung"},
    {"key":"plant_failure","label":"Anwuchsschaden","route":"Bauleitung + Lieferant"},
    {"key":"safety_incident","label":"Arbeitsunfall","route":"SiFa + Geschäftsführung"}
  ]'::jsonb,
  outcomes = '[
    {"key":"workflow_speed","label":"Disposition-Beschleunigung","impact":"hoch"},
    {"key":"weather_resilience","label":"Wetter-Resilienz der Planung","impact":"hoch"},
    {"key":"offer_speed","label":"Schnellere Angebote","impact":"hoch"},
    {"key":"post_calc_accuracy","label":"Bessere Nachkalkulation","impact":"hoch"},
    {"key":"customer_satisfaction","label":"Kundenzufriedenheit","impact":"hoch"},
    {"key":"compliance_safety","label":"Arbeitsschutz-Sicherheit","impact":"mittel"},
    {"key":"documentation_quality","label":"Dokumentationsqualität Baustelle","impact":"mittel"}
  ]'::jsonb,
  persona_seeds = '[
    {"key":"bauleiter_galabau","label":"Bauleiter GaLaBau","context":"3-5 parallele Baustellen, Disposition, Kunde"},
    {"key":"inhaber_klein","label":"Inhaber 5-15 MA","context":"Operational selbst aktiv, Disponent in Personalunion"},
    {"key":"disponent","label":"Disponent/in","context":"Wetter-, Personal- und Maschinendisposition"},
    {"key":"vorarbeiter","label":"Vorarbeiter Baustelle","context":"Tagesleitung, Materialabruf, Dokumentation"}
  ]'::jsonb
WHERE vertical_slug = 'gartenbau';

-- 8) Certification-Mapping — idempotent (entfernt slug zuerst, fügt dann hinzu)
WITH map(slug, vslug) AS (VALUES
  ('personaldienstleistungskaufmann-frau','hr'),
  ('personalfachkaufmann-ihk','hr'),
  ('kaufmann-bueromanagement-ihk','hr'),
  ('aevo','education'),
  ('kaufmann-frau-für-dialogmarketing','support'),
  ('servicefachkraft-für-dialogmarketing','support'),
  ('kaufmann-frau-für-verkehrsservice','support'),
  ('servicekaufmann-frau-im-luftverkehr','support'),
  ('bankkaufmann','banking'),
  ('bankkaufmann-ihk','banking'),
  ('investmentfondskaufmann-frau','banking'),
  ('kaufmann-frau-für-versicherungen-und-finanzanlagen','banking'),
  ('bilanzbuchhalter-ihk','banking'),
  ('controller-ihk','banking'),
  ('betriebswirt-ihk','consulting'),
  ('technischer-betriebswirt-ihk','consulting'),
  ('bilanzbuchhalter-ihk','consulting'),
  ('controller-ihk','consulting'),
  ('fachangestellte-r-für-markt-und-sozialforschung','consulting'),
  ('gärtner-in','gartenbau'),
  ('florist-in','gartenbau'),
  ('forstwirt','gartenbau'),
  ('forstwirt-in','gartenbau'),
  ('landwirt','gartenbau'),
  ('landwirt-in','gartenbau'),
  ('fachkraft-agrarservice','gartenbau')
)
UPDATE public.certification_catalog c
SET vertical_slugs = (
  SELECT ARRAY(
    SELECT DISTINCT unnest(
      array_append(COALESCE(c.vertical_slugs, ARRAY[]::text[]), m.vslug)
    )
  )
)
FROM map m
WHERE c.slug = m.slug;

-- 9) RPC-Erweiterung — gibt jetzt processes/documents/workflow_types/escalations/outcomes/persona_seeds zurück
CREATE OR REPLACE FUNCTION public.get_vertical_occupational_dna(_vertical_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  result JSONB;
BEGIN
  IF _vertical_slug IS NULL OR length(trim(_vertical_slug)) = 0 THEN
    RETURN jsonb_build_object('error', 'vertical_slug_required');
  END IF;

  SELECT * INTO v FROM public.vertical_dna WHERE vertical_slug = _vertical_slug LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'vertical_not_found', 'vertical_slug', _vertical_slug);
  END IF;

  result := jsonb_build_object(
    'vertical', jsonb_build_object(
      'id', v.id,
      'vertical_slug', v.vertical_slug,
      'industry_key', v.industry_key,
      'name', v.name,
      'description', v.description,
      'roles', COALESCE(to_jsonb(v.roles), '[]'::jsonb),
      'kpis', COALESCE(v.kpis, '[]'::jsonb),
      'risks', COALESCE(v.risks, '[]'::jsonb),
      'pain_points', COALESCE(v.pain_points, '[]'::jsonb),
      'sops', COALESCE(v.sops, '[]'::jsonb),
      'regulatory_context', COALESCE(v.regulatory_context, '{}'::jsonb),
      'processes', COALESCE(v.processes, '[]'::jsonb),
      'documents', COALESCE(v.documents, '[]'::jsonb),
      'workflow_types', COALESCE(v.workflow_types, '[]'::jsonb),
      'escalations', COALESCE(v.escalations, '[]'::jsonb),
      'outcomes', COALESCE(v.outcomes, '[]'::jsonb),
      'persona_seeds', COALESCE(v.persona_seeds, '[]'::jsonb)
    ),
    'summary', COALESCE((
      SELECT to_jsonb(s) - 'vertical_slug' - 'vertical_name' - 'industry_key'
      FROM public.v_vertical_occupational_intelligence s
      WHERE s.vertical_slug = v.vertical_slug
    ), '{}'::jsonb),
    'certifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cc.id,
        'slug', cc.slug,
        'title', cc.title,
        'catalog_type', cc.catalog_type,
        'chamber_type', cc.chamber_type,
        'recognition_type', cc.recognition_type,
        'track', cc.track,
        'certification_id', cc.linked_certification_id
      ) ORDER BY cc.title)
      FROM public.certification_catalog cc
      WHERE v.vertical_slug = ANY(cc.vertical_slugs)
    ), '[]'::jsonb),
    'curricula', COALESCE((
      SELECT jsonb_agg(curr ORDER BY curr->>'title')
      FROM (
        SELECT jsonb_build_object(
          'id', cu.id,
          'title', cu.title,
          'status', cu.status,
          'track', cu.track,
          'certification_type', cu.certification_type,
          'learning_field_count', (
            SELECT count(*) FROM public.learning_fields lf WHERE lf.curriculum_id = cu.id
          ),
          'competency_count', (
            SELECT count(*) FROM public.competencies cmp
            JOIN public.learning_fields lf2 ON lf2.id = cmp.learning_field_id
            WHERE lf2.curriculum_id = cu.id
          ),
          'learning_fields', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'code', lf3.code, 'title', lf3.title, 'weight_percent', lf3.weight_percent
            ) ORDER BY lf3.code)
            FROM public.learning_fields lf3 WHERE lf3.curriculum_id = cu.id
          ), '[]'::jsonb)
        ) AS curr
        FROM public.curricula cu
        WHERE cu.certification_id IN (
          SELECT DISTINCT cc.linked_certification_id
          FROM public.certification_catalog cc
          WHERE v.vertical_slug = ANY(cc.vertical_slugs)
            AND cc.linked_certification_id IS NOT NULL
        )
      ) sub
    ), '[]'::jsonb)
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vertical_occupational_dna(TEXT) TO anon, authenticated, service_role;
