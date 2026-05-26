# Berufs-KI Market Activation Plan

## Kontext
Berufs-KI ist funktional und architektonisch vollständig genug fur Marktaktivierung. Der strategische Cut verbietet neue Core-Architektur — der Fokus liegt jetzt ausschliesslich auf Distribution, Adoption und Positionierung.

## Die 5 Marktaktivierungs-Prioritaten

### 1. Distribution Engine (SEO + Organic Growth)
Ziel: Massiver organic Traffic uber berufsspezifische Landingpages.

**Inhaltstypen:**
- Berufsseiten (FISI, Industriekaufmann, AEVO, Bilanzbuchhalter, etc.)
- Kompetenzseiten (pro Prufungsbereich / Kompetenz)
- Workflow-Seiten (berufliche Prozesse und Ablaufe)
- Outcome-Seiten (messbare Ergebnisse, Erfolgsgeschichten)
- Recovery-/Risk-Seiten (Prufungsfallstricke, Risiko-Management)
- Praxisbibliothek (Anleitungen, Templates, Checklisten)

**Technische Umsetzung:**
- Wiederverwendung bestehender SEO-Infrastruktur (seo_content_priority_queue, seo_intent_page_generate Job)
- Neue Job-Typen oder Payload-Varianten fur Berufs-/Workflow-/Outcome-Seiten
- Sitemap-Integration uber bestehenden load-dynamic-routes.mjs Mechanismus
- A1/A2-Brucken zu Certification-Pillar-Pages (bestehende SEO-Graph-Struktur nutzen)

### 2. Packaging & Positionierung
Ziel: Rollenbasierte Suites statt Feature-Listen verkaufen.

**Inhalt:**
- Suite-Landingpages (Ausbildungsleiter Suite, Prufungsreife Suite, Workforce Risk Suite, Recovery Suite, Standort Intelligence Suite)
- Preis- und Feature-Matrix pro Suite
- Vergleich: Einzelprodukte vs. Suite vs. Enterprise Bundle
- ROI-Rechner (Zeitersparnis, Risk-Reduction, Qualitatssteigerung)

**Technische Umsetzung:**
- Wiederverwendung von berufs_ki_product_suites (bestehende Tabelle)
- Neue Frontend-Seiten fur Suite-Landings
- Integration mit bestehendem Checkout-Tracking (conversion_events)
- Verlinkung aus BerufOS Hub und ExamFit Homepage

### 3. Demo- & Activation-Flows
Ziel: Sofortiger "Wow"-Moment ohne Konfiguration.

**Inhalt:**
- Sample-Cohorts (vorgefertigte Ausbildungsgruppen mit Demo-Daten)
- Guided Tours (Step-by-Step durch Risk Radar, Cohort Intelligence, Interventions)
- One-Click-Testflows (keine Einrichtung, sofort Erlebnis)
- Beispiel-Risiken und Beispiel-Interventionen (vorgefertigte Patterns)
- Demo-Dashboard fur Ausbildungsleiter (mit simulierten Daten)

**Technische Umsetzung:**
- Wiederverwendung von setup_wizards (bestehende Infrastruktur)
- Neue Wizard-Typen: "demo_cohort_setup", "demo_risk_scenario", "demo_intervention"
- Test-Fixture-Factory fur Demo-Daten (bestehende Factory-Struktur nutzen)
- LocalStorage / Session-basierte Demo-Modus (kein DB-Write fur anonyme User)

### 4. Workflow Marketplace
Ziel: Skalierbare Revenue uber vorgefertigte Berufs-Packs.

**Inhalt:**
- FISI Pack (Prufungsvorbereitung + Workflow + Recovery)
- Industriekaufmann Pack
- AEVO Pack (Ausbildung der Ausbilder)
- Prufungsrisiko Pack
- Recovery Pack
- Ausbildungsleiter Pack
- Berufsspezifische Kombinationen (B2B Multi-Seat)

**Technische Umsetzung:**
- Wiederverwendung von products + store_products (bestehende Commerce-SSOT)
- Neue product_type oder category: "workflow_pack"
- Integration mit bestehendem Entitlement-System (learner_course_grants + entitlements)
- Pack-Detailseiten mit Inhaltsverzeichnis (was ist enthalten)

### 5. Enterprise Sales Assets
Ziel: B2B-Verkaufsunterstutzung mit sofort verwertbaren Assets.

**Inhalt:**
- PDF-One-Pager pro Suite (generierbar aus Web-Content)
- Self-Service Demo-Flows (ohne Sales-Kontakt)
- ROI-Argumente (Quantifizierung: Stunden gespart, Risiken vermieden)
- Management Reports (vor/nach Vergleiche, anonymisierte Benchmarks)
- Case Studies (anonymisierte Erfolgsgeschichten aus Graph-Daten)

**Technische Umsetzung:**
- Wiederverwendung von executive_narrative + manager_copilot (bestehende RPCs)
- PDF-Generierung aus HTML/Pages (Print-CSS oder Puppeteer)
- Case-Study-Seiten aus anonymisierten Graph-Metriken
- Verlinkung aus BerufOS Hub und Sales-Seiten

## Nicht in Scope (bewusst weggelassen)
- Neue Core-DB-Tabellen
- Neue Graph-Layer (Skill/Competency/Workflow/Outcome/Recovery)
- Neue Governance- oder Audit-Infrastruktur
- Neue AI-Modelle oder Prompt-Systeme
- Neue Admin-Tools ohne direkten Marktbezug

## Empfohlene Reihenfolge
1. **Packaging & Positionierung** — Schnellster Impact, definiert die Verkaufsargumente
2. **Demo- & Activation-Flows** — Reduziert Abbruch, erhoht Konversion
3. **Distribution Engine** — Langfristiger organic Traffic
4. **Workflow Marketplace** — Skalierbare Revenue
5. **Enterprise Sales Assets** — B2B-Verkaufsunterstutzung

## Nächster Schritt
Wahle einen der 5 Punkte, um damit zu beginnen. Jeder Punkt ist unabhangig umsetzbar.
