# Admin Routing Enforcement

Status: ACTIVE
Scope: Admin V2
Last Updated: 2026-03-21

## Ziel

Diese Guards erzwingen die Routing-SSOT aus `docs/admin-routing-ssot.md`.

Verhindert werden:
- neue `/admin/*` Top-Level-Routen
- neue Dateien unter verbotenen Legacy-Admin-Pfaden
- neue Navigationen auf deaktivierte Admin-Seiten
- neue Direktimporte von deaktivierten Admin-Modulen

---

## Erlaubte aktive Admin-Routen

- `/admin`
- `/admin/command`
- `/admin/studio`
- `/admin/studio/:packageId`
- `/admin/queue`
- `/admin/*` → `AdminDeactivatedPage`

---

## Erlaubte Admin-Seiten-Dateien

Nur diese produktiven Page-Entrypoints sind erlaubt:

- `src/pages/admin/LeitstellePage.tsx`
- `src/pages/admin/KursePage.tsx`
- `src/pages/admin/QueuePage.tsx`
- `src/pages/admin/CourseWorkspace.tsx`
- `src/pages/admin/AdminDeactivatedPage.tsx`

Zusätzlich erlaubt:
- Layout-Dateien für `AdminV2Layout`
- Komponenten/Module unter `src/features/admin/**`
- UI-Bausteine unter `src/components/admin/**`

---

## Verboten

### Neue Top-Level-Routen

Keine neuen Routen wie:
- `/admin/quality`
- `/admin/system-health`
- `/admin/finance`
- `/admin/business`
- `/admin/content`
- `/admin/crm`
- `/admin/support`
- `/admin/ops/*`
- `/admin/v4/*`

### Neue Seiten-Dateien unter Legacy-Pfaden

Verbotene Ordner:
- `src/pages/admin/v4/**`
- `src/pages/admin/control/**`
- `src/pages/admin/factory/**`
- `src/pages/admin/intake/**`
- `src/pages/admin/b2b/**`
- `src/pages/admin/workspace/**`

### Neue Direktimporte

Keine Imports aus deaktivierten Legacy-Seiten in aktive Routen, Layouts oder Navigation.

---

## Architekturregel

Neue Admin-Funktionalität entsteht nur als Modul in genau einem der drei Bereiche:
- Command
- Studio
- Queue

Nicht als neue Seite.
