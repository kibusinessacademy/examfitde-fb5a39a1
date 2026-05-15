---
name: Variant Pipeline Health Forensics v1
description: Read-only View v_variant_pipeline_health + RPC admin_get_variant_pipeline_health + UI Card. Aging-Buckets, Validate-Worker-Throughput, Drain-ETA, Top-Stalled-Packages, Hot-LF-Bottlenecks. Keine Bridges, keine Enqueue-Wirkung.
type: feature
---

# Forensik-Snapshot 2026-05-15

- 255.532 review · 10.146 approved · 261 rejected (global)
- Aging review: <1h=247, <6h=3.448, <24h=9.921, <7d=4.545, **>7d=237.371**
- Approved 24h=0, Approved 7d=3 → drain-rate praktisch 0
- validate_blueprint_variants 24h: 7 completed (Cron 242 dispatch), 0 pending
- generate_blueprint_variants 24h: 3.720 completed, 73 cancelled (heizt Backlog auf)
- Top stalled: b064 (11.168), 5d74 (7.845), 96d0 FISI (6.314), 2e8d Mechatroniker (5.303)

# Erkenntnis

Bottleneck ist nicht die Validate-Queue (immer leer), sondern dass der Validate-Worker keine Variant-Statuswechsel erzeugt — 7 Job-Completions in 24h, aber 0 Statuswechsel review→approved/rejected. Der Cron-242-Pfad enqueued zwar Validate-Jobs, doch der Worker schreibt nicht in `exam_question_variants.status`. Drain-ETA ist effektiv ∞.

# Artefakte

- `public.v_variant_pipeline_health` (per-package, service_role only)
- `public.admin_get_variant_pipeline_health()` (jsonb, has_role admin)
- `src/components/admin/heal/cards/VariantPipelineHealthCard.tsx`
- Eingebunden im Heal-Cockpit nach `FailedJobHotloopsCard`

# Nächste Frage

Der Validate-Worker `package_validate_blueprint_variants` muss inspiziert werden: produziert er Approval-Schreibvorgänge oder nur Markierung im `package_steps`? Wenn nein → Ursache der echten Stagnation.
