---
name: Manual-Review-Frontier (Fix C)
description: Terminale Park-Schicht für chronische Pakete — fn_is_manual_review_frontier + Guard-Trigger + Admin-RPCs. Nur manueller Set, kein Auto-Mark.
type: feature
---

## Stand 2026-05-15 (Fix-C v1)

Dritte Schicht über Bronze-Lock (Fix A) und Step-Park (Fix B): markiert ganze Pakete als terminal-manual-review wenn sie chronisch failen.

## Komponenten

- **`fn_is_manual_review_frontier(package_id)`** — SSOT. Liest `feature_flags.manual_review_frontier.active=true` AND `manual_bypass=false`.
- **`v_manual_review_frontier_candidates`** — chronische Pakete: ≥5 `requeue_skipped_park` ODER ≥5 Tail-Fails (`package_run_integrity_check|_quality_council|_auto_publish`) in 24h, exkl. bereits markierter. Severity: critical (≥20 fails) / high (≥5) / medium (skips).
- **`admin_get_manual_review_frontier_candidates()`** — read-only, admin-gated.
- **`admin_set_manual_review_frontier(pkg, reason, evidence)`** — manueller Set, Audit `manual_review_frontier_set`. Reason min 10 chars.
- **`admin_clear_manual_review_frontier(pkg, reason)`** — setzt manual_bypass=true, Audit `manual_review_frontier_cleared`.
- **`trg_guard_manual_review_frontier_enqueue`** (BEFORE INSERT auf job_queue) — blockt `package_run_integrity_check|_quality_council|_auto_publish` auf Frontier-Paketen via RETURN NULL + Audit-Mirror `manual_review_frontier_enqueue_blocked`.

## Prinzip

- **Kein Auto-Mark** — Frontier ist immer eine bewusste Operator-Entscheidung. View liefert nur Kandidaten.
- **Single choke-point** auf job_queue BEFORE INSERT (deckt alle Producer ohne Code-Touch, gleiches Pattern wie `trg_guard_bronze_lock_on_job_enqueue`).
- **manual_bypass** schlägt überall durch (Helper + Trigger).

## Baseline 2026-05-15 13:23 UTC

7 Kandidaten erkannt: 4 critical (≥20 tail-fails/24h), 3 high. Top-Treiber: `ba96f6d9...` (89 fails), `d2000000-0010-...` (63 fails, bronze-locked), `dd000001-0009-...` (50 fails).
