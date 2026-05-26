---
name: FördermittelOS Cut 7 — Admin/Sales Inbox + Follow-up Pipeline v1
description: Staff-only Sales Inbox + Lead Detail unter /foerdermittel/inbox(/:leadId). 4 SECURITY DEFINER RPCs (list/detail/set_status/add_activity) auf b2b_leads. Forward-only Status, PII-frei Audit via fn_emit_audit + 3 ops_audit_contract Einträge. Reuse statt parallele Sales-Logik.
type: feature
---

# FördermittelOS Cut 7 — Sales Inbox + Follow-up Pipeline

## Ziel
Aus Cut-6-Leads operative Sales-Pipeline: priorisierte Inbox, Detail-View, Wiedervorlage, Outcome — ohne neue Tabellen und ohne PII im Audit.

## SSOT-Tabellen (reused)
- `b2b_leads` (Schema unverändert): Filter `source LIKE 'foerdermittel:%'`. Activities in `meta.activities[]` JSONB-Array. Status-Werte: new|qualified|contacted|won|lost. `next_action`, `next_action_at`, `assigned_to`, `tags`, `meta` werden direkt verwendet.
- `conversion_events`: gelesen für Event-Historie (JOIN über `metadata->>'lead_id'` und `metadata->>'request_id'`).
- `auto_heal_log` via `fn_emit_audit(...)`: 3 neue action_types registriert.

## RPCs (alle SECURITY DEFINER + has_role('admin'))
- `admin_foerdermittel_leads_list(p_status text[], p_source text, p_region text, p_industry text, p_search text, p_limit int, p_offset int) → jsonb` → {items, total, counts_by_status}
- `admin_foerdermittel_lead_detail(p_lead_id uuid) → jsonb` → {lead, events[]} (Events sanitized: nur request_id/source_page/lead_quality_score/lead_tier — keine PII)
- `admin_foerdermittel_lead_set_status(p_lead_id uuid, p_new_status text, p_reason text) → jsonb` → forward-only via `fn_foerdermittel_lead_status_can_transition`; Reason ≥3 Zeichen Pflicht; invalid transition → audit `foerdermittel_lead_status_blocked`
- `admin_foerdermittel_lead_add_activity(p_lead_id uuid, p_kind text, p_note text, p_next_action_at timestamptz) → jsonb` → kind ∈ {note,call,email,meeting,followup,outcome}; note 2..2000 chars; bei `followup` setzt next_action+next_action_at

## Status-Flow (forward-only)
- new → qualified | contacted | won | lost
- qualified → contacted | won | lost
- contacted → won | lost
- won/lost: terminal
- Helper IMMUTABLE: `fn_foerdermittel_lead_status_can_transition(_from, _to)`

## Audit-Contracts (registriert in ops_audit_contract)
- `foerdermittel_lead_status_changed` required {lead_id, from_status, to_status}
- `foerdermittel_lead_activity_added` required {lead_id, kind}
- `foerdermittel_lead_status_blocked` required {lead_id, from_status, to_status, reason}
- Reason wird auf 240 Zeichen gekappt; Activity-Audit speichert NUR kind + has_followup (keine Note).

## SSOT-Lib `src/lib/foerdermittel/salesInbox.ts` (pure, deterministisch, no-net)
- Status-Graph (FORWARD), `canTransition`, `nextStatusOptions`, `isTerminal`
- Priority-Bucketing P0..P3 (overdue/hot=P0, score≥70/warm=P1, aged=P2, terminal=P3)
- `classifyFollowup` (overdue/today/soon/scheduled/none)
- `normalizeFilters`, `validateActivityDraft`, `scrubForAudit` (Email/Phone/IBAN-redaction + block-keys)
- `sortByPriorityThenScore`
- Display-Maps STATUS_LABEL/TONE, PRIORITY_LABEL, ACTIVITY_LABEL

## UI (admin-gated über `useAuth.isAdmin`)
- `/foerdermittel/inbox` — `FoerdermittelInboxPage`: Count-Strip pro Status, Filter (Status/Source/Region/Industry/Search), priorisierte Tabelle mit Priority+Status-Badges, Wiedervorlage-Klassifikation
- `/foerdermittel/inbox/:leadId` — `FoerdermittelLeadDetailPage`: Header mit Status/Tier/Score/Priority, Status-Transition mit Reason-Pflichtfeld, Report-Kontext, neue Aktivität (kind/datetime/note), Aktivitäten-Timeline, Event-Historie
- Nav-Eintrag in `AdminV2Shell` SECONDARY_ITEMS

## Routing-Constraint
`docs/admin-routing-enforcement.md` verbietet neue `/admin/*` Top-Level-Routen. Sales Inbox läuft daher unter `/foerdermittel/inbox(/:leadId)` mit `useAuth.isAdmin`-Gate (analog `/foerdermittel/reporting`). Robots: noindex,nofollow,noarchive,nosnippet.

## Guards (alle erfüllt)
- ✅ Keine PII im Audit (fn_emit_audit-Payloads enthalten nur lead_id/status/kind/reason-gekappt; scrubForAudit für Client-Logging)
- ✅ Keine parallele Sales-Logik (reuse b2b_leads, kein neues Schema)
- ✅ Kein WissensOS-Fork (Cross-OS bleibt Cut 6 Bridge)
- ✅ Status forward-only auf DB-Ebene (Helper + RPC-Gate + Audit für Blocked)
- ✅ Staff-only (has_role('admin') hart in jedem RPC + UI-Gate)

## Tests
- `src/test/foerdermittel/salesInbox.test.ts` 15/15 grün
- Gesamt FördermittelOS: 114/114 grün (Cuts 1-7)

## Verworfen / bewusst ausgelassen
- Eigene `lead_activities`-Tabelle: `meta.activities[]` reicht; spart Schema-Migration und passt zur SSOT-Strategie EXTEND_EXISTING
- Automatischer Versand (Mails/Slack): wie spezifiziert NICHT in Cut 7
- Realtime-Subscription: TanStack-Query auf Re-Filter genügt; Cut 8 optional
- `/admin/foerdermittel/*`-Pfade: durch admin-routing-enforcement verboten
