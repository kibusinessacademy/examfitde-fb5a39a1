-- Seed SEO Keywords for all clusters
INSERT INTO seo_keywords (keyword, cluster_id, intent_type, funnel_stage, persona, search_volume, difficulty, business_value, conversion_value, curriculum_fit, content_gap_score, target_page_type, target_url, secondary_keywords, status) VALUES

-- CLUSTER: Prüfungsfragen (a854e64e)
('prüfungsfragen', 'a854e64e-fc78-4472-af4f-0c82d22f0fe8', 'informational', 'mofu', 'alle', 12100, 35, 9, 8, 9, 9, 'pillar', '/pruefungsfragen', ARRAY['prüfungsfragen online','prüfungsfragen üben'], 'active'),
('prüfungsfragen online', 'a854e64e-fc78-4472-af4f-0c82d22f0fe8', 'commercial', 'mofu', 'alle', 4400, 30, 9, 9, 9, 8, 'pillar', '/pruefungsfragen', ARRAY['prüfungsfragen im internet','online prüfungsfragen üben'], 'active'),
('prüfungsfragen mit lösungen', 'a854e64e-fc78-4472-af4f-0c82d22f0fe8', 'informational', 'mofu', 'alle', 3600, 25, 8, 8, 9, 8, 'pillar', '/pruefungsfragen', ARRAY['prüfungsfragen und antworten','lösungen prüfungsfragen'], 'active'),
('typische prüfungsfragen', 'a854e64e-fc78-4472-af4f-0c82d22f0fe8', 'informational', 'tofu', 'alle', 2900, 20, 7, 7, 8, 7, 'cluster', '/pruefungsfragen', ARRAY['häufige prüfungsfragen','beliebte prüfungsfragen'], 'active'),
('prüfungsfragen üben', 'a854e64e-fc78-4472-af4f-0c82d22f0fe8', 'commercial', 'mofu', 'alle', 2400, 28, 9, 9, 9, 8, 'pillar', '/pruefungsfragen', ARRAY['prüfungsfragen trainieren','prüfungsfragen wiederholen'], 'active'),
('ihk prüfungsfragen', 'a854e64e-fc78-4472-af4f-0c82d22f0fe8', 'informational', 'mofu', 'ihk', 5400, 40, 10, 9, 10, 7, 'cluster', '/ihk-pruefungen', ARRAY['ihk prüfungsfragen kostenlos','ihk prüfungsfragen online'], 'active'),
('prüfungsfragen ihk kaufmann', 'a854e64e-fc78-4472-af4f-0c82d22f0fe8', 'informational', 'mofu', 'azubi', 1900, 30, 8, 8, 10, 8, 'product', '/pruefungstraining', ARRAY['ihk kaufmann prüfungsfragen','kaufmann prüfungsfragen üben'], 'active'),

-- CLUSTER: Prüfungstraining (76721d12)
('prüfungstraining', '76721d12-b008-4de4-aaaa-5f6203923903', 'commercial', 'mofu', 'alle', 6600, 38, 10, 10, 10, 5, 'pillar', '/pruefungstraining', ARRAY['prüfungstraining online','prüfung training'], 'active'),
('online prüfungstraining', '76721d12-b008-4de4-aaaa-5f6203923903', 'commercial', 'mofu', 'alle', 3200, 35, 10, 10, 10, 5, 'pillar', '/pruefungstraining', ARRAY['prüfungstraining im internet','digitales prüfungstraining'], 'active'),
('prüfungstraining ihk', '76721d12-b008-4de4-aaaa-5f6203923903', 'commercial', 'mofu', 'ihk', 4800, 42, 10, 10, 10, 6, 'pillar', '/pruefungstraining', ARRAY['ihk prüfungstraining online','ihk prüfung training'], 'active'),
('prüfungstraining kostenlos', '76721d12-b008-4de4-aaaa-5f6203923903', 'informational', 'tofu', 'alle', 2100, 20, 6, 5, 8, 7, 'pillar', '/pruefungstraining', ARRAY['gratis prüfungstraining','kostenloses prüfungstraining'], 'active'),

-- CLUSTER: Mündliche Prüfung (988a1f4f)
('mündliche prüfung', '988a1f4f-60f3-443d-b98d-e618f91b2b26', 'informational', 'mofu', 'alle', 8100, 32, 8, 7, 8, 9, 'pillar', '/muendliche-pruefung', ARRAY['mündliche prüfung vorbereiten','mündliche prüfung tipps'], 'active'),
('mündliche prüfung vorbereiten', '988a1f4f-60f3-443d-b98d-e618f91b2b26', 'informational', 'mofu', 'alle', 4400, 28, 8, 8, 8, 9, 'pillar', '/muendliche-pruefung', ARRAY['vorbereitung mündliche prüfung','mündliche prüfung lernen'], 'active'),
('fachgespräch vorbereiten', '988a1f4f-60f3-443d-b98d-e618f91b2b26', 'informational', 'mofu', 'ihk', 3200, 25, 8, 8, 9, 9, 'pillar', '/muendliche-pruefung', ARRAY['fachgespräch ihk','fachgespräch ausbildung'], 'active'),
('mündliche prüfung ihk', '988a1f4f-60f3-443d-b98d-e618f91b2b26', 'informational', 'mofu', 'ihk', 3600, 35, 9, 8, 10, 8, 'pillar', '/muendliche-pruefung', ARRAY['ihk mündliche prüfung vorbereitung','ihk fachgespräch'], 'active'),
('mündliche prüfung tipps', '988a1f4f-60f3-443d-b98d-e618f91b2b26', 'informational', 'tofu', 'alle', 2900, 18, 6, 5, 7, 8, 'pillar', '/muendliche-pruefung', ARRAY['tipps mündliche prüfung','mündliche prüfung bestehen'], 'active'),
('mündliche prüfungsfragen', '988a1f4f-60f3-443d-b98d-e618f91b2b26', 'informational', 'mofu', 'alle', 2400, 22, 8, 8, 9, 9, 'cluster', '/muendliche-pruefung', ARRAY['typische mündliche fragen','beispiel mündliche prüfung'], 'active'),

-- CLUSTER: Probeprüfung (d7e19026)
('probeprüfung', 'd7e19026-895f-4159-8028-db78a384f536', 'commercial', 'mofu', 'alle', 5400, 30, 9, 9, 9, 8, 'pillar', '/probepruefung', ARRAY['probeprüfung online','probeprüfung machen'], 'active'),
('probeprüfung online', 'd7e19026-895f-4159-8028-db78a384f536', 'commercial', 'mofu', 'alle', 3200, 28, 9, 9, 9, 8, 'pillar', '/probepruefung', ARRAY['online probeprüfung','probeprüfung im internet'], 'active'),
('prüfungssimulation', 'd7e19026-895f-4159-8028-db78a384f536', 'commercial', 'mofu', 'alle', 2900, 25, 9, 9, 9, 8, 'pillar', '/probepruefung', ARRAY['prüfung simulieren','realistische prüfungssimulation'], 'active'),
('probeprüfung ihk', 'd7e19026-895f-4159-8028-db78a384f536', 'commercial', 'mofu', 'ihk', 2400, 32, 10, 10, 10, 7, 'pillar', '/probepruefung', ARRAY['ihk probeprüfung online','ihk prüfung üben'], 'active'),

-- CLUSTER: Lernplan (b1bc513b)
('lernplan prüfung', 'b1bc513b-5ce5-487d-8d2d-a5c531303018', 'informational', 'tofu', 'alle', 3600, 22, 7, 6, 7, 9, 'pillar', '/lernplan-pruefung', ARRAY['lernplan für prüfungen','prüfung lernplan erstellen'], 'active'),
('effektiv lernen für prüfung', 'b1bc513b-5ce5-487d-8d2d-a5c531303018', 'informational', 'tofu', 'alle', 2900, 18, 6, 5, 6, 9, 'pillar', '/lernplan-pruefung', ARRAY['richtig lernen prüfung','prüfung effektiv vorbereiten'], 'active'),
('prüfungsangst überwinden', 'b1bc513b-5ce5-487d-8d2d-a5c531303018', 'informational', 'tofu', 'alle', 4400, 15, 5, 4, 5, 9, 'cluster', '/lernplan-pruefung', ARRAY['prüfungsangst was tun','prüfungsangst tipps'], 'active'),

-- CLUSTER: Prüfungsvorbereitung (6aeffdbf) 
('prüfungsvorbereitung', '6aeffdbf-cdf8-410d-8edd-009b08130913', 'informational', 'tofu', 'alle', 14800, 45, 9, 8, 9, 4, 'pillar', '/pruefungstraining', ARRAY['prüfungsvorbereitung online','prüfung vorbereiten'], 'active'),
('prüfungsvorbereitung online', '6aeffdbf-cdf8-410d-8edd-009b08130913', 'commercial', 'mofu', 'alle', 6600, 40, 10, 9, 9, 5, 'pillar', '/pruefungstraining', ARRAY['online prüfungsvorbereitung','digital prüfung vorbereiten'], 'active'),
('prüfung bestehen', '6aeffdbf-cdf8-410d-8edd-009b08130913', 'informational', 'tofu', 'alle', 3600, 15, 7, 6, 7, 8, 'cluster', '/pruefungstraining', ARRAY['prüfung sicher bestehen','prüfung schaffen'], 'active');
