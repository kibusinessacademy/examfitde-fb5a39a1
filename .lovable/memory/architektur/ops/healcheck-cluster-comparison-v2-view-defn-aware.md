---
name: healcheck-cluster-comparison-v2-view-defn-aware
description: admin_queue_system_healthcheck vergleicht Heal-Cluster nicht mehr nur gegen produzierte, sondern auch gegen statisch in der View definierte Cluster. Eliminiert False-Positives wenn Cluster aktuell nicht produziert werden.
type: feature
---

## Problem
`admin_queue_system_healthcheck` warnte mit `HEAL_CLUSTER_NOT_IN_VIEW` für `REQUEUE_LOOP_KILLED` und `STALE_LOCK_LOOP_HARD_KILL`, obwohl beide Cluster in `v_admin_queue_job_classification` korrekt definiert sind. Grund: der Vergleich nutzte nur `array_agg(DISTINCT cluster)` aus den **aktuell produzierten** Daten. Bei gesunder Queue (0 entsprechende Failures) tauchten die Cluster nicht auf → False-Positive.

## Fix
Healcheck liest zusätzlich `pg_get_viewdef('v_admin_queue_job_classification')` und extrahiert alle bekannten Cluster-Literale aus der View-Definition. `view_clusters_all = produced ∪ defined` ist die neue Vergleichsbasis.

## Impact
- `status` der Healcheck wird wieder `ok`, sobald die Queue gesund ist
- Neue Felder im Response: `view_clusters_produced`, `view_clusters_defined` für Debug-Transparenz
- Keine View-Änderung, nur Funktion gehärtet
