# SSOT Naming Contract

## Ziel
Verhindert Contract-Drift zwischen DB, Queue, Edge Functions, Workers und UI.

## Kanonische Regel
Alle systemischen Feldnamen sind ausschließlich `snake_case`.

Das gilt für:
- PostgreSQL Tabellen / Views / RPC-Parameter
- Supabase Edge Functions (Request + Response)
- Queue Payloads (`job_queue.payload`)
- Audit-Events / Validator-Meta / Step-Meta
- Shared Contracts / DTOs / Zod-Schemas
- Backend-nahe TypeScript-Domainmodelle

## UI-Ausnahme
`camelCase` ist nur in isoliertem UI-/Präsentationscode erlaubt.
Sobald Daten eine Systemgrenze überschreiten, müssen sie in `snake_case` normalisiert werden.

## Boundary-Regeln
Jede Eingabe an einer Boundary muss:
1. kanonisiert werden (`canonicalize_*` aus `src/lib/contracts/canonicalize.ts`)
2. validiert werden (`parse_contract` + Zod-Schema)
3. fail-closed reagieren (kein silent fallback)

## Verboten
- Neue Queue-Payloads mit `camelCase`
- Ad-hoc Alias-Fallbacks wie `payload.packageId || payload.package_id`
- Unvalidierte `any`-Payloads in Edge Functions / Workers
- Gemischte Contracts in Shared Types

## Legacy-Migration
Temporär dürfen Boundary-Canonicalizer (`canonicalize.ts`) Legacy-Aliases lesen.
Neue Producer dürfen **niemals** Legacy-Aliases schreiben.

## Kanonische Felder (SSOT)
| Snake Case (kanonisch) | Legacy Alias (nur in Canonicalizer) |
|---|---|
| `package_id` | `packageId` |
| `curriculum_id` | `curriculumId` |
| `course_id` | `courseId` |
| `blueprint_id` | `blueprintId` |
| `competency_id` | `competencyId` |
| `lesson_id` | `lessonId` |
| `step_key` | `stepKey` |
| `job_type` | `jobType` |
| `program_type` | `programType` |
| `run_after` | `runAfter` |
| `payload_version` | `payloadVersion` |
| `learning_field_filter` | `learningFieldFilter` |

## Architektur-Dateien
- `src/lib/contracts/system-contracts.ts` — Zod-Schemas (SSOT)
- `src/lib/contracts/canonicalize.ts` — Legacy-Alias-Brücke
- `src/lib/contracts/parse-contract.ts` — Fail-closed Parser
- `scripts/guard-no-camelcase-in-backend.mjs` — CI-Guard

## CI-Guard
```bash
node scripts/guard-no-camelcase-in-backend.mjs
```
Aktuell warn-only. Wird auf `process.exit(1)` umgestellt sobald Legacy bereinigt ist.
