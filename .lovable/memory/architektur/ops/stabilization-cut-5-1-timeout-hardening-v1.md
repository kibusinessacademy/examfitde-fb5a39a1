---
name: Stabilization Cut 5.1 Timeout Hardening
description: Test-Hardening für access-rpc snapshot (Migration-Cache) und s3-ui Export-Job-Flow (Realtime-Handler-Capture statt 15s-Polling). Kein Feature-Cut. Full Suite 1413/1419 grün, 6 skipped (pre-existing). Cut 5 final eingefroren 2026-05-26.
type: feature
---

**Cut 5.1 — 2026-05-26 — Timeout Stabilization Only:**

1. **`src/__tests__/access-rpc-response-shape.snapshot.test.ts`**
   - 3073 Migrations-Dateien wurden pro RPC neu von Disk gelesen → Timeout.
   - Fix: ALL_MIGRATIONS einmalig in-Memory beim Modul-Load + Substring-Pre-Filter (`FUNCTION <name>`) vor der schweren Multiline-Regex.
   - Laufzeit: Timeout → 69 ms.

2. **`src/test/admin/s3-ui-integration.test.tsx` — Export-Job-Flow**
   - Wartete bis zu 25s auf den 15s-Polling-Fallback.
   - Fix: Supabase-Channel-Mock erfasst `postgres_changes`-Handler in `channelHandlers[]`. Tests rufen `emitGateExportJobsRealtime({ id, status: 'done' })` und triggern React-Query-Invalidation deterministisch.
   - Timeout-Budget: 25s → 10s; Laufzeit 434 ms.

**Full-Suite-Gate 2026-05-26 10:10 UTC:**
- 142 Files passed | 3 skipped (pre-existing aus Cut 2: growth-empty-result-drain, heal-contract-rpc, lesson-join-parity — alle SUPABASE_SERVICE_ROLE_KEY-gated)
- 1413 Tests passed | 6 skipped
- Duration 66.62s
- Zero Regressions, Zero Flakies → **Cut 5 final eingefroren**.

**Constraint:** Kein neuer Code in Cut 5.1 — nur Test-/Timeout-Härtung. Realtime-Handler-Capture-Pattern ist wiederverwendbar für künftige Cards mit `supabase.channel(...).on('postgres_changes', ...)`.
