---
name: Publish-Readiness Effective Wrapper
description: Drift-sichere Wrapper-View v_admin_publish_readiness_effective ergänzt Council-Defer-Logik via effective_*-Spalten, statt die komplexe Hauptview zu überschreiben.
type: feature
---

# v_admin_publish_readiness_effective

**Problem**: Die ursprüngliche Council-Defer-Integration hat `v_admin_publish_readiness` per `CREATE OR REPLACE VIEW` neu geschrieben. Das ist drift-gefährlich — bei jeder Änderung an der Hauptview müssen alle Patches reproduziert werden.

**Lösung**: Wrapper-View `v_admin_publish_readiness_effective` joint zusätzlich `v_council_deferred_packages` und liefert:

- `effective_quality_council_status` — `'done'` wenn deferred
- `effective_primary_blocker` — `'READY_WITH_COUNCIL_DEFER'` wenn sonst nur Council blockiert
- `effective_publish_ready` — true wenn `publish_ready` ODER Council-Defer-Pfad greift
- `quality_council_deferred`, `quality_council_defer_reason`, `quality_council_defer_error_codes`, `quality_council_deferred_at`

## Verbindliche UI-Regel

**Cockpit / BlockerOps / Publish-UI MÜSSEN `v_admin_publish_readiness_effective` lesen, nicht die Basis-View.**

Backend / Edge-Functions können die Source-Tables (`course_packages`, `package_steps`, `council_defer_log`) direkt nutzen — sie sind nicht an den Wrapper gebunden.

## Hook

`src/hooks/usePublishReadiness.ts` liest `v_admin_publish_readiness_effective` und sortiert nach `effective_publish_ready`.
