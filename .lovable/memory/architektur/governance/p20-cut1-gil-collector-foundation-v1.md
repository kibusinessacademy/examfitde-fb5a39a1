---
name: P20 Cut 1 — GIL Signal Collector Foundation v1
description: Source-Registry + Review-First-Intake-Staging + Dedupe + Audit. Manueller Paste-Collector live; RSS/API bewusst disabled.
type: feature
---

# P20 Cut 1 — GIL Signal Collector Foundation

**Status:** live · 2026-05-23

## SSOT
- `gil_signal_sources` (Registry, source_key PK, kind, enabled, allowed_signal_types, default_severity)
- `gil_signal_intake` (Review-First-Staging, Status pending|approved|rejected|duplicate)
- Unique-Index `uq_gil_signal_intake_fp_active` auf (source_key, fingerprint) WHERE status<>'rejected' (Dedupe)

## Pure Contract
`src/lib/gil/collectors/contract.ts`:
- `KNOWN_COLLECTOR_SOURCES` (5: manual_paste/press_paste/competitor_paste enabled · rss/semrush disabled)
- `RESERVED_SOURCE_KEYS=['p18','manual']` — Bridge/Manual-SSOT geschützt
- `normalizeCollectorItem` + `normalizeCollectorBatch` (sanitize Title/URL, Secret-Redaction, signal_type-Whitelist, Severity-Clamp)
- `buildFingerprint`: external_id > url > title+day-bucket; `fingerprintHex` = FNV-1a 32-bit
- Trigger `trg_guard_gil_signal_sources_reserved` blockt Insert/Update mit reservierten Keys

## RPCs (alle SECURITY DEFINER + has_role admin)
- `admin_gil_list_collector_sources()` — Registry
- `admin_gil_intake_list(p_status, p_limit≤200)` — Pending/All
- `admin_gil_intake_submit_batch(p_source_key, p_items jsonb, p_reason)` — Reason ≥ 8 Pflicht, Batch ≤ 100, Defensive Re-Validation, dedupe via Pre-Check + unique_violation Catch
- `admin_gil_intake_decide(p_intake_id, p_decision, p_reason)` — approve materialisiert nach `gil_market_signals` (source=source_key, payload.origin='intake', intake_id, fingerprint, approval_reason); reject markiert rejected

## Audit-Contracts (ops_audit_contract)
- `gil_intake_submitted` [source_key, submitted, duplicates, rejected]
- `gil_intake_approved` [intake_id, signal_id, source_key]
- `gil_intake_rejected` [intake_id, source_key, reason]
- `gil_intake_duplicate_skipped` [source_key, fingerprint, reason]

## UI
- Neuer Tab "Collector Intake" in `/admin/growth` (GrowthIntelligencePage)
- `CollectorIntakeTab` mit Paste-Format-Parser (`Title | url | summary` oder JSON-Zeile, `#` als Kommentar), Source-Picker (nur enabled), Reason-Input, Live-Preview-Counter
- Pending-Review-Liste mit Approve/Reject pro Row + Reason-Pflicht

## Bewusst NICHT in Cut 1
- kein RSS-Auto-Collector (rss disabled, Cut 2)
- keine Semrush/LinkedIn-API (semrush disabled, Cut 3)
- keine pg_cron-Schedules
- keine Auto-Approve-Regeln — jeder Eintrag braucht manuelle Entscheidung

## Tests
10/10 grün:
- contract.test.ts (9): reserved/unknown/disabled/title/signal_type/severity/sanitize/fingerprint-stability/batch-dedupe
- client.test.ts (1): paste-parser plain|pipe|json|comment

## SSOT-Wahrung
- nutzt vorhandene `gil_market_signals` als finale Senke (kein Parallelsystem)
- nutzt vorhandene `fn_emit_audit` + `ops_audit_contract` (kein Parallel-Audit)
- `source='p18'` bleibt exklusiv für P20 Cut 0B Bridge — Trigger + RPCs lehnen ab
- `source='manual'` reserviert für `admin_create_manual_market_signal` (Cut 0B)
