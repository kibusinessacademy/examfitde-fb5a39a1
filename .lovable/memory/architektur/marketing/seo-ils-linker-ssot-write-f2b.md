---
name: F2.b seo-internal-linker SSOT-Write + Idempotenz
description: seo-internal-linker upsertet jeden generierten Link in seo_internal_link_suggestions (ON CONFLICT (source_url,target_url,link_type), status='active', source_doc_id wenn bekannt, link_type aus 3 Quellen → cluster_to_cluster | cluster_to_pillar | cluster_to_product). Rejected-Rows werden VOR Upsert per SELECT gefiltert und nie auto-revived. Audit action_type=seo_internal_linker_run mit suggestions_upserted/skipped_rejected/documents_processed/documents_updated. Result-Shape unverändert (ok/generated/batch_complete/remaining + neu suggestions_upserted/skipped). Voraussetzung F2.a Schema-Härtung (unique key + status check).
type: feature
---

## Mapping linkReport → SSOT
| Generator-Quelle (linker logic)      | link_type           | source_doc_id | target_doc_id |
|--------------------------------------|---------------------|---------------|---------------|
| Related SEO docs (same beruf)        | cluster_to_cluster  | doc.id        | rel.id        |
| Beruf detail page (`/berufe/<slug>`) | cluster_to_pillar   | doc.id        | NULL          |
| Shop CTA (`/shop`)                   | cluster_to_product  | doc.id        | NULL          |

`source_url` = `docTypeUrlMap[doc.doc_type] + '/' + doc.slug` (gleiche URL-Konvention wie Frontend-Hook `useInternalLinks`).

## Idempotenz / Rejected-Schutz
1. SELECT (source_url,target_url,link_type) WHERE status='rejected' für Batch-Keys.
2. Filter rejectedKey-Set raus, zähle `suggestions_skipped_rejected`.
3. Upsert restliche Rows mit `onConflict: 'source_url,target_url,link_type'` + `status:'active'` + `updated_at: now()`.

## Result-Shape (unverändert + 2 Felder)
```json
{ "ok": true, "generated": <n>, "batch_complete": true, "remaining": 0,
  "documents_processed": N, "documents_updated": M,
  "suggestions_upserted": X, "suggestions_skipped_rejected": Y,
  "report": [...] }
```

## Audit
`auto_heal_log.action_type='seo_internal_linker_run'` mit metadata{mode, documents_processed, documents_updated, suggestions_upserted, suggestions_skipped_rejected, total_links_generated}.

## Out of scope
- Status-Harmonization (hook reads `active`, admin approval flow uses `approved`) → F2.c.
- Backfill bestehender 3744 `suggested` Rows → F2.c.
- target_doc_id-Resolve für berufe/shop (FK auf seo_documents → bleibt NULL).

## Rollback
Linker auf vorigen Commit zurücksetzen (kein DB-Schema-Touch). Bestehende Suggestion-Rows bleiben in seo_internal_link_suggestions.
