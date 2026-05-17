---
name: Internal-Link-Materialization E3c v1
description: SSOT v_internal_link_materialization_candidates (8 Decisions: READY_TO_MATERIALIZE, ALREADY_ACTIVE, SOURCE_NOT_PUBLISHED, TARGET_NOT_PUBLISHED, ANCHOR_MISSING, DUPLICATE_LINK, UNSAFE_CONTENT_STATE, NO_ACTION) + admin_materialize_internal_links(limit ≤100, dry_run default, live verlangt reason ≥5 chars) + idempotent race-safe Status-Flip suggested→active. Audit 4 contracts (_detected/_applied/_skipped/_summary) je mit correlation_id. View nur service_role; RPCs has_role-gated. UI InternalLinkMaterializationCard im Heal-Cockpit. Baseline 2026-05-17: 118 active + 3744 SOURCE_NOT_PUBLISHED (contextual blog: keine published seo_documents → kein READY) — Pipeline-Wahrheit: Blog-Publishing ist der Bottleneck.
type: feature
---

## Architektur

- View `v_internal_link_materialization_candidates`: klassifiziert jede `seo_internal_link_suggestions` Row in genau eine Decision. Route-basierte Link-Typen (cluster_to_pillar/_cluster/_product, pillar_to_cluster) gelten als published; `contextual` erfordert published `seo_documents` auf beiden Enden.
- RPC `admin_materialize_internal_links(p_limit, p_dry_run, p_reason)`: Detect-Snapshot → Walk ready bis cap → Flip nur suggested→active (race-safe) → Skip-Audit bei lost-race. Hard-Cap 100. Live-Apply braucht reason ≥5.
- RPC `admin_get_internal_link_materialization_summary()` + `admin_get_internal_link_materialization_recent(p_limit)` für Cockpit.
- Audit-Contracts registriert über `ops_audit_contract`; alle Writes via `fn_emit_audit`.

## Guards

- `scripts/guards/internal-link-materialization-guard.mjs`: blockt direkte Client-Mutations auf `seo_internal_link_suggestions`.
- `src/__tests__/e3c-internal-link-materialization.contract.test.ts`: RPC-/Decision-/Audit-Surface pin.

## Smoke 2026-05-17

| Decision               | Count |
|------------------------|------:|
| SOURCE_NOT_PUBLISHED   | 3744  |
| ALREADY_ACTIVE         |  118  |
| READY_TO_MATERIALIZE   |    0  |

→ Materialisierungs-Pipeline ist sauber; der real fehlende Hebel ist Blog-Publishing (E3d Kandidat: SEO Dead-End Guard + Blog-Publish Gate).
