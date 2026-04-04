# Memory: strategie/markt/studiengang-rollout-priorisierung-v1
Updated: now

Die Expansion in den Hochschulbereich erfolgt über eine BIBB-alignierte Top-30-Liste dualer Studiengänge (WIP-Limit: 2, study_mode: dual).

## Rollout-Waves (programs.priority_wave)

### Wave 1 — Core-Märkte (7 Programme)
BWL, Wirtschaftsinformatik, Wirtschaftsingenieurwesen, Informatik, Maschinenbau, Elektrotechnik, Bauingenieurwesen.

### Wave 2 — Growth (13 Programme)
BWL-Handel, BWL-Industrie, BWL-Bank, BWL-Versicherung, BWL-Accounting & Controlling, BWL-Steuern, BWL-Digital Business, International Business, Logistikmanagement, Wirtschaftsrecht, Angewandte Informatik, Mechatronik, Elektro- und Automatisierungstechnik.

### Wave 3 — Niche/Spezial (10 Programme)
BWL-Finanzdienstleistungen, Immobilienwirtschaft, Dienstleistungsmanagement, Data Science/KI, Cyber Security, Software Engineering, IT-Management, Verfahrenstechnik, Energietechnik.

### Geparkt (Wave 99) — Gesundheit/Soziales
Gesundheitsmanagement, Soziale Arbeit, Pflegemanagement. Eigener Cluster, nicht im initialen Studium-Seed.

## SSOT-Governance
- `programs.cluster`: wirtschaft | it | technik | gesundheit_soziales
- `programs.canonical_title`: Deduplizierter Anzeigename
- `programs.aliases[]`: Verhindert Dubletten (z.B. "Banking & Finance" → BWL-Bank)
- `programs.study_mode`: dual (Default für alle Studium-Seeds)
- Jedes Programm hat ein 1:1-Curriculum (track=STUDIUM, curriculum_typ=hochschule)

## Aktiver Build
BWL (frozen/building), Wirtschaftsinformatik (queued). Restliche 28 in draft, warten auf Lernfeld-Seeding + Enrichment.
