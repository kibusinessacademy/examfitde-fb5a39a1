# SSOT Guard Baseline

> Letztes Update: 2025-03-15

Diese Datei dokumentiert den aktuellen Stand der CI-SSOT-Guards (`scripts/ci-ssot-guards.sh`)
und dient als Referenz, damit neue PRs keine zusätzlichen Verstöße einführen.

---

## Guard-Level

| Guard | Typ | Verhalten |
|-------|-----|-----------|
| Raw title rendering | **HARD FAIL** | PR wird blockiert |
| Council evidence | WARNING | Hinweis im PR |
| Direct title reads | WARNING | Hinweis im PR |
| Gender-inclusive titles | WARNING | Hinweis im PR |

---

## Aktuelle Baseline

### Guard 1 — Raw Title Rendering (Hard Fail)

**Erlaubte Treffer: 0**

Einzige erlaubte Stelle:

- `src/pages/admin/v4/ops/CourseNamingIntegrityPanel.tsx` — Debug-Panel für Naming-Integrity (in Allowlist)

### Guard 2 — Council Approved ohne Timestamp (Warning)

**Erlaubte Treffer: 0**

Bekannte interne Nutzung (in Allowlist):

- `src/contexts/ActiveCourseContext.tsx` — Health-Score-Berechnung
- `src/pages/admin/v4/course/CourseWorkspace.tsx` — Publish-Gate-Logik

### Guard 3 — Direkte course_packages Title Reads (Warning)

**Erlaubte Treffer: 0**

Bekannte interne Nutzung (in Allowlist):

- `src/contexts/ActiveCourseContext.tsx` — Paket-Laden mit SSOT-Overlay
- `src/hooks/useCoursePackageDetail.ts` — Detail-Hook mit SSOT-Overlay

### Guard 4 — Gender-Inclusive Title Assignments (Warning)

**Erlaubte Treffer: 0**

Neue Kurs-Titel müssen immer `/-` enthalten (z. B. `Verkäufer/-in`).

---

## Baseline-Regel

Neue PRs dürfen:

- **keine neuen Hard-Fail-Treffer erzeugen** (Guard 1 → PR blockiert)
- **die Anzahl der Warning-Treffer nicht erhöhen** (Guards 2–4)

Wenn eine neue Ausnahme nötig ist, muss `docs/ssot-allowlist.md` aktualisiert werden.
