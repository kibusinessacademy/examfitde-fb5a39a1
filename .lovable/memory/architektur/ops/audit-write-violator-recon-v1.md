---
name: Audit Write Violator Recon v1
description: ops_audit_write_violations Tabelle + UPSERT-Trigger + admin RPC zur Sichtbarmachung von Direkt-INSERT-Verstößen vor Audit-Contract enforce-Cutover
type: feature
---

## Problem
Audit Write Contract trg_fn_audit_write_contract war im warn-mode (Default `app.audit_strict='warn'`). RAISE WARNING-Events wurden nirgends persistiert → Verstöße unsichtbar → enforce-Cutover blind und riskant (würde Producer wie fn_guard_publish_lxi_no_lessons brechen).

## Lösung
Recon-Tabelle `ops_audit_write_violations` (separate Tabelle, kein Recursion-Risiko):
- UNIQUE-Index `(action_type, COALESCE(trigger_source,''))`
- UPSERT zählt `violation_count`, aktualisiert `last_seen`
- `sample_metadata` für Debug
- RLS + admin-only SELECT-Policy

Trigger `trg_fn_audit_write_contract` schreibt warn-Events jetzt in Recon-Tabelle (EXCEPTION-safe Block).

Admin-RPC `admin_get_audit_write_violations` (SECURITY DEFINER, has_role-Gate) liefert Dashboard.

## Cutover-Pfad (nach 7d Beobachtung)
1. Top-violator action_types aus Recon-Tabelle ziehen
2. Producer-Functions auf `fn_emit_audit` umstellen (set_config audit.via_contract Bypass)
3. `ALTER ROLE postgres SET app.audit_strict='enforce'` (ALTER DATABASE postgres ist verboten)
4. Recon-Tabelle bleibt als Audit-Trail; künftige Violations werden hart geblockt

## Verworfen
- Recursive INSERT in auto_heal_log → Endlosschleife
- Inline UNIQUE mit COALESCE → Postgres erlaubt nur Spalten in UNIQUE, daher Expression-Index
- ALTER DATABASE postgres → durch SYSTEM_RULES verboten
