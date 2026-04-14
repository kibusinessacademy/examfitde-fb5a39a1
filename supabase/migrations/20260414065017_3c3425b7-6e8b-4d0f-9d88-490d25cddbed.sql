-- Seed SEO Keyword Clusters (Pillar-Cluster-Modell)
INSERT INTO seo_keyword_clusters (cluster_name, parent_topic, persona, business_priority, pillar_page_url, status, funnel_stage, curriculum_fit, notes) VALUES
-- PILLAR: Prüfungsvorbereitung (übergeordnet)
('Prüfungsvorbereitung', 'Prüfungsvorbereitung', 'alle', 10, '/pruefungstraining', 'active', 'tofu', 0.9, 'Pillar-Seite: bereits vorhanden als /pruefungstraining'),

-- CLUSTER 1: Prüfungsfragen
('Prüfungsfragen', 'Prüfungsvorbereitung', 'alle', 9, '/pruefungsfragen', 'planned', 'mofu', 0.95, 'Neuer Cluster: Fragenkatalog, Lösungen, Übungsmodus'),

-- CLUSTER 2: Prüfungstraining
('Prüfungstraining', 'Prüfungsvorbereitung', 'alle', 9, '/pruefungstraining', 'active', 'mofu', 0.95, 'Bestehende Pillar-Seite, Keywords erweitern'),

-- CLUSTER 3: Mündliche Prüfung
('Mündliche Prüfung', 'Prüfungsvorbereitung', 'alle', 8, '/muendliche-pruefung', 'planned', 'mofu', 0.8, 'Neuer Cluster: Fachgespräch, Beispiel-Fragen, Ablauf'),

-- CLUSTER 4: Prüfungssimulation / Probeprüfung
('Probeprüfung', 'Prüfungsvorbereitung', 'alle', 8, '/probepruefung', 'planned', 'mofu', 0.9, 'Neuer Cluster: Prüfungssimulation, Testmodus'),

-- CLUSTER 5: Lernplan
('Lernplan Prüfung', 'Prüfungsvorbereitung', 'alle', 7, '/lernplan-pruefung', 'planned', 'tofu', 0.6, 'Ratgeber-Cluster: Struktur, Wiederholung, Zeitmanagement'),

-- CLUSTER 6: IHK Prüfungen (bereits vorhanden)
('IHK Prüfungen', 'Prüfungsvorbereitung', 'ihk', 9, '/ihk-pruefungen', 'active', 'mofu', 1.0, 'Bestehender Cluster, Keywords erweitern'),

-- CLUSTER 7: Fachwirt
('Fachwirt Prüfung', 'Prüfungsvorbereitung', 'fachwirt', 8, '/fachwirt', 'active', 'mofu', 1.0, 'Bestehende Kategorie-Seite'),

-- CLUSTER 8: Sachkunde
('Sachkundeprüfung', 'Prüfungsvorbereitung', 'sachkunde', 8, '/pruefungstraining-sachkunde', 'active', 'mofu', 1.0, 'Persona-Landingpage vorhanden'),

-- CLUSTER 9: Meister
('Meisterprüfung', 'Prüfungsvorbereitung', 'meister', 7, '/meister', 'active', 'mofu', 1.0, 'Bestehende Kategorie-Seite'),

-- CLUSTER 10: Ausbildung
('Ausbildungsprüfung', 'Prüfungsvorbereitung', 'azubi', 8, '/ausbildung', 'active', 'mofu', 1.0, 'Bestehende Kategorie-Seite');
