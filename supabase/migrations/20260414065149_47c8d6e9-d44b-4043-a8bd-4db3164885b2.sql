-- Seed internal link suggestions: Pillar↔Cluster and Cluster→Product links
INSERT INTO seo_internal_link_suggestions (source_url, source_title, target_url, target_title, anchor_text, relevance_score, link_type, priority, reason, status) VALUES
-- Pillar /pruefungstraining → Clusters
('/pruefungstraining', 'Prüfungstraining', '/pruefungsfragen', 'Prüfungsfragen', 'Prüfungsfragen online üben', 95, 'pillar_to_cluster', 1, 'Pillar→Cluster: Prüfungsfragen als Kern-Cluster', 'active'),
('/pruefungstraining', 'Prüfungstraining', '/muendliche-pruefung', 'Mündliche Prüfung', 'Mündliche Prüfung vorbereiten', 90, 'pillar_to_cluster', 2, 'Pillar→Cluster: Mündliche Prüfung', 'active'),
('/pruefungstraining', 'Prüfungstraining', '/probepruefung', 'Probeprüfung', 'Probeprüfung online machen', 90, 'pillar_to_cluster', 3, 'Pillar→Cluster: Prüfungssimulation', 'active'),
('/pruefungstraining', 'Prüfungstraining', '/lernplan-pruefung', 'Lernplan', 'Lernplan für Prüfungen erstellen', 80, 'pillar_to_cluster', 4, 'Pillar→Cluster: Ratgeber Lernplan', 'active'),

-- Clusters → Pillar (back-links)
('/pruefungsfragen', 'Prüfungsfragen', '/pruefungstraining', 'Prüfungstraining', 'Zur vollständigen Prüfungsvorbereitung', 90, 'cluster_to_pillar', 1, 'Rücklink zum Pillar', 'active'),
('/muendliche-pruefung', 'Mündliche Prüfung', '/pruefungstraining', 'Prüfungstraining', 'Alle Prüfungsthemen im Überblick', 90, 'cluster_to_pillar', 1, 'Rücklink zum Pillar', 'active'),
('/probepruefung', 'Probeprüfung', '/pruefungstraining', 'Prüfungstraining', 'Zum Prüfungstraining-Überblick', 90, 'cluster_to_pillar', 1, 'Rücklink zum Pillar', 'active'),
('/lernplan-pruefung', 'Lernplan', '/pruefungstraining', 'Prüfungstraining', 'Prüfungsvorbereitung komplett', 85, 'cluster_to_pillar', 1, 'Rücklink zum Pillar', 'active'),

-- Horizontal Cluster↔Cluster
('/pruefungsfragen', 'Prüfungsfragen', '/probepruefung', 'Probeprüfung', 'Probeprüfung mit echten Fragen starten', 85, 'cluster_to_cluster', 2, 'Horizontal: Fragen→Simulation', 'active'),
('/pruefungsfragen', 'Prüfungsfragen', '/muendliche-pruefung', 'Mündliche Prüfung', 'Mündliche Prüfungsfragen üben', 80, 'cluster_to_cluster', 3, 'Horizontal: Fragen→Mündlich', 'active'),
('/muendliche-pruefung', 'Mündliche Prüfung', '/pruefungsfragen', 'Prüfungsfragen', 'Schriftliche Prüfungsfragen üben', 80, 'cluster_to_cluster', 2, 'Horizontal: Mündlich→Fragen', 'active'),
('/probepruefung', 'Probeprüfung', '/lernplan-pruefung', 'Lernplan', 'Lernplan für die Probeprüfung', 75, 'cluster_to_cluster', 3, 'Horizontal: Simulation→Lernplan', 'active'),

-- Cluster → Product (IHK examples)
('/pruefungsfragen', 'Prüfungsfragen', '/pruefungstraining/wirtschaftsfachwirt-ihk-pruefung', 'Wirtschaftsfachwirt Prüfungstrainer', 'Wirtschaftsfachwirt Prüfungsfragen üben', 95, 'cluster_to_product', 1, 'Produktlink: Top-Seller', 'active'),
('/pruefungsfragen', 'Prüfungsfragen', '/pruefungstraining/handelsfachwirt-ihk-pruefung', 'Handelsfachwirt Prüfungstrainer', 'Handelsfachwirt Prüfungsfragen trainieren', 90, 'cluster_to_product', 2, 'Produktlink: Fachwirt', 'active'),
('/pruefungsfragen', 'Prüfungsfragen', '/pruefungstraining/industriemeister-metall-ihk-pruefung', 'Industriemeister Metall Prüfungstrainer', 'Industriemeister Metall Prüfungsfragen', 85, 'cluster_to_product', 3, 'Produktlink: Meister', 'active'),
('/muendliche-pruefung', 'Mündliche Prüfung', '/pruefungstraining/aevo-pruefung', 'AEVO Prüfungstrainer', 'AEVO mündliche Prüfung vorbereiten', 95, 'cluster_to_product', 1, 'Produktlink: AEVO hat starke mündliche Komponente', 'active'),
('/muendliche-pruefung', 'Mündliche Prüfung', '/pruefungstraining/wirtschaftsfachwirt-ihk-pruefung', 'Wirtschaftsfachwirt Prüfungstrainer', 'Wirtschaftsfachwirt Fachgespräch üben', 90, 'cluster_to_product', 2, 'Produktlink: Fachwirt Fachgespräch', 'active'),
('/probepruefung', 'Probeprüfung', '/pruefungstraining/sachkunde-34f-pruefung', '§34f Prüfungstrainer', '§34f Probeprüfung starten', 90, 'cluster_to_product', 1, 'Produktlink: Sachkunde Simulation', 'active'),
('/probepruefung', 'Probeprüfung', '/pruefungstraining/sachkunde-34d-pruefung', '§34d Prüfungstrainer', '§34d Probeprüfung machen', 88, 'cluster_to_product', 2, 'Produktlink: Sachkunde Simulation', 'active');
