---
name: Phase 2B Hardening – Content Graph Smoke T1–T7
description: _smoke_growth_content_graph() RPC + CI Hard-Gate (PR + daily). 7/7 acceptance tests green 2026-05-07.
type: feature
---

`public._smoke_growth_content_graph()` (SECURITY DEFINER, service_role only) deckt T1–T7 ab:

- T1 register inserted
- T2 register updated (same slug)
- T3 link inserted
- T4 link updated (same from/to/edge_type)
- T5 isolated node → all 4 missing flags true
- T6 fully wired node → not orphan
- T7 inbound-only node → only outbound/funnel_next/money_page missing

Reuses existing admin from `user_roles` (kein synthetischer User → kein FK-Bruch zu auth.users, kein superuser-only `session_replication_role`). Cleanup nur prefix-gefiltert (`__smoke_p2b_*`).

CI: `scripts/guards/content-graph-smoke.mjs` + `.github/workflows/content-graph-smoke.yml` (PR + daily 06:15 UTC). Hard-fail bei `fail > 0`.

Damit validiert:
- Orphan-Klassifikation (4 Flags) korrekt
- Insert-vs-Update-Semantik (Pre-Existence-Check statt FOUND nach ON CONFLICT) korrekt
- `auto_heal_log.metadata`-Pfad korrekt
