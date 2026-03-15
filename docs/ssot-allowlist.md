# SSOT Guard Allowlist

Diese Datei dokumentiert alle bewusst erlaubten Ausnahmen für die CI-SSOT-Guards.

Wenn neue Ausnahmen hinzugefügt werden, **muss** diese Datei aktualisiert werden.

---

## Raw Title Access (`raw_course_title`, `raw_curriculum_title`)

| Datei | Grund |
|-------|-------|
| `CourseNamingIntegrityPanel.tsx` | Debug-Panel für Naming-Integrity-Überwachung |

Alle anderen UI-Komponenten müssen `canonical_title` verwenden.

---

## `council_approved` ohne Timestamp

| Datei | Grund |
|-------|-------|
| `ActiveCourseContext.tsx` | Interne Health-Score-Berechnung |
| `CourseWorkspace.tsx` | Publish-Gate-Logik (kein UI-Badge) |

Die UI verwendet ausschließlich `council_approved_at` für Badge-Anzeige.

---

## Direkte Queries auf `course_packages`

| Datei | Grund |
|-------|-------|
| `ActiveCourseContext.tsx` | Paket-Laden mit parallelem SSOT-Overlay |
| `useCoursePackageDetail.ts` | Detail-Hook mit SSOT-Overlay |
| `useCoursePackages.ts` | Mutations (insert/update) |

Alle UI-Kurslisten müssen stattdessen diese Views nutzen:

- `v_admin_visible_course_packages`
- `v_course_display_ssot`

---

## Canonical Title Rendering

**Einzig gültiger Pfad:**

```
SSOT View → canonical_title → UI Rendering
```

**Nicht erlaubt in UI-Komponenten:**

- `course.title` (direkt)
- `curriculum.title` (direkt)
- `raw_course_title`
- `raw_curriculum_title`
- `pkg.title` (ohne SSOT-Overlay)

---

## Änderungsprozess

1. Neue Ausnahme in dieser Datei dokumentieren (mit Grund)
2. Allowlist in `scripts/ci-ssot-guards.sh` aktualisieren
3. `docs/ssot-guard-baseline.md` Baseline-Zähler prüfen
