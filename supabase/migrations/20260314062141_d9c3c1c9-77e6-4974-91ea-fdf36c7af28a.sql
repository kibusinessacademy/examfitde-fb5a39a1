-- Reprioritize requested courses to priority 2 (right after current Prio 1 building packages)
-- These are the packages that exist and need priority boost:

-- Already Prio 1-2 (no change needed): Elektroniker Betriebstechnik, Industriemechaniker, Mechatroniker, Fachkraft Lagerlogistik

-- Boost to Prio 2:
UPDATE course_packages SET priority = 2 WHERE id IN (
  'adce63f4-03ba-49ec-964c-c35e3984a591',  -- Fachlagerist
  'f9a7900d-520b-48a3-8656-b5db4a7109dd',  -- Fachinformatiker Anwendungsentwicklung
  'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',  -- Drogist
  '570ccb3e-2937-4d81-b3d8-624b9be84737',  -- Personaldienstleistungskaufmann
  '56aee54d-5fd6-4f18-90c0-c6f7f493618a',  -- Elektroniker Geräte und Systeme
  'fdf4c23c-be16-43ed-ac0e-aea0ab64665f',  -- Fachkraft für Metalltechnik
  'd7fd81c3-283e-4270-acef-812b08501442',  -- Technischer Produktdesigner
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',  -- Kaufmann Marketingkommunikation
  'eec21a03-75f4-43a3-aabc-f826f7d15159',  -- Kaufmann Digitalisierungsmanagement
  '268c2982-a844-49c7-9b3c-2eafe611d299'   -- Kaufmann Dialogmarketing
);

-- Also set the general Fachinformatiker package to Prio 2
UPDATE course_packages SET priority = 2 
WHERE course_id = 'b76e9720-5cb5-4bb3-8e3c-f9bb83ecac26' 
AND status NOT IN ('archived','0.0-superseded');

-- Bump Kaufmann E-Commerce (no package yet — needs to be noted)
-- Verwaltungsfachangestellte (no package yet)
-- Industriekaufmann (no package yet)
-- Fachinformatiker Systemintegration (course doesn't exist yet)