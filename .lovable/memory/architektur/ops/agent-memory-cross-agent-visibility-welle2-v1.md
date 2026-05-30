---
name: Agent Memory Cross-Agent Visibility Welle 2
description: berufs_ki_agent_memory um source_agent/visibility_scope/confidence erweitert + v_organizational_memory_unified als virtuelle SSOT über 4 Memory-Stores
type: feature
---

# Welle 2 — Cross-Agent Visibility + Unified Memory View (2026-05-30)

## Ziel
Cross-Agent-Wissensaustausch ohne neue Infrastruktur. Vier separate Memory-Stores
werden über eine View virtuell zur SSOT — für den Moment in 12 Monaten, wo
niemand mehr weiß "wo lag diese Erkenntnis?".

## Welle 2A — Cross-Agent Visibility
`berufs_ki_agent_memory` erweitert um:
- `source_agent text` — wer hat es gelernt (fallback: agents.slug via JOIN)
- `visibility_scope text NOT NULL DEFAULT 'agent'` — agent | team | org
- `confidence numeric(4,3) NOT NULL DEFAULT 0.5` — 0..1

CHECK-Constraints + Indices (visibility+memory_type, source_agent partial).

Nutzen: Growth-Agent lernt → markiert visibility_scope='org' → Strategy-Agent
sieht es via Unified View — ohne neue Tabelle, ohne neuen Sync-Worker.

## Welle 2B — v_organizational_memory_unified
Read-only View über:
- `berufs_ki_agent_memory` (mit slug-fallback)
- `gil_research_memory` (scope→visibility_scope, superseded_by→status)
- `project_intelligence_memory` (kind, vertical_key→visibility_scope)
- `marketing_learnings` (impact_area→kind, org-scope default)

Schema: source_table, id, kind, title, summary, confidence, source_agent,
visibility_scope, cross_agent_visible, status, superseded_by, created_at, updated_at.

## Zugriff (SQL Pitfalls v1)
- View: REVOKE FROM PUBLIC/anon/authenticated, GRANT TO service_role only
- RPC: `admin_get_organizational_memory_unified(_limit, _scope, _min_confidence)` —
  SECURITY DEFINER, has_role('admin') gated, EXECUTE für authenticated

## Audit-Contract
`agent_memory_cross_agent_write` — required: agent_id, memory_type,
visibility_scope, confidence. Owner: welle2_memory_visibility.

## Bewusst NICHT gebaut (Market-Activation-Pivot)
- ❌ memory-consolidation-nightly Cron
- ❌ admin_recalibrate_policy_confidence
- ❌ Memory→KG Bridge Trigger (Welle 3 verschoben — Engpass ist Distribution, nicht Wissensgraph-Automatik)
- ❌ pgvector / Embeddings
- ❌ Neue Memory-Tabelle

## Folgen wenn nötig
Re-aktivierung erst nach erstem Enterprise-Kunden mit echtem Memory-Volumen-Druck.
