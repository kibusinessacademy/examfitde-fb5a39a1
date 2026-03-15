# SSOT Naming Architecture

Architektur-Überblick für das kanonische Kurs-Naming-System.

---

## Datenfluss

```
┌─────────────────────────────────────────────────────┐
│                    Datenbank                         │
│                                                     │
│  courses ──┐                                        │
│            ├──► course_title_aliases                 │
│  curricula ┘    (alias → canonical mapping)          │
│                       │                              │
│                       ▼                              │
│              normalize_course_title()                │
│              (DB function: trim, case, alias)        │
│                       │                              │
│            ┌──────────┴──────────┐                   │
│            ▼                     ▼                   │
│  v_course_display_ssot    v_ops_course_name_         │
│  (canonical_title,        collisions                 │
│   dedupliziert)           v_ops_invalid_course_      │
│            │              titles                     │
│            ▼              (Integrity-Monitoring)     │
│  v_admin_visible_                                    │
│  course_packages                                     │
│  (gefiltert, dedupliziert)                           │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│                   Frontend                           │
│                                                     │
│  useCanonicalTitles()                                │
│  resolveTitle(map, id, fallback)                     │
│            │                                         │
│            ▼                                         │
│  Admin-Kurslisten, Badges, Queue, Finance            │
│  (rendern nur canonical_title)                       │
└─────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│                   CI-Guards                          │
│                                                     │
│  scripts/ci-ssot-guards.sh                           │
│  ├── Guard 1: raw_* Rendering → HARD FAIL           │
│  ├── Guard 2: council_approved Evidence → WARNING    │
│  ├── Guard 3: Direct title reads → WARNING           │
│  └── Guard 4: Gender-inclusive titles → WARNING      │
│                                                     │
│  docs/ssot-allowlist.md (Ausnahmen)                  │
│  docs/ssot-guard-baseline.md (Baseline)              │
└─────────────────────────────────────────────────────┘
```

---

## Kernregeln

1. **Kein Rohdaten-Rendering**: Die UI darf niemals `raw_course_title`, `raw_curriculum_title` oder ungefilterte `title`-Felder anzeigen.
2. **Kanonischer Pfad**: Alle Kursanzeigen laufen über `v_course_display_ssot` → `canonical_title`.
3. **Gender-Inklusiv**: Alle Berufsbezeichnungen verwenden `/-`-Form (z. B. `Verkäufer/-in`).
4. **Council-Evidence**: UI-Badges basieren auf `council_approved_at` (Timestamp), nicht auf dem Boolean-Flag.
5. **Deduplizierung**: `v_admin_visible_course_packages` zeigt nur das neueste Paket pro kanonischem Titel.

---

## Schlüssel-Komponenten

| Komponente | Typ | Zweck |
|------------|-----|-------|
| `course_title_aliases` | DB-Tabelle | Alias → Canonical Mapping |
| `normalize_course_title()` | DB-Funktion | Normalisierung (trim, case, alias) |
| `v_course_display_ssot` | DB-View | Einzige Quelle für Anzeige-Titel |
| `v_admin_visible_course_packages` | DB-View | Deduplizierte Paketliste |
| `useCanonicalTitles()` | React Hook | Frontend-Zugriff auf SSOT |
| `resolveTitle()` | Utility | Fallback-sichere Titel-Auflösung |
| `CourseNamingIntegrityPanel` | React Component | Ops-Monitoring (einzige raw-Anzeige) |
| `ci-ssot-guards.sh` | CI-Script | Regressions-Prävention |
