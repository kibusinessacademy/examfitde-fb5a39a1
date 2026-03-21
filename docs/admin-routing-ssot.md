# Admin Routing SSOT (V2)

Status: ACTIVE
Owner: Core Platform
Last Updated: 2026-03-21

---

## 1. Ziel dieses Dokuments

Dieses Dokument definiert die **verbindliche Routing- und UI-Struktur** des Admin-Bereichs.

Ziele:
- Vermeidung von Shadow-Admin-Systemen
- Klare Navigations-SSOT
- Eliminierung von Legacy-Komplexität
- Erzwingen von Modul-Denken statt Seitenwildwuchs

---

## 2. Grundprinzip (nicht verhandelbar)

👉 Der Admin besteht aus **genau 3 operativen Bereichen**

| Bereich | Route | Rolle |
|---------|-------|-------|
| Command | `/admin/command` | Systemsteuerung (Leitstelle) |
| Studio | `/admin/studio` | Kurs-/Produktverwaltung |
| Queue | `/admin/queue` | Job- & Pipeline-Management |

Zusätzlich:
- `/admin` → Redirect auf `/admin/studio`
- `/admin/studio/:packageId` → Detail-Workspace

❗ Es dürfen **keine weiteren Top-Level-Admin-Routen** entstehen.

---

## 3. Routing-SSOT

### 3.1 Aktive Routen

```
/admin                    → redirect("/admin/studio")
/admin/command            → LeitstellePage
/admin/studio             → KursePage
/admin/studio/:packageId  → CourseWorkspace
/admin/queue              → QueuePage
/admin/*                  → AdminDeactivatedPage
```

### 3.2 Legacy-Redirects (Pflicht)

Alle alten Pfade müssen hart auf V2 gemappt werden:

**→ Studio**
- `/admin/dashboard`
- `/admin/home`
- `/admin/courses`
- `/admin/course-studio`
- `/admin/packages/*`
- `/admin/berufski/*`

**→ Command**
- `/admin/control-tower`
- `/admin/leitstelle`
- `/admin/system/*`
- `/admin/business/*`
- `/admin/revenue/*`
- `/admin/content/*`
- `/admin/crm/*`
- `/admin/support/*`
- `/admin/quality/*`
- `/admin/finance/*`
- `/admin/council/*`

**→ Queue**
- `/admin/jobs/*`
- `/admin/ops/queue/*`

---

## 4. Layout-SSOT

**Admin Layout**
- Layout: `AdminV2Layout`
- Isolation: vollständig getrennt von `AppChrome`

**Regeln:**
- Kein `NativeTabBar`
- Keine PWA Padding Logik
- Kein Frontend-Shadow-State
- Admin ist kein Teil der User-App

---

## 5. Modul-Prinzip (kritisch)

❗ Neue Features dürfen **NICHT** als neue Seiten gebaut werden.

Stattdessen:

| Feature-Typ | Ziel |
|---|---|
| Pipeline / System / Governance | → Command |
| Kurs / Inhalte / Blueprints | → Studio |
| Jobs / Status / Debugging | → Queue |

### Beispiel

❌ Falsch:
```
/admin/quality-dashboard
/admin/system-health
/admin/ai-workers
```

✅ Richtig:
```
/admin/command → Tab: Quality
/admin/command → Tab: System Health
/admin/command → Modul: AI Workers
```

---

## 6. Deaktivierte Seiten (Legacy)

Alle folgenden Seiten gelten als:

> ❗ DEPRECATED – NICHT VERWENDEN

Sie werden:
- nicht geroutet
- nicht verlinkt
- nicht erweitert

### Kategorien

**Root `/pages/admin/`:**
- AIWorkersPage
- AZAVCompliancePage
- AdminControlTowerPage
- AdminExecutiveHomePage
- AdminOpsQueuePage
- AdminPackageRiskPage
- AdminProviderHealthPage
- AdminRevenuePage
- AuditExportsPage
- ComplianceDashboardPage
- CoursePackagesList
- CourseStudioPage
- EliteMatrixPage
- EnterpriseSeatManagement
- FinanceDashboard
- PackageReadinessPage
- QueueManagerPage
- SystemHealthPage
- V2LoopDebugPage

**`/v4/` + `/v4/ops/`:**
👉 Vollständig deaktiviert (28+ Seiten + Ops-System)

**Weitere:**
- `/control/`
- `/factory/`
- `/intake/`
- `/b2b/`
- `/workspace/`

---

## 7. Deletion Policy (wichtig)

Diese Seiten dürfen gelöscht werden, wenn:
- keine Imports mehr existieren
- keine Navigation darauf zeigt
- keine Feature-Abhängigkeit besteht

Empfohlen: 👉 Batch Delete in Phasen

1. `v4/`
2. `ops/`
3. `workspace/`
4. root legacy

---

## 8. Governance-Regeln

### 8.1 Hard Rules

- ❌ Keine neuen `/admin/*` Routen
- ❌ Keine Feature-Seiten außerhalb der 3 Bereiche
- ❌ Kein UI-State außerhalb SSOT
- ❌ Kein Zugriff auf DB direkt im Client

### 8.2 PR Guard (empfohlen)

Automatische Prüfung:
- Blockiere PRs mit:
  - `/pages/admin/*` (neu)
  - `/admin/<neue-route>`

---

## 9. Zielzustand (Endgame)

Der Admin ist:
- kein Navigationssystem
- kein CMS
- kein Seitencluster

👉 Sondern:

> Ein operativer Steuerraum mit 3 klaren Modi

---

## 10. TL;DR

- 3 Routen: `command`, `studio`, `queue`
- Alles andere ist Legacy
- Keine neuen Seiten
- Nur Module innerhalb der 3 Bereiche
- Admin ist isoliert vom User-Frontend
