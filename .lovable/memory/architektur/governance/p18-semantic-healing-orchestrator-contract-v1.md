---
name: P18 Semantic Healing Orchestrator Contract v1
description: Trigger-Topologie, erlaubte bounded Healing-Aktionen, Idempotency-Key-Formel und Hard-Limits für P18 (kontinuierliches Plattform-Gewissen, keine autonomen Mutationen).
type: constraint
---

# P18 — Semantic Healing Orchestrator (Contract v1)

P18 ist **kein Self-Changing System**, sondern ein **Semantic Healing Orchestrator**:
Detection · Classification · Evidence · bounded Heal · Eskalation. Human entscheidet alles, was über Whitelist hinausgeht.

## Trigger-Topologie

| Trigger-Quelle | Detection | Classification | Eskalation / bounded Heal |
|---|---|---|---|
| `known-systems.ts` geändert | SSOT-Konflikt | architecture | Warnung + Suggestion |
| Neue Route/Seite erkannt | SEO-Orphan | seo | Re-Link-Proposal (nur Vorschlag) |
| Scaffold-Run abgeschlossen | quality-drift | quality | Quality-Gate-Notify (bounded run) |
| Cron (täglich) | Archive-Drift | governance | Audit-Entry + Notify |
| Architecture Review done | live-check | architecture | Inline in Review UI |

## Erlaubte Aktionen (Whitelist)

| Aktion | Mutierend? | Erlaubt |
|---|---|---|
| Drift erkennen | nein | ✅ |
| Drift klassifizieren | nein | ✅ |
| Audit/Evidence schreiben (minimal, via `fn_emit_audit`) | minimal | ✅ |
| `known-systems` Suggestion (Proposal-Datei, kein Write in Registry) | nein | ✅ |
| Quality-Gate nach Scaffold-Mutation auslösen | bounded | ✅ |
| **Dateien automatisch ändern** | ja | ❌ |
| **Neue Tabellen erzeugen** | ja | ❌ |
| **Audit-/Runtime-Systeme umbauen** | ja | ❌ |
| **SEO-Re-Linking direkt schreiben** | ja | ❌ (nur Vorschlag) |

## Idempotency-Key (Pflichtformel)

```
idempotency_key = p18:{drift_type}:{target_fingerprint}:{policy_version}:{time_bucket}
```

- `drift_type` — z. B. `ssot_conflict`, `seo_orphan`, `quality_drift`, `archive_drift`, `live_check`
- `target_fingerprint` — stabiler Hash des Drift-Targets (Pfad/Slug/UUID/Registry-Key)
- `policy_version` — semver der Policy, gegen die klassifiziert wurde
- `time_bucket` — z. B. `YYYY-MM-DD` (täglich) oder `YYYY-MM-DD-HH` (stündlich), je Policy

Ohne stabilen Key → Loop-Risiko (Healing heilt eigene Korrekturen).

## Pflicht-Kette pro Healing-Aktion

```
Trigger → Classification → Policy → Idempotency Key → Evidence → Escalation/Bounded Action
```

Fehlt ein Glied → Aktion verboten.

## Hard-Limits (nie verletzen)

- Keine autonomen Code- oder Schema-Mutationen.
- Keine zweite Audit-/Queue-/Event-Struktur — `auto_heal_log` + `fn_emit_audit` + `ops_audit_contract` bleiben SSOT.
- Keine neue Governance-Tabelle ohne Architecture Review Approval.
- Bounded Healing nur für whitelisted Policies — alles andere klassifizieren + eskalieren.
- Jede Aktion: idempotent, auditiert, reversibel **oder** human-approved.
- known-systems.ts bleibt Registry-SSOT — P18 schlägt vor, schreibt nicht.

## Verhältnis zu bestehender Architektur

- Erweitert Architectural Continuity Guard v1.1–v1.3 um eine **Runtime-Detection-Schicht**.
- Nutzt `fn_emit_audit` + `ops_audit_contract` (kein neuer Audit-Pfad).
- Nutzt `architecture-review.ts` Output als einen von 5 Trigger-Quellen.
- Proposals landen als Files in `docs/examples/architecture-proposals/` (wie v1.1).
