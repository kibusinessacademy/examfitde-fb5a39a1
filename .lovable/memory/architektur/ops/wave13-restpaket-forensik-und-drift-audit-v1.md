---
name: Wave 13 — Restpaket-Forensik + präzises Drift-Audit
description: 5-Klassen-Heilstrategie für Restpakete (A/B/D-Cluster) plus 4-Kategorien-Drift-Audit als dauerhafte Materialisierungsstrategie
type: feature
---

## Restpaket-Klassifizierung (zentrale Heuristik)

`fn_heal_remaining_packages_by_class()` clustert alle Pakete ohne `exam_questions` nach drei Klassen:

| Klasse | Definition | Heilpfad |
|---|---|---|
| **A_NO_BLUEPRINTS** | qb_approved=0 AND variants=0 | Requeue `auto_seed_exam_blueprints` + `generate_exam_pool` |
| **B_NO_VARIANTS** | qb_approved≥10 AND variants=0 | Requeue `generate_blueprint_variants` |
| **D_STATE_DRIFT** | variants_eligible>0 | Direkt `fn_prebuild_promote_blueprint_variants` (Top-N Bridge) |

## Promote-Bridge v3 (offizielle Materialisierungsstrategie)

`fn_prebuild_promote_blueprint_variants` ist KEIN Notfall-Fix, sondern dauerhafte SSOT-Bridge:
- Top-N pro Lernfeld (10) statt starrer quality_score-Schwelle
- Robust JSON→int Casting für `correct_answer` (Number/String/null)
- Question-Type-Mapping: `mc_single`/`short_answer` → `concept`, `regulation`/`scenario` → `case_study`
- **Per-row Insert mit Per-Variant-Exception-Catching** für `check_violation` (GLOBAL_CANONICAL_COLLISION) und `unique_violation`
- Adoption mit `ok:true, executed:true, prebuild:true, adopted:true` Flags

## Drift-Audit System (4 Kategorien)

Nicht regex-monolithisch, sondern aufgeteilt:

| Funktion | Prüft |
|---|---|
| `fn_audit_drift_syntax_schema()` | Unqualifizierte `meta=COALESCE(meta,...)`, falsche Tabellen (`curriculums`), falsche Spalten (`completed_at`) |
| `fn_audit_drift_step_finalization()` | Fehlende `ok:true` / `executed:true` Flags bei `status=done` |
| `fn_audit_drift_bridge_presence()` | Pre-Build RPCs müssen tatsächlich materialisieren (z.B. `INSERT INTO exam_questions`) |
| `fn_audit_drift_enum_domain()` | Ungültige Enum-Werte (`status='rejected'`, `status='promoted'`) |

`fn_audit_all_drift()` aggregiert alle 4 in einer JSONB-Antwort mit `critical_count`.

## Wave 13 Ergebnis

- 25 leere Pakete → 13 Restfälle (12 von 13 Klasse-D-Paketen geheilt: 11 sofort + 1 nach Bridge-Härtung)
- Klasse A (10) + Klasse B (2) requeued — Worker materialisiert
- 1 Klasse-D-Restfall: nicht-heilbare Hash-Kollision (Frage existiert in anderem Curriculum)
- Drift-Audit findet sofort echten Befund: `fn_prebuild_generate_blueprint_variants` hat keine Materialisierung (geplante Welle 14)
