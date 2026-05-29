---
name: BerufOS Funktionsaudit — Waitlist Slug-SSOT + Persona-URL v1
description: F1-Fix — berufos-waitlist Edge-Function whitelistete noch alte M1-Slugs (learning/workforce/industry), neue Canonical-Slugs (examfit/berufs-ki/industries) + voiceos schlugen mit invalid_module_slug fehl. Slug-SSOT zentral in supabase/functions/_shared/berufos-ssot.ts; Legacy-Aliase werden transparent normalisiert. Plus F2: Hub-Persona-Filter persistiert in ?persona=.
type: feature
---
# BerufOS Funktionsaudit — Waitlist Slug-SSOT + Persona-URL (F1+F2)

## Problem
Funktionsaudit der BerufOS-Module-Workflows fand zwei strukturelle Lecks:

**F1 (kritisch)**: `supabase/functions/berufos-waitlist/index.ts` hatte
`VALID_SLUGS` als hardcoded Set mit Pre-M1-Slugs: `learning, workforce, agents,
documents, workflows, skills, career, recruit, industry, governance`. Nach
M1-Migration (2026-05-25) heißen die Canonical-Slugs `examfit, berufs-ki,
industries`, und `voiceos` kam komplett dazu. Jedes Waitlist-Signup von
`/berufos/agents`, `/berufos/governance`, `/berufos/documents`,
`/berufos/workflows`, `/berufos/career`, `/berufos/recruit`,
`/berufos/industries`, `/berufos/voiceos` schlug mit
`{error: "invalid_module_slug"}` fehl — D4-Brücke (preview/planned →
Waitlist) war funktional tot für 8 von 11 Modulen.

**F2**: Hub-Persona-Filter war nur lokaler React-State — nicht teilbar,
nicht persistiert, kein Deep-Link möglich.

## Fix (Brücke, kein Doppelbau)
- Neuer **shared SSOT** `supabase/functions/_shared/berufos-ssot.ts` mit
  `BERUFOS_MODULE_SLUGS`, `BERUFOS_SLUG_ALIASES`, `resolveBerufosSlug()`,
  `isValidBerufosSlug()`. Mirrort `src/lib/berufos/modules.ts` für die
  Deno-Welt — Edge-Functions importieren NUR von hier, kein Cross-Tree-Import
  in `src/`.
- `berufos-waitlist/index.ts` importiert die Validator-Helper, normalisiert
  Legacy-Slugs transparent auf Canonical (`learning` → `examfit`), schreibt
  immer mit Canonical-Slug in `email_delivery_queue` (sequence_type +
  idempotency_key konsistent).
- Bestehender `src/lib/berufos/deno-ssot.ts` wurde ebenfalls auf das
  Vollformat erweitert (Symmetrie zur Edge-Shared), bleibt als Brand-SSOT für
  TS-Konsumenten relevant.
- **F2**: `BerufOSHub.tsx` liest `?persona=` aus URL beim Mount, hält
  React-State und URL bidirektional synchron via `useSearchParams` +
  `useEffect` (`replace: true`, keine History-Pollution). Persona-Filter
  ist jetzt teilbar (z.B. `/berufos?persona=recruiter`).

## Strukturelle Lehre
Slug-Whitelists sind Vertrags-SSOTs — sie müssen IMMER aus dem zentralen
Modul-Register abgeleitet sein, nie hardcoded dupliziert. Sobald ein
zweiter Speicherort für die "gültigen Slugs" entsteht (hier: Edge-Function),
ist Drift nur eine Migration entfernt. Lösung: shared Mirror-Datei in
`supabase/functions/_shared/`, Edge importiert nur von dort.

Zweite Lehre: Legacy-Aliase müssen auf zwei Ebenen wirken — UI (Routing)
UND Backend-Validation. Sonst bricht entweder der alte Deep-Link oder das
neue Submit.

## Wirkung
- Alle 11 Module liefern jetzt funktionierende Waitlist-Submits.
- `/berufos?persona=azubi` ist teilbar (Sales, Email, Ads).
- Slug-Migrationen brauchen nur noch einen einzigen Edit-Punkt
  (`_shared/berufos-ssot.ts` + `src/lib/berufos/modules.ts`).

## Bezug
- M1 Slug-Migration 2026-05-25 (modules.ts) — diese Migration vervollständigt sie.
- D4 Waitlist-Brücke (preview-no-href) — funktional jetzt überhaupt erst nutzbar.
- W1 Admin/Public href Split — Public-CTAs landen verlässlich auf Waitlist.

## Nicht enthalten
- CI-Guard, der hardcoded Slug-Listen außerhalb der zwei SSOT-Files verbietet
  (Test-Invariante in `module-registry.test.ts` deckt nur Frontend-Seite).
- ops_audit_contract Registrierung für `berufos_waitlist_signup` (Audit
  bleibt best-effort, schreibt warn-only).
- Persona-Tracking in `conversion_events` beim Hub-Visit mit Persona-Param.
