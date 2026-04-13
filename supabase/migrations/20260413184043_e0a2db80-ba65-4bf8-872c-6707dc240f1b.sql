
-- ============================================================
-- 1. PERSONALFACHKAUFMANN: Create handbook chapters + sections
-- ============================================================

INSERT INTO handbook_chapters (id, curriculum_id, chapter_key, title, sort_order, is_published)
VALUES
  (gen_random_uuid(), 'c448a7f5-b677-55bf-8a60-1c762317045c', 'LF01', 'Kapitel 1: Personalarbeit organisieren & durchführen', 1, false),
  (gen_random_uuid(), 'c448a7f5-b677-55bf-8a60-1c762317045c', 'LF02', 'Kapitel 2: Personalplanung & -marketing', 2, false),
  (gen_random_uuid(), 'c448a7f5-b677-55bf-8a60-1c762317045c', 'LF03', 'Kapitel 3: Personalentwicklung & Weiterbildung', 3, false),
  (gen_random_uuid(), 'c448a7f5-b677-55bf-8a60-1c762317045c', 'LF04', 'Kapitel 4: Arbeitsrecht & Sozialversicherung', 4, false),
  (gen_random_uuid(), 'c448a7f5-b677-55bf-8a60-1c762317045c', 'LF05', 'Kapitel 5: Entgeltabrechnung & Personalcontrolling', 5, false),
  (gen_random_uuid(), 'c448a7f5-b677-55bf-8a60-1c762317045c', 'LF06', 'Kapitel 6: Betriebliches Gesundheitsmanagement', 6, false),
  (gen_random_uuid(), 'c448a7f5-b677-55bf-8a60-1c762317045c', 'LF07', 'Kapitel 7: Mitarbeiterführung & Kommunikation', 7, false),
  (gen_random_uuid(), 'c448a7f5-b677-55bf-8a60-1c762317045c', 'LF08', 'Kapitel 8: Arbeitsrecht & Tarifvertragsrecht', 8, false);

INSERT INTO handbook_sections (id, chapter_id, section_key, title, content_markdown, content_type, sort_order, basis_content, content_tier, expand_status)
SELECT
  gen_random_uuid(),
  hc.id,
  hc.chapter_key || '_overview',
  'Prüfungsrelevante Themen: ' || hc.title,
  '## ' || hc.title || E'\n\nDiese Sektion wird durch die Content-Pipeline mit prüfungsrelevanten Inhalten erweitert.',
  'text',
  1,
  '## ' || hc.title || E'\n\nDiese Sektion wird durch die Content-Pipeline mit prüfungsrelevanten Inhalten erweitert.',
  'basis',
  'pending'
FROM handbook_chapters hc
WHERE hc.curriculum_id = 'c448a7f5-b677-55bf-8a60-1c762317045c';

INSERT INTO package_steps (package_id, step_key, status, meta)
VALUES
  ('176f51ad-fe34-596e-9b3d-d1c9cd23b0a9', 'generate_handbook', 'queued', '{"note":"seeded by handbook heal migration"}'::jsonb),
  ('176f51ad-fe34-596e-9b3d-d1c9cd23b0a9', 'expand_handbook', 'queued', '{"note":"seeded by handbook heal migration"}'::jsonb),
  ('176f51ad-fe34-596e-9b3d-d1c9cd23b0a9', 'validate_handbook', 'queued', '{"note":"seeded by handbook heal migration"}'::jsonb),
  ('176f51ad-fe34-596e-9b3d-d1c9cd23b0a9', 'validate_handbook_depth', 'queued', '{"note":"seeded by handbook heal migration"}'::jsonb)
ON CONFLICT (package_id, step_key) DO NOTHING;

-- ============================================================
-- 2. FINANZANLAGENVERMITTLER §34f: Seed 4 sections into empty chapters 5-8
-- ============================================================

INSERT INTO handbook_sections (id, chapter_id, section_key, title, content_markdown, content_type, sort_order, basis_content, content_tier, expand_status)
VALUES
  (gen_random_uuid(), '317220e8-d0cd-4168-b13e-c4811f7a49d6', 'FA34F_supp_05', 'Anlageberatung & Risikoklassen',
   '## Anlageberatung & Risikoklassen' || E'\n\nErgänzende Prüfungsthemen.',
   'text', 1, '## Anlageberatung & Risikoklassen' || E'\n\nBasis.', 'basis', 'pending'),
  (gen_random_uuid(), '9c330e9b-ca33-4a15-8029-a24909ccd42c', 'FA34F_supp_06', 'Steuern & Abgeltungssteuer',
   '## Steuern & Abgeltungssteuer' || E'\n\nErgänzende Prüfungsthemen.',
   'text', 1, '## Steuern & Abgeltungssteuer' || E'\n\nBasis.', 'basis', 'pending'),
  (gen_random_uuid(), 'ca95841b-7cf5-4129-a406-8d650a4f40f5', 'FA34F_supp_07', 'Vermögensaufbau & Altersvorsorge',
   '## Vermögensaufbau & Altersvorsorge' || E'\n\nErgänzende Prüfungsthemen.',
   'text', 1, '## Vermögensaufbau & Altersvorsorge' || E'\n\nBasis.', 'basis', 'pending'),
  (gen_random_uuid(), 'd7aa9c30-85a6-48fe-831a-9482528cd70d', 'FA34F_supp_08', 'Praxisfälle & Fallstudien',
   '## Praxisfälle & Fallstudien' || E'\n\nErgänzende Prüfungsthemen.',
   'text', 1, '## Praxisfälle & Fallstudien' || E'\n\nBasis.', 'basis', 'pending');

-- ============================================================
-- 3. IMMOBILIARDARLEHENSVERMITTLER §34i: Seed 4 sections into empty chapters 5-8
-- ============================================================

INSERT INTO handbook_sections (id, chapter_id, section_key, title, content_markdown, content_type, sort_order, basis_content, content_tier, expand_status)
VALUES
  (gen_random_uuid(), 'aef3dbf1-3f54-424c-b02e-89e880cb5175', 'ID34I_supp_05', 'Immobilienbewertung Praxis',
   '## Immobilienbewertung Praxis' || E'\n\nErgänzende Prüfungsthemen.',
   'text', 1, '## Immobilienbewertung Praxis' || E'\n\nBasis.', 'basis', 'pending'),
  (gen_random_uuid(), 'a9c37940-6658-49bf-b860-d59327ecf61c', 'ID34I_supp_06', 'Verbraucherschutz & WIKR',
   '## Verbraucherschutz & WIKR' || E'\n\nErgänzende Prüfungsthemen.',
   'text', 1, '## Verbraucherschutz & WIKR' || E'\n\nBasis.', 'basis', 'pending'),
  (gen_random_uuid(), 'b4b72fcb-edb8-4c4b-a980-d193889c11fa', 'ID34I_supp_07', 'Finanzierungsmodelle & Tilgung',
   '## Finanzierungsmodelle & Tilgung' || E'\n\nErgänzende Prüfungsthemen.',
   'text', 1, '## Finanzierungsmodelle & Tilgung' || E'\n\nBasis.', 'basis', 'pending'),
  (gen_random_uuid(), '6febf42a-0e62-43c9-b2f3-8309d92134d0', 'ID34I_supp_08', 'Praxisfälle Darlehensberatung',
   '## Praxisfälle Darlehensberatung' || E'\n\nErgänzende Prüfungsthemen.',
   'text', 1, '## Praxisfälle Darlehensberatung' || E'\n\nBasis.', 'basis', 'pending');

-- ============================================================
-- 4. Clear poison loop flags
-- ============================================================

UPDATE package_steps
SET meta = meta
  - 'poison_loop_blocked'
  - 'poison_loop_blocked_at'
  - 'poison_loop_identical_fails'
  - 'poison_loop_reason'
  - 'poison_loop_signature'
  - 'manual_review_required'
WHERE package_id IN (
  'ba96f6d9-c638-4bf3-aaca-3465ac363e8b',
  '3e070545-c555-417a-a047-c7541ebb2a7c'
)
AND step_key = 'generate_handbook';

-- ============================================================
-- 5. Reset expand_handbook from skipped to queued
-- ============================================================

UPDATE package_steps
SET status = 'queued',
    meta = jsonb_build_object('note', 'reset from skipped by handbook heal migration', 'healed_at', now()::text)
WHERE package_id IN (
  'ba96f6d9-c638-4bf3-aaca-3465ac363e8b',
  '3e070545-c555-417a-a047-c7541ebb2a7c'
)
AND step_key = 'expand_handbook'
AND status = 'skipped';
