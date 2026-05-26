create table if not exists public.conversation_os_scenarios (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null unique,
  domain text not null,
  persona text not null,
  scenario_kind text not null,
  title text not null,
  short_pitch text not null,
  situation text not null,
  character_brief jsonb not null default '{}'::jsonb,
  lead_prompts jsonb not null default '[]'::jsonb,
  followup_strategies jsonb not null default '[]'::jsonb,
  scoring_rubric jsonb not null default '{}'::jsonb,
  difficulty text not null default 'medium',
  time_limit_minutes int not null default 15,
  painpoint_keys text[] not null default '{}',
  target_roles text[] not null default '{}',
  competency_themes text[] not null default '{}',
  curriculum_id uuid references public.curricula(id) on delete set null,
  package_id uuid references public.course_packages(id) on delete set null,
  is_premium boolean not null default true,
  status text not null default 'published',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conv_os_scn_domain_persona on public.conversation_os_scenarios(domain, persona) where status = 'published';
create index if not exists idx_conv_os_scn_kind on public.conversation_os_scenarios(scenario_kind) where status = 'published';
create index if not exists idx_conv_os_scn_painpoints on public.conversation_os_scenarios using gin(painpoint_keys);

grant select on public.conversation_os_scenarios to anon, authenticated;
grant all on public.conversation_os_scenarios to service_role;

alter table public.conversation_os_scenarios enable row level security;

drop policy if exists "conv_os_scn_public_read_published" on public.conversation_os_scenarios;
create policy "conv_os_scn_public_read_published" on public.conversation_os_scenarios
  for select to anon, authenticated using (status = 'published');

drop policy if exists "conv_os_scn_admin_write" on public.conversation_os_scenarios;
create policy "conv_os_scn_admin_write" on public.conversation_os_scenarios
  for all to authenticated using (has_role(auth.uid(),'admin')) with check (has_role(auth.uid(),'admin'));

drop policy if exists "conv_os_scn_service_all" on public.conversation_os_scenarios;
create policy "conv_os_scn_service_all" on public.conversation_os_scenarios
  for all to service_role using (true) with check (true);

create or replace function public.public_list_conversation_os_scenarios(
  _domain text default null, _persona text default null, _limit int default 24
)
returns table (
  id uuid, scenario_key text, domain text, persona text, scenario_kind text,
  title text, short_pitch text, difficulty text, time_limit_minutes int,
  painpoint_keys text[], target_roles text[], is_premium boolean
)
language sql stable security definer set search_path = public as $$
  select s.id, s.scenario_key, s.domain, s.persona, s.scenario_kind, s.title, s.short_pitch,
         s.difficulty, s.time_limit_minutes, s.painpoint_keys, s.target_roles, s.is_premium
  from public.conversation_os_scenarios s
  where s.status = 'published'
    and (_domain is null or s.domain = _domain)
    and (_persona is null or s.persona = _persona)
  order by s.is_premium desc, s.difficulty, s.title
  limit greatest(1, least(coalesce(_limit, 24), 100));
$$;
grant execute on function public.public_list_conversation_os_scenarios(text, text, int) to anon, authenticated;

create or replace function public.public_get_conversation_os_scenario(_scenario_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'id', s.id, 'scenario_key', s.scenario_key, 'domain', s.domain, 'persona', s.persona,
    'scenario_kind', s.scenario_kind, 'title', s.title, 'short_pitch', s.short_pitch,
    'situation', s.situation, 'character_brief', s.character_brief,
    'lead_prompts_preview', (s.lead_prompts -> 0),
    'difficulty', s.difficulty, 'time_limit_minutes', s.time_limit_minutes,
    'painpoint_keys', s.painpoint_keys, 'target_roles', s.target_roles,
    'competency_themes', s.competency_themes, 'is_premium', s.is_premium
  ) into v
  from public.conversation_os_scenarios s
  where s.scenario_key = _scenario_key and s.status = 'published';
  if v is null then return jsonb_build_object('error','not_available'); end if;
  return v;
end;
$$;
grant execute on function public.public_get_conversation_os_scenario(text) to anon, authenticated;

insert into public.ops_audit_contract (action_type, required_keys, owner_module, schema_version) values
  ('conversation_os_scenario_viewed', array['scenario_key','domain']::text[], 'phase_a1_conversation_os', 1),
  ('conversation_os_scenario_started', array['scenario_key','domain','persona']::text[], 'phase_a1_conversation_os', 1),
  ('conversation_os_scenario_completed', array['scenario_key','overall_score']::text[], 'phase_a1_conversation_os', 1),
  ('conversation_os_scenarios_seeded', array['seeded_count','phase']::text[], 'phase_a1_conversation_os', 1)
on conflict (action_type) do nothing;

insert into public.conversation_os_scenarios (scenario_key, domain, persona, scenario_kind, title, short_pitch, situation, character_brief, lead_prompts, followup_strategies, scoring_rubric, difficulty, time_limit_minutes, painpoint_keys, target_roles, competency_themes) values
('hr_job_interview_specialist','hr','recruiter','job_interview','Bewerbungsgespräch · Fachkraft','Strukturierte Erstinterview-Simulation mit STAR-basierter Tiefenbohrung.','Sie sind Bewerber:in für eine Fachkraft-Position. Das Gegenüber ist eine erfahrene Recruiterin, die zunächst freundlich-offen, dann zunehmend kritisch nachfragt.','{"role":"Senior Recruiterin","tone":"professionell, warm, später analytisch","goal":"Fit + Kompetenz validieren"}'::jsonb,'["Stellen Sie sich bitte kurz vor und erzählen Sie, was Sie zu uns geführt hat.","Beschreiben Sie eine berufliche Situation, in der Sie ein komplexes Problem gelöst haben.","Wo sehen Sie sich in drei Jahren — und wie passt diese Rolle dazu?"]'::jsonb,'[{"trigger":"vage_antwort","followup":"Können Sie das an einem konkreten Beispiel zeigen?"},{"trigger":"keine_metriken","followup":"Was war das messbare Ergebnis?"}]'::jsonb,'{"struktur":{"weight":0.25},"fachlichkeit":{"weight":0.25},"selbstreflexion":{"weight":0.2},"kommunikation":{"weight":0.2},"kulturfit":{"weight":0.1}}'::jsonb,'medium',20,array['bewerbungsgespraech','recruiting'],array['Bewerber:in','HR-Manager:in'],array['Kommunikation','Selbstreflexion','STAR-Methodik']),
('hr_salary_negotiation','hr','employee','salary_negotiation','Gehaltsverhandlung · Mitarbeiterseite','Trainiert souveräne Gehaltsforderung mit Marktargumentation und Win-Win-Optionen.','Sie verhandeln mit Ihrer Führungskraft eine Gehaltserhöhung von 12%. Das Gegenüber hat Budget für 6%, ist aber an Ihrer Bindung interessiert.','{"role":"Direkte Führungskraft","tone":"kollegial, budget-konservativ","openings":["Bonus","Weiterbildung","Urlaubstage","Remote-Anteil"]}'::jsonb,'["Sie hatten um dieses Gespräch gebeten — was ist Ihr Anliegen?","Was rechtfertigt aus Ihrer Sicht eine Erhöhung in dieser Größenordnung?","Wenn wir das nicht voll abbilden können — was wäre für Sie ein akzeptabler Kompromiss?"]'::jsonb,'[{"trigger":"keine_zahlen","followup":"Haben Sie Marktdaten?"},{"trigger":"forderung_ohne_leistung","followup":"Welche konkreten Ergebnisse haben Sie verantwortet?"}]'::jsonb,'{"verhandlungstaktik":{"weight":0.3},"argumentation_mit_daten":{"weight":0.25},"souveraenitaet":{"weight":0.2},"kreative_optionen":{"weight":0.15},"abschluss":{"weight":0.1}}'::jsonb,'hard',15,array['gehaltsverhandlung'],array['Angestellte','Fach- & Führungskräfte'],array['Verhandlungsführung','Selbstwert']),
('hr_termination_humane','hr','hr_manager','termination','Trennungsgespräch · würdevoll führen','Rechtssicheres und menschlich angemessenes Kündigungsgespräch — eines der härtesten HR-Gespräche.','Sie kündigen einer langjährigen Mitarbeiterin (7 Jahre, ein Kind, finanziell belastet) aus betriebsbedingten Gründen.','{"role":"Mitarbeiterin (35)","emotional_arc":"Schock → Verzweiflung → Wut → Verhandeln","goal_user":"klare Botschaft, juristische Sauberkeit, Würde wahren"}'::jsonb,'["[Begrüßung & Setting]","[Klare Botschaft der Kündigung in den ersten 2 Minuten]","[Begründung, Aufhebungsvertrag, nächste Schritte]"]'::jsonb,'[{"trigger":"weicht_aus","followup":"Ihre Botschaft ist unklar geblieben."},{"trigger":"wird_persoenlich","followup":"Wie reagieren Sie jetzt?"}]'::jsonb,'{"klarheit_botschaft":{"weight":0.3},"empathie_ohne_weichmachen":{"weight":0.25},"juristische_sauberkeit":{"weight":0.2},"struktur":{"weight":0.15},"deeskalation":{"weight":0.1}}'::jsonb,'expert',25,array['kuendigungsgespraech','trennung','arbeitsrecht'],array['HR-Manager:in','Führungskräfte'],array['Schwierige Gespräche','Arbeitsrecht']),
('hr_feedback_critical','hr','leader','feedback','Kritisches Feedback · WWW+B','Verhaltensbezogenes Kritikgespräch ohne Schuldzuweisung.','Eine fachlich starke Mitarbeiterin verhält sich in Meetings dominant. Das Team beschwert sich.','{"role":"Senior Fachkraft","defenses":["leugnen","relativieren","Gegenangriff"]}'::jsonb,'["Eröffnen Sie und benennen Sie das beobachtete Verhalten konkret.","Beschreiben Sie die Wirkung auf das Team.","Formulieren Sie Ihre Bitte."]'::jsonb,'[{"trigger":"vorwurf_statt_beobachtung","followup":"Verhaltensbezogen formulieren?"}]'::jsonb,'{"verhaltensbezug":{"weight":0.3},"wirkungsbeschreibung":{"weight":0.2},"empathie":{"weight":0.2},"vereinbarung":{"weight":0.2},"struktur":{"weight":0.1}}'::jsonb,'medium',15,array['mitarbeiterentwicklung','feedback'],array['Führungskräfte','Team-Leads'],array['Feedback-Kultur']),
('hr_conflict_mediation','hr','leader','conflict','Konfliktgespräch · Mediation','Zwei wertvolle Teammitglieder im offenen Konflikt.','Anna & Markus blockieren sich gegenseitig. Ein Projekt steht still. Sie führen ein Dreiergespräch.','{"anna":{"interesse":"Anerkennung"},"markus":{"interesse":"Vertrauen, Autonomie"}}'::jsonb,'["Setting & Spielregeln erklären.","Lassen Sie beide Seiten schildern.","Spiegeln Sie die Interessen."]'::jsonb,'[{"trigger":"partei_ergreifen","followup":"Wie wirkt das einseitig?"}]'::jsonb,'{"allparteilichkeit":{"weight":0.3},"interessensklaerung":{"weight":0.25},"deeskalation":{"weight":0.2},"vereinbarung":{"weight":0.15},"struktur":{"weight":0.1}}'::jsonb,'hard',25,array['konflikte','teamleitung'],array['Führungskräfte','HR-Business-Partner'],array['Mediation']),
('hr_onboarding_kickoff','hr','leader','onboarding','Onboarding-Kickoff · 30-60-90','Strukturiertes Onboarding-Gespräch.','Tag 1 mit einer neuen Fachkraft.','{"role":"Neuzugang","mood":"motiviert aber unsicher"}'::jsonb,'["Begrüßung & Rolle.","30-60-90-Ziele.","Buddy, Tools, Check-in."]'::jsonb,'[{"trigger":"einseitig","followup":"Was möchten Sie wissen?"}]'::jsonb,'{"klarheit":{"weight":0.3},"erwartungsabgleich":{"weight":0.25},"struktur_30_60_90":{"weight":0.2},"empowerment":{"weight":0.15},"beziehung":{"weight":0.1}}'::jsonb,'easy',15,array['onboarding','mitarbeiterentwicklung'],array['Führungskräfte','HR-Manager:in'],array['Onboarding']),
('hr_one_on_one','hr','leader','one_on_one','1:1 · Hochwertiges Mitarbeitergespräch','Wöchentliches 1:1 — Coaching statt Status-Update.','Reguläres 1:1. Letzte Woche Deadline-Miss.','{"role":"Mid-Level","mood":"angespannt"}'::jsonb,'["Offen eröffnen.","Deadline-Miss coaching ansprechen.","Blocker klären."]'::jsonb,'[{"trigger":"status_modus","followup":"Sie sind im Status-Modus."}]'::jsonb,'{"coaching_qualitaet":{"weight":0.3},"empathie":{"weight":0.2},"klarheit_naechste_schritte":{"weight":0.2},"karriere_dimension":{"weight":0.15},"struktur":{"weight":0.15}}'::jsonb,'medium',20,array['mitarbeiterentwicklung','one_on_one'],array['Führungskräfte'],array['Coaching','Aktives Zuhören']),
('leadership_coaching_grow','leadership','leader','leadership_coaching','Führungs-Coaching · GROW','Coaching nach Goal · Reality · Options · Will.','Ein:e Teamlead bittet Sie um Coaching wegen schwierigem Stakeholder.','{"role":"Coachee","trap":"will Sie als Problem-Löser"}'::jsonb,'["Goal: Was wäre ein gutes Ergebnis?","Reality: Was passiert konkret?","Options: Welche Optionen?"]'::jsonb,'[{"trigger":"ratschlag","followup":"Wie könnten Sie stattdessen fragen?"}]'::jsonb,'{"grow_disziplin":{"weight":0.3},"frage_qualitaet":{"weight":0.25},"keine_ratschlaege":{"weight":0.2},"praesenz":{"weight":0.15},"will_committment":{"weight":0.1}}'::jsonb,'expert',25,array['leadership','coaching'],array['Senior-Führungskräfte'],array['GROW-Modell']),
('sales_discovery_b2b','sales','sales_rep','sales_discovery','B2B Discovery Call · Pain-Funnel','Erstes Verkaufsgespräch — Pain-Funnel statt Pitch.','30-Min-Discovery mit CTO eines 800-Personen-Unternehmens.','{"role":"CTO, skeptisch"}'::jsonb,'["Was hat Sie zu diesem Gespräch veranlasst?","Was passiert, wenn Sie das in 6 Monaten NICHT lösen?","Wer ist sonst noch beteiligt?"]'::jsonb,'[{"trigger":"pitched","followup":"Was wissen Sie schon über Pain & Decision?"}]'::jsonb,'{"pain_tiefe":{"weight":0.3},"cost_of_inaction":{"weight":0.2},"decision_process":{"weight":0.2},"keine_premature_pitches":{"weight":0.2},"professional_curiosity":{"weight":0.1}}'::jsonb,'hard',20,array['sales','b2b'],array['Sales','Account Executive'],array['Discovery','MEDDPICC','SPIN']),
('service_difficult_customer','service','sales_rep','difficult_customer','Eskalations-Telefonat · schwieriger Kunde','Erbost-eskalierender Kunde am Telefon.','Kunde ruft wütend an: zweite Falschlieferung, fordert sofortige Erstattung + Schadensersatz.','{"role":"Geschäftskunde","arc":"Wut → Resignation → Verhandlung"}'::jsonb,'["Übernehmen Sie das Gespräch.","Spiegeln und entschuldigen.","Lösungspfad anbieten."]'::jsonb,'[{"trigger":"verteidigt","followup":"Wie wirkt das auf den Kunden?"}]'::jsonb,'{"deeskalation":{"weight":0.3},"empathie":{"weight":0.25},"loesungsklarheit":{"weight":0.25},"professionelle_grenzen":{"weight":0.1},"bindungsperspektive":{"weight":0.1}}'::jsonb,'hard',15,array['kundenservice','eskalation'],array['Service-Team','Account-Manager'],array['Deeskalation']),
('medical_patient_briefing','medical','physician','patient_briefing','Arzt-Patient · SPIKES','SPIKES-Protokoll für schwierige Diagnosen.','Sie übermitteln einer Patientin (52, berufstätig, zwei Kinder) eine chronische Diagnose.','{"role":"Patientin (52)","arc":"Verleugnung → Schock → Trauer"}'::jsonb,'["Setting vorbereiten.","Perception: Was weiß sie schon?","Knowledge: Diagnose in einfacher Sprache."]'::jsonb,'[{"trigger":"fachjargon","followup":"Versteht die Patientin Sie?"}]'::jsonb,'{"spikes_disziplin":{"weight":0.3},"empathie":{"weight":0.25},"verstaendliche_sprache":{"weight":0.2},"tempo":{"weight":0.15},"naechste_schritte":{"weight":0.1}}'::jsonb,'expert',25,array['arztgespraech','aufklaerung'],array['Ärzt:innen','Pflegekräfte'],array['SPIKES']),
('compliance_short_briefing','compliance','hr_manager','compliance_briefing','Compliance-Kurzbriefing · DSGVO','10-Min-Mikrobriefing — alltagstaugliche Compliance-Kommunikation.','Sie briefen Ihr 12-köpfiges Team in 10 Minuten zu drei neuen DSGVO-Pflichten.','{"team":"genervt","needs":"praktische Beispiele"}'::jsonb,'["WARUM benennen.","Drei Pflichten mit Beispielen.","Do/Dont + nächste Schritte."]'::jsonb,'[{"trigger":"jurasprech","followup":"Alltagstauglich?"}]'::jsonb,'{"klarheit":{"weight":0.3},"praxisbezug":{"weight":0.3},"struktur":{"weight":0.2},"engagement":{"weight":0.1},"naechste_schritte":{"weight":0.1}}'::jsonb,'medium',10,array['compliance_schulung'],array['HR','Compliance-Beauftragte'],array['Compliance-Kommunikation','DSGVO'])
on conflict (scenario_key) do nothing;

select public.fn_emit_audit(
  'conversation_os_scenarios_seeded','system',null,'success',
  jsonb_build_object('seeded_count',12,'phase','A.1','cut',0,'domains',array['hr','leadership','sales','service','medical','compliance'])
);