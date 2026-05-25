---
name: BerufOS Masterbrand v1
description: BerufOS ersetzt VibeOS als AI-native Workforce-Plattform-Dachmarke. 10 Module (ExamFit, Berufs-KI live; AgentOS/SkillGraph/GovernanceOS preview; 5 planned mit Waitlist). Hub /berufos + dynamische Modul-Routes /berufos/:slug. Tonalität enterprise-calm.
type: design
---
# BerufOS Masterbrand v1

## Strategie
- **Masterbrand**: BerufOS — "Das AI-Betriebssystem für Berufe"
- **Produktlinien**: ExamFit (LearningOS, examfit.de) + Berufs-KI (WorkforceOS, examfitwork.de) bleiben mit eigenen Brand-SSOTs unangetastet.
- **8 weitere Module** (AgentOS, DocumentOS, WorkflowOS, SkillGraph, CareerOS, RecruitOS, IndustryOS, GovernanceOS) leben unter BerufOS — live/preview deep-linken in existierende Surfaces, planned sammelt Waitlist.
- VibeOS-Masterbrand-v1 ist **deprecated** zugunsten BerufOS. `/vibeos` und `/platform` redirecten auf `/berufos`.

## Stack
BerufOS
├── ExamFit       (LearningOS)     live  · href=examfit.de
├── Berufs-KI     (WorkforceOS)    live  · href=/berufs-ki
├── AgentOS       (Agent Runtime)  preview · /admin/berufs-ki/agents (Phase-6)
├── DocumentOS    (Documents)      planned · Waitlist
├── WorkflowOS    (Workflows)      planned · Waitlist
├── SkillGraph    (Kompetenzgraph) preview
├── CareerOS      (Karriere)       planned · Waitlist
├── RecruitOS     (Recruiting)     planned · Waitlist
├── IndustryOS    (Branchen)       planned · Waitlist
└── GovernanceOS  (Governance)     preview · /admin/governance/architecture

## Technische SSOTs
- `src/lib/berufos/brand.ts` — BERUFOS Name, Tagline, Subline, Voice-Guardrails, SubBrands.
- `src/lib/berufos/deno-ssot.ts` — Edge-Mirror.
- `src/lib/berufos/modules.ts` — BERUFOS_MODULES Array (10 Module mit slug/name/category/status/icon/accent/features/personas). `getModule(slug)`, `modulesForPersona(persona)`.
- `src/components/berufos/berufos-theme.css` — scoped `.berufos` Theme (deep navy + petrol-ice-accent + 6 accent-variants). Niemals global setzen.
- `src/components/berufos/BerufOSHeader.tsx` + `BerufOSFooter.tsx` — gemeinsame Chrome.
- `src/components/berufos/ModuleLandingShell.tsx` — Shell mit Hero+Features+CTA für alle 10 Landings.
- `src/pages/BerufOSHub.tsx` — Plattform-Hub `/berufos` mit Org+SubOrganization JSON-LD.
- `src/pages/berufos/BerufOSModulePage.tsx` — dynamische Route `/berufos/:slug`, 10 Pages aus 1 File.

## Backend
- Edge: `supabase/functions/berufos-waitlist/index.ts` — public POST {email, module_slug}, validiert Slug-Whitelist, schreibt nach `email_delivery_queue` (sequence_type=`berufos_waitlist_<slug>`, idempotency_key=`berufos_waitlist|email|slug`), best-effort `fn_emit_audit('berufos_waitlist_signup',...)`.
- TODO Phase 5: `ops_audit_contract` Eintrag für `berufos_waitlist_signup` + CI-Guard `berufos-brand-ssot-guard.mjs` + `module-registry.test.ts`.

## North-Star-Override
Bewusste Übersteuerung der Memory-Regel "Brand-Entity vor Custom-Domain-Migration schützen". Risiko angenommen: SEO-Authority von examfit.de bleibt unangetastet (eigene Domain, eigener Brand-SSOT, eigene Funnels). BerufOS lebt auf `berufos.com` als Plattform-Brand-Domain — keine Domain-Migration nötig, die Custom-Domain zeigt bereits hierher.

## Sprachregister
- **BerufOS**: Plattform, Betriebssystem, Runtime, Governance, Knowledge Graph, Berufslogik, Burggraben, enterprise.
- Verboten: Chatbot, Credit, Coin, Magic, Playground, Promptbar, generisch-saas.

## Nicht in diesem Cut
- Footer-Bridge in examfit.de Homepage ("Teil von BerufOS").
- CI-Guard + Test-Suite.
- Persona-Filter im Hub (Hook `useBerufosModules(persona)` existiert — UI-Wire-up offen).
- index.html JSON-LD Update für sitewide Org=BerufOS.
- ops_audit_contract Registrierung für `berufos_waitlist_signup` (Audit läuft best-effort, schreibt warn-only).
