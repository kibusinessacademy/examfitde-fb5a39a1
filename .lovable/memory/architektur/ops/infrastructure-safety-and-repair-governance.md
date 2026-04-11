# Infrastructure Safety & Repair Governance

## Updated: 2026-04-11

### Status: WIP auf 13 angehoben, Prebuild-Architektur für Varianten bestätigt.

> WIP-Limit system-weit auf 13 (flat, keine Bonus-Slots mehr).
> content_runner: maxConcurrency 8, claimLimit 10 (Hard Cap 13/15).
> job_runner: maxConcurrency 6, claimLimit 8 (Hard Cap 13/13).
> Blueprint-Varianten sollen als Pre-Build außerhalb der Queue laufen (analog Seeding).

---

### Definition of Done (Phase 2b Kriterien)

| Kriterium | Ziel | Status |
|-----------|------|--------|
| A. ops_step_ssot_drift = 0 | Kein Drift nach Runner-Zyklus | ✅ 0 (Stand: 2026-04-11) |
| B. Legacy-Step Guard 24h clean | Keine Verletzungen | ⏳ Beobachtung |
| C. Zombie-Recovery ohne Regress | Keine neue Welle in 24h | ⏳ Beobachtung |
| D. 278 Reopen-Pakete durchlaufen | Blueprints → Pool → Validate konvergiert | ⏳ Requeued |
| E. WIP/Concurrency stabil | Keine Timeouts, keine Pending-Lawine | ⏳ Beobachtung |

---

### WIP & Concurrency Governance (Stand: 2026-04-11)
- WIP_TOTAL_CAP = 13, WIP_EFFECTIVE_MAX = 13 (flat, keine Bonus-Slots)
- content_runner: maxConcurrency 8, claimLimit 10 (Hard Cap 13/15) — **importiert aus worker-config.ts SSOT**
- content_runner: Prebuild-Claim max 2, innerhalb des Gesamt-CLAIM_LIMIT (nicht additiv)
- content_runner: lokale Fallbacks eliminiert — Runner bezieht Limits nur noch aus getRunnerConfig()
- job_runner: maxConcurrency 6, claimLimit 8 (Hard Cap 13/13)
- Poison-Loop Guard bei ≥ 3 identischen Fehlern blockiert Requeues
- Track-Quotas: AUSBILDUNG_VOLL=5, EXAM_FIRST_PLUS=4, EXAM_FIRST=2, STUDIUM=2

### Prebuild-Architektur für Blueprint-Varianten
- Varianten-Generierung läuft als Pre-Build Phase (außerhalb der Job-Queue)
- Trigger: direkt nach Blueprint-Seeding, vor `building`-Status
- Analog zu Curriculum Seeding, Lernfeld-Seeding, Lesson-Seeding
- Entlastet die Queue und stellt Varianten als kanonische Artefakte sicher

### Zombie-Recovery: Smart Classification (fn_smart_zombie_recovery)
- **POISON_LOOP** (attempts ≥ 5): → `failed` (terminiert)
- **STALE_LOCK_RECURRENT** (attempts ≥ 3 + STALE_LOCK error): → `failed` (terminiert)
- **HARD_ZOMBIE** (lock > 600s): → `pending` (reset)
- **SOFT_ZOMBIE** (lock > 300s): → `pending` (reset)

### Legacy-Step-Guard (trg_guard_canonical_step_keys)
- Trigger auf `package_steps` BEFORE INSERT
- Blockiert jede Einfügung nicht-kanonischer Step-Keys (29-Step SSOT)

### SSOT-Funktion: fn_expected_steps_for_track(track)
- Zentrale Quelle für erlaubte Steps pro Track
- Track-aware: Lernkurs-Kette wird für EXAM_FIRST/EXAM_FIRST_PLUS übersprungen

### Audit-View: ops_step_ssot_drift
- Zeigt MISSING_STEP, SHOULD_BE_SKIPPED, WRONGLY_SKIPPED Anomalien

### Stale-Lock Root Cause (2026-04-11, behoben)
- **Ursache**: content-runner hatte eigene Fallback-Concurrency + additiven prebuild-Claim
- **Fix**: Lokale Fallbacks eliminiert, SSOT-Import aus worker-config.ts
