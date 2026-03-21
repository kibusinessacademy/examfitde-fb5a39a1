# Admin V4 → V2 Migration Matrix

Status: ACTIVE
Owner: Core Platform
Last Updated: 2026-03-21

---

## 1. Ziel

Dieses Dokument definiert verbindlich, wie deaktivierte Admin-Seiten aus Legacy / V4 behandelt werden.

Jede Alt-Seite bekommt genau einen Status:

- `merge_to_command`
- `merge_to_studio`
- `merge_to_queue`
- `extract_shared_module`
- `delete`
- `defer`

Wichtig:
❗ Es werden **keine alten Seiten als Seitenstruktur reaktiviert**.
Migration bedeutet immer **Funktionsübernahme in V2-Module**, nicht Wiederherstellung alter Routen.

---

## 2. Zielarchitektur

### Command
Zentrale Leitstelle für:
- Governance
- Systemzustand
- Risiko
- Business-Steuerung
- Provider- / AI- / Qualitätsaufsicht
- aggregierte KPIs

### Studio
Arbeitsraum für:
- Kurse
- Pakete
- Curricula
- Content
- Blueprints
- Handbook
- Readiness / Integrity auf Paketebene

### Queue
Technischer Operations-Raum für:
- Job Queue
- Pipeline-Läufe
- Recovery
- Dead Letters
- Throughput
- Batch / Worker / Retry / Auto-Heal Operations

---

## 3. Entscheidungsregel

### Merge to Command
Wenn die Seite:
- eine Übersicht / Governance / KPI / Health / Risiko / Steuerung zeigt
- mehrere Pakete aggregiert
- eher Management als Bearbeitung ist

### Merge to Studio
Wenn die Seite:
- inhaltlich paket-, curriculum-, blueprint- oder course-zentriert ist
- Artefakte bearbeitet, prüft oder freigibt
- in den Arbeitskontext eines Kurses gehört

### Merge to Queue
Wenn die Seite:
- Jobs, Pipelines, Reprocessing, Recovery oder technische Laufzeiten betrifft
- worker-/queue-/ops-zentriert ist

### Delete
Wenn die Seite:
- nur eine Doppelung bestehender V2-Funktion ist
- kein SSOT-konformes Zukunftsmodell hat
- rein historisch / experimentell / debug-only war

### Extract Shared Module
Wenn:
- Teilfunktion nützlich ist
- aber keine eigene Seite rechtfertigt
- und als Card / Panel / Tab / Drawer in V2 sinnvoll ist

---

## 4. Root-Level Legacy Mapping

| Legacy-Seite | Ziel | Status | Begründung |
|---|---|---|---|
| AIWorkersPage | Command | merge_to_command | Provider-/Worker-Aufsicht ist Leitstelle |
| AZAVCompliancePage | Command | defer | separat nur wenn regulatorisch wirklich aktiv |
| AdminControlTowerPage | Command | delete | durch LeitstellePage ersetzt |
| AdminExecutiveHomePage | Command | delete | Executive-Startseite ist Shadow-Entry |
| AdminOpsQueuePage | Queue | delete | QueuePage ersetzt die Seite bereits |
| AdminPackageRiskPage | Command | extract_shared_module | Paket-Risiko als Leitstellen-Modul |
| AdminProviderHealthPage | Command | extract_shared_module | Provider Health gehört als Modul in Command |
| AdminRevenuePage | Command | defer | nur bei echter B2B/Revenue-Reife |
| AuditExportsPage | Studio | extract_shared_module | Export-/Audit-Funktion paketnah |
| ComplianceDashboardPage | Command | defer | nur wenn operativ relevant |
| CoursePackagesList | Studio | delete | KursePage ist kanonische Übersicht |
| CourseStudioPage | Studio | delete | durch KursePage/CourseWorkspace ersetzt |
| EliteMatrixPage | Studio | extract_shared_module | Qualitäts-/Coverage-Matrix paketnah |
| EnterpriseSeatManagement | Command | defer | späteres B2B-Modul |
| FinanceDashboard | Command | defer | aktuell kein Kern-Admin-Modus |
| PackageReadinessPage | Studio | extract_shared_module | Readiness gehört in Workspace |
| QueueManagerPage | Queue | delete | QueuePage ersetzt sie |
| SystemHealthPage | Command | extract_shared_module | System Health als Command-Tab |
| V2LoopDebugPage | Queue | delete | Debug-only, keine Produktseite |

---

## 5. `/pages/admin/v4/` Mapping

| V4-Bereich | Ziel | Status | Migrationsform |
|---|---|---|---|
| Studio | Studio | delete | bereits konzeptionell ersetzt |
| Business | Command | defer | nur als KPI-/Lizenz-Modul, nicht als Route |
| CRM | Command | defer | nur falls echter CRM-Use-Case aktiv |
| Growth | Command | delete | kein Core-Admin-Bedienraum |
| Scale | Command | delete | zu abstrakt, ggf. KPIs integrieren |
| Quality | Command + Studio | extract_shared_module | global in Command, paketnah in Studio |
| Ops | Queue | delete | Queue ist kanonisches Ops-Ziel |
| Command | Command | delete | LeitstellePage ist SSOT |
| Security | Command | defer | nur wenn konkrete Sicherheitsmodule aktiv |
| Social | delete | delete | kein Kernteil des Admin-V2 |
| Support | Command | defer | nur wenn internes Support-Backoffice aktiv |
| Pipeline | Queue | extract_shared_module | Pipeline-Map / Laufstatus in Queue |
| Waves | Queue | defer | nur wenn Wave-Steuerung wieder produktiv wird |
| Certifications | Studio | extract_shared_module | Zertifikats-/Berufs-Sicht in Studio |
| BerufsKI (alle) | Studio | defer | nur falls Produktlinie aktiv reaktiviert wird |
| Coverage | Studio | extract_shared_module | Coverage paket-/curriculumnah |
| Curriculum | Studio | extract_shared_module | Curriculum-Intelligenz gehört in Studio |
| Content | Studio | extract_shared_module | Content-Qualität / Artefakte in Workspace |
| Load | Queue | defer | nur wenn Laststeuerung wirklich bedienbar ist |
| Review | Studio | extract_shared_module | Review-Funktion gehört in Workspace |
| Handbook | Studio | extract_shared_module | Handbook gehört paketnah |
| Media | Studio | defer | nur bei echter Media-Produktionsreife |

---

## 6. `/pages/admin/v4/ops/` Mapping

Grundsatz:
Der komplette `ops/`-Ordner wird **nicht als Seitenlandschaft migriert**.
Nützliche Teilfunktionen werden in `QueuePage` als Tabs / Panels / Tools integriert.

| Legacy Ops-Seite | Ziel | Status | Begründung |
|---|---|---|---|
| AI Gateway | Command | extract_shared_module | provider-/gateway-health eher Leitstelle |
| Auto-Heal | Queue | extract_shared_module | recovery-tool |
| Batch Recovery | Queue | extract_shared_module | queue/retry/recovery |
| Benchmarks | Command | defer | nur wenn dauerhaft entscheidungsrelevant |
| Factory | Queue | delete | keine eigene Route mehr |
| KG | delete | delete | unklare/enge Spezialfunktion |
| Dead Letter | Queue | extract_shared_module | klarer Queue-Use-Case |
| Logs | Queue | extract_shared_module | technische Ops-Funktion |
| Pipeline Map | Queue | extract_shared_module | visuelle Pipeline-Sicht |
| Quality Council | Command | extract_shared_module | Governance-/QC-Oversight |
| Queue | Queue | delete | bereits durch QueuePage ersetzt |
| ROI | Command | defer | späterer Management-Tab |
| Scaling | Command | defer | nur wenn operativ entscheidbar |
| Schema Drift | Command | extract_shared_module | Governance / Plattformintegrität |
| Test | delete | delete | keine Produktivseite |
| Throughput | Queue | extract_shared_module | queue-zentrierte KPI |
| Trust | Command | defer | nur mit klarem Trust-Framework |

---

## 7. `/pages/admin/control/` Mapping

| Legacy-Seite | Ziel | Status | Begründung |
|---|---|---|---|
| UnifiedLeitstelle | Command | delete | durch LeitstellePage ersetzt |
| SchedulerGovernance | Queue + Command | extract_shared_module | Governance in Command, Scheduler-Status in Queue |
| SyntheticProbeCenter | Command | extract_shared_module | systemische Health-/Probe-Aufsicht |
| SystemContractAudit | Command | extract_shared_module | Architektur-/SSOT-/Contract-Audit |

---

## 8. `/pages/admin/factory/` Mapping

| Legacy-Seite | Ziel | Status | Begründung |
|---|---|---|---|
| FactoryExecutiveDashboard | Queue | delete | Queue/Command splitten statt eigene Seite |
| ProductionWaveDetail | Queue | defer | nur falls Wave-Modell aktiv bleibt |
| ProductionWaveTriage | Queue | defer | nur falls Wave-Modell aktiv bleibt |

---

## 9. `/pages/admin/intake/` Mapping

| Legacy-Seite | Ziel | Status | Begründung |
|---|---|---|---|
| CurriculumIntake | Studio | extract_shared_module | Curriculum-Aufnahme gehört in Studio |
| QualificationDiscovery | Studio | extract_shared_module | Zertifikats-/Berufsanlage in Studio |

---

## 10. `/pages/admin/b2b/` Mapping

| Legacy-Seite | Ziel | Status | Begründung |
|---|---|---|---|
| OrgDashboard | Command | defer | B2B-Backoffice, nicht Core-V2 jetzt |
| CohortOverview | Command | defer | späteres Organisationsmodul |
| LearnerCompetency | Studio | defer | sinnvoll, aber nicht Kern des jetzigen Admin-V2 |

---

## 11. `/pages/admin/workspace/` Mapping

| Legacy-Seite | Ziel | Status | Begründung |
|---|---|---|---|
| AutoGapCloser | Studio | extract_shared_module | paketnahes Qualitäts-/Füll-Tool |
| Export | Studio | extract_shared_module | paketbezogene Exporte |
| IntegrityReport | Studio | extract_shared_module | gehört direkt in CourseWorkspace |
| config | Studio | extract_shared_module | Workspace-Konfiguration als internes Modul |

---

## 12. Zielmodule in V2

### Command-Module
Empfohlene Zielmodule innerhalb `LeitstellePage`:

- `SystemHealthPanel`
- `ProviderHealthPanel`
- `PackageRiskPanel`
- `SchemaDriftPanel`
- `QualityCouncilPanel`
- `SyntheticProbesPanel`
- `BusinessKpiPanel` (defer)
- `CompliancePanel` (defer)

### Studio-Module
Empfohlene Zielmodule innerhalb `KursePage` / `CourseWorkspace`:

- `ReadinessPanel`
- `IntegrityPanel`
- `CoveragePanel`
- `BlueprintQualityPanel`
- `ReviewPanel`
- `HandbookPanel`
- `CurriculumPanel`
- `QualificationDiscoveryPanel`
- `ExportPanel`
- `AutoGapCloserPanel`

### Queue-Module
Empfohlene Zielmodule innerhalb `QueuePage`:

- `PipelineMapPanel`
- `DeadLetterPanel`
- `AutoHealPanel`
- `BatchRecoveryPanel`
- `LogsPanel`
- `ThroughputPanel`
- `SchedulerPanel`

---

## 13. Priorisierte Umsetzung

### Phase A — Sofort übernehmen

1. `PackageReadinessPage` → `ReadinessPanel` in `CourseWorkspace`
2. `IntegrityReport` → `IntegrityPanel` in `CourseWorkspace`
3. `AutoGapCloser` → `AutoGapCloserPanel` in `CourseWorkspace`
4. `AdminProviderHealthPage` → `ProviderHealthPanel` in `LeitstellePage`
5. `SystemHealthPage` → `SystemHealthPanel` in `LeitstellePage`
6. `Dead Letter` → `DeadLetterPanel` in `QueuePage`
7. `Pipeline Map` → `PipelineMapPanel` in `QueuePage`

### Phase B — Danach

1. `EliteMatrixPage` → `CoveragePanel`
2. `CurriculumIntake` → `CurriculumPanel`
3. `QualificationDiscovery` → `QualificationDiscoveryPanel`
4. `SchedulerGovernance` → `SchedulerPanel`
5. `Schema Drift` → `SchemaDriftPanel`
6. `Quality Council` → `QualityCouncilPanel`

### Phase C — Nur bei echtem Bedarf

- Revenue
- Finance
- B2B Seat Management
- CRM
- Support
- Security
- Waves
- Media
- AZAV / Compliance Spezialflächen

---

## 14. Deletion-Reihenfolge

### Batch 1
Sofort löschbar, sobald Imports entfernt sind:
- AdminControlTowerPage
- AdminExecutiveHomePage
- AdminOpsQueuePage
- CoursePackagesList
- CourseStudioPage
- QueueManagerPage
- UnifiedLeitstelle
- V2 duplicate V4 shells

### Batch 2
Nach Modul-Extraktion löschbar:
- PackageReadinessPage
- IntegrityReport
- AutoGapCloser
- AdminProviderHealthPage
- SystemHealthPage
- EliteMatrixPage

### Batch 3
Später löschen oder archivieren:
- gesamte `v4/`
- gesamte `v4/ops/`
- `factory/`
- `b2b/`
- `intake/`

---

## 15. Hard Rule

❗ Migration bedeutet niemals:
- alte Seite wieder routen
- alten URL-Raum reaktivieren
- neue Admin-Unterroute anlegen

❗ Migration bedeutet immer:
- Logik extrahieren
- Modul bauen
- in Command / Studio / Queue integrieren

---

## 16. TL;DR

- Command = Governance / System / Risiken
- Studio = Paket / Curriculum / Content / Qualität
- Queue = Jobs / Pipeline / Recovery
- Legacy-Seiten werden nicht restauriert
- Nützliche Funktionen werden als V2-Module übernommen
- Alles andere wird gelöscht oder bewusst deferred
