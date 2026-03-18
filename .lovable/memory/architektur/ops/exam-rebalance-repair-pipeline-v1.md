# Memory: architektur/ops/exam-rebalance-repair-pipeline-v1
Updated: now

Das 'Exam Rebalance' System (`package-exam-rebalance`) ist ein gezielter Repair-Orchestrator für blocked Pakete mit Integrity-Gate-Verletzungen im Exam-Pool. Es diagnostiziert `hard_fail_reasons` aus dem Integrity-Report und führt vier spezialisierte Reparaturstrategien aus:

1. **Difficulty Rebalance**: Pruning der schwächsten 'easy'-Fragen (qc_status → rejected) um den Easy-Anteil unter 15% zu senken, ohne neue Fragen zu generieren.
2. **Bloom Gap Repair**: Heuristische Reklassifizierung (remember→understand bei Erklärungsfragen, easy→medium bei Berechnungsfragen) + Enqueue von `pool_fill_bloom_gaps` für AI-Backfill.
3. **Competency Coverage**: Delegation an `pool_fill_bloom_gaps` zur gezielten Fragengenerierung für unterversorgte Kompetenzen.
4. **MiniCheck Repair**: Reset der `generate_lesson_minichecks` + `validate_lesson_minichecks` Steps für unparsed/empty Lektionen.

Nach erfolgreicher Reparatur wird die Pipeline-Tail automatisch neu gestartet: Paket-Status → `building`, Reset von `elite_harden` → `quality_council` → `run_integrity_check` → `auto_publish`. Die Enqueue-Guard erlaubt repair jobs (`package_exam_rebalance`, `pool_fill_bloom_gaps`) explizit für Pakete im Status `blocked`. Alle Aktionen werden in `auto_heal_log` und `admin_notifications` auditiert. Ein One-Click 'Repair'-Button in der ProblemPackagesCard ermöglicht die manuelle Auslösung für blocked Pakete.
