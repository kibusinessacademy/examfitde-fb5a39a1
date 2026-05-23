---
name: P20 Cut 0B — P18 → GIL Bridge + Manual Signal + Briefing Reason
description: P18-Drift wird strategisches GIL-Signal (signal_type=internal_drift, source=p18) idempotent über admin_bridge_p18_drift_to_gil. Manueller Signal-Insert via admin_create_manual_market_signal mit Reason-Pflicht ≥ 8. Executive-Briefing-Button bestand bereits, jetzt im Cockpit als bewusster Eintragspunkt verkabelt. Keine Auto-Collector. Keine zweite Signal-Tabelle.
type: feature
---

## Was Cut 0B liefert
- **Bridge-Pure** `src/lib/governance/p18-gil-bridge.ts` — deterministisches Mapping P18-Ledger → GIL-Signal-Draft. Severity-Map block→critical, warn→warning, info→info. Confidence 0.9/0.7/0.5.
- **Bridge-Client** `src/lib/governance/p18-gil-bridge.client.ts` — ruft RPCs.
- **RPC** `admin_bridge_p18_drift_to_gil(p_idempotency_key, p_reason)` — admin-gated, reason ≥ 8, idempotent über partial unique index `uq_gil_market_signals_p18_idem` (`source='p18'` + `signal_type='internal_drift'` + `payload->>'idempotency_key'`). Audit `gil_internal_drift_signal_created` mit `result=created|already_exists`.
- **RPC** `admin_create_manual_market_signal(...)` — admin-gated, reason ≥ 8, blockt source='p18' (reserviert). Audit `gil_manual_signal_created`.
- **UI P18 Bounded Heal Panel** — pro Ledger-Zeile Aufklapper „Als GIL-Signal übernehmen" mit Reason-Feld. Aktiv nur für status ∈ {detected,escalated,heal_requested,healed,rejected}.
- **UI GIL Signal-Feed** — Manual-Signal-Form (Title/Source/Type/Severity/Tags/Summary/Reason); P18-Drift-Badge + Ledger-Key-Referenz; keine Raw-Payload-Anzeige.
- **UI Executive-Briefing-Button** — bestand seit P19; Cut 0B bestätigt Reason-Pflicht-Pfad (`admin_run_executive_briefing` ≥ 8 Zeichen Audit + `executive-agent` Edge).

## Bewusst NICHT gebaut (Cut 0B)
- Keine externen Auto-Collector (RSS/Semrush/LinkedIn/LLM) — kommt in P20 Cut 1.
- Keine zweite Signal-Tabelle, keine zweite Audit-Tabelle, keine eigene Queue.
- Keine P18-Mutation außerhalb der bestehenden Ledger-Logik.
- Keine Raw-Payload-Anzeige im Signal-Feed; Bridge-Summary ist sanitized + auf 600 Zeichen gekappt.

## Audit-Contracts
- `gil_internal_drift_signal_created` required: idempotency_key, drift_type, severity, source, signal_id, result
- `gil_manual_signal_created` required: signal_type, source, severity, signal_id, reason

## Tests
- `src/lib/governance/__tests__/p18-gil-bridge.test.ts` — 9 grün:
  - severity-map block/warn/info
  - signal_type/source/idempotency_key/evidence_refs/tags
  - keine Raw-Proposal-Keys; payload-keys exhaustive 9
  - secret-shape (sb_…, eyJ…) wird redacted
  - idempotency_key stabil über mehrere Mappings
  - unknown drift_type → unknown_drift_type rejected
  - empty idempotency_key → invalid_input rejected
  - alle 7 KNOWN_BRIDGEABLE_DRIFT_TYPES ok
  - integration runP18Cut1 → mapDriftSignalToGil
- DB-Idempotenz: partial unique index erzwingt 1 GIL-Signal pro P18-Ledger-Key.

## Architecture Continuity Guard
- SSOT_FIRST: gil_market_signals bleibt SSOT — kein Fork.
- BRIDGE_DONT_FORK: P18 Forensik bleibt SSOT für Drift; GIL ist konsumierender Empfänger.
- AUDITABLE_MUTATIONS: jede Insert + idempotenter Hit erzeugt fn_emit_audit-Eintrag.
- NO_AUTONOMOUS_PRODUCTION_WRITES: alle Writes hinter admin-gate + Reason ≥ 8.

## Roadmap
- **P20 Cut 0C** Unified Platform Conscience Hub (P18 + GIL + Runtime in einem Eintrag)
- **P20 Cut 1** externe Auto-Collector (RSS/Semrush/LinkedIn) als eigene Producer in `gil_market_signals`
