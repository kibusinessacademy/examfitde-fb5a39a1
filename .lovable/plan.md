# BerufOS Masterbrand-Switch — Plattform-Rollout-Plan

Maximaler Scope laut deinen Antworten: BerufOS ersetzt VibeOS vollständig, North Star wird überstimmt, voller Plattform-Hub mit allen 10 Modul-Landings. Memory-Regel "Brand-Entity vor Custom-Domain-Migration" wird dokumentiert übersteuert (nicht stillschweigend).

## Brand-Architektur (locked)

```text
BerufOS  — Masterbrand: Das AI-Betriebssystem für Berufe
├── ExamFit       (LearningOS)     live  — examfit.de bleibt
├── Berufs-KI     (WorkforceOS)    live  — examfitwork.de bleibt
├── AgentOS       (Agent Runtime)  preview — Phase-6 existiert bereits
├── DocumentOS    (Documents)      planned — Waitlist
├── WorkflowOS    (Workflows)      planned — Waitlist
├── SkillGraph    (Kompetenzgraph) preview — Knowledge-Graph existiert
├── CareerOS      (Karriere)       planned
├── RecruitOS     (Recruiting)     planned
├── IndustryOS    (Branchen)       planned
└── GovernanceOS  (Governance)     preview — Architecture-Guard existiert
```

**Nicht angefasst:** ExamFit B2C-Funnels, Stripe-Brand, Email-From, examfit.de SEO, B2B-Brand `ExamFit@work`. Diese behalten ihre eigenen Brand-SSOTs. BerufOS lebt als Dachmarke darüber.

## Phasen

### Phase 1 — Foundation (dieser Cut)
1. **Modul-Registry SSOT** `src/lib/berufos/modules.ts` — 10 Module mit slug, name, tagline, icon, status (live|preview|planned), route, hero-copy, features[], persona-mapping.
2. **BerufOS Brand-SSOT** `src/lib/berufos/brand.ts` — Name, Tagline, Tonalität, gefasste Copy-Bausteine. Mirror für Edge: `src/lib/berufos/deno-ssot.ts`.
3. **BerufOS-Theme** `src/components/berufos/berufos-theme.css` — scoped `.berufos`. Premium-Enterprise: Deep navy + structured petrol + sharp ice-accent. Ersetzt `.vibeos` Theme (Datei bleibt für Übergang, Routes ziehen um).
4. **Memory-Update** — VibeOS-Memory als deprecated markiert, `mem://design/berufos-masterbrand-v1` neu, North-Star-Override dokumentiert mit Begründung.

### Phase 2 — Hub & Modul-Landings
1. `/berufos` Plattform-Hub — Hero, 10-Modul-Bento-Grid (live/preview prominent, planned als Waitlist-Karten), Knowledge-Graph als zentraler Burggraben visualisiert.
2. Routes umziehen: `/vibeos` → 301 nach `/berufos`, `/platform` → 301 nach `/berufos`.
3. **10 Modul-Landings**: `/berufos/learning`, `/berufos/workforce`, `/berufos/agents`, `/berufos/documents`, `/berufos/workflows`, `/berufos/skills`, `/berufos/career`, `/berufos/recruit`, `/berufos/industry`, `/berufos/governance`. Live-Module: Deep-Link nach examfit.de Hero / `/admin/berufs-ki/agents`. Planned-Module: Waitlist-Form (email_delivery_queue → bestehende Sequenz `berufos_waitlist`).
4. Eine wiederverwendbare `<ModuleLandingShell>` Komponente — Hero, 3-Spalten-Feature-Grid, Use-Cases, CTA. Alle 10 Landings drüber gebaut, kein Copy-Paste-Drift.

### Phase 3 — UX-Regel "Berufsfeld first"
1. `BerufContextProvider` liest `mem://os-identity` (existiert) und filtert Modul-Sichtbarkeit am Hub.
2. Drei Persona-Views als Beispiele: Azubi → ExamFit + SkillGraph + CareerOS. Hausverwaltung → DocumentOS + WorkflowOS + GovernanceOS + IndustryOS. Recruiter → RecruitOS + SkillGraph.

### Phase 4 — Cross-Brand-Bridges
1. Footer in examfit.de bekommt "Teil von BerufOS" Backlink.
2. Footer in `/berufos` referenziert ExamFit + Berufs-KI als Produktlinien.
3. SEO: `<link rel="alternate">` zwischen Schwester-Marken, JSON-LD `Organization` mit `subOrganization[]` auf BerufOS-Hub.

### Phase 5 — Audit & Lock
1. Architecture-Guard erweitern: `BerufOS-Module-Registry` als known-system, neue Modul-Slugs müssen über Registry gehen (nicht hardcoded).
2. CI-Guard `scripts/guards/berufos-brand-ssot-guard.mjs` — verbietet Hardcoded "BerufOS"-Strings außerhalb der SSOT.
3. Test: `src/test/berufos/module-registry.test.ts` — alle Routes resolvable, alle live-Module haben Hero-Copy, kein planned-Modul mit Stripe-Link.

## Technical Section

**Routing**
- Hub: `src/pages/BerufOSHub.tsx`
- Module: `src/pages/berufos/<module>.tsx` (10 Files via Shell)
- Routes registriert in `src/App.tsx` unter bestehender Public-Routes-Section.
- `/vibeos`, `/platform` → `<Navigate to="/berufos" replace />`

**Theme-Scoping**
- `.berufos` Klasse auf Top-Level-Container jedes BerufOS-Pages.
- Tokens NUR via scoped CSS-Vars, keine globalen Token-Mutationen → ExamFit (`HomePageV2`) und Berufs-KI bleiben unberührt.

**Persona-Filter**
- `useBerufosModules(persona?)` Hook — gibt gefiltertes Array zurück.
- Persona aus `useOsBeruf()` (existiert) → Mapping in `modules.ts`.

**Waitlist (planned modules)**
- Reuse `email_delivery_queue` mit `template_key=berufos_waitlist_<module>`.
- Idempotency-Key `berufos_waitlist|<email>|<module>`.
- Audit `auto_heal_log` action_type=`berufos_waitlist_signup` (Contract via `ops_audit_contract` registrieren).

**SEO**
- `/berufos` Canonical `https://berufos.com/berufos` (Custom-Domain examfit.de zeigt nicht auf BerufOS-Hub — wir nutzen vorhandene `berufos.com`-Domain als Plattform-Brand-Domain).
- robots.txt + sitemap.xml: 11 neue Public-Routes.
- JSON-LD `Organization` mit `name: BerufOS`, `subOrganization: [ExamFit, Berufs-KI]`.

**Memory**
- `mem://design/berufos-masterbrand-v1` (NEU)
- `mem://design/vibeos-masterbrand-v1` (markiert deprecated, Hinweis auf v1)
- `mem://constraints/north-star-override-2026-05-25-berufos-rebrand.md` (NEU — dokumentiert Override mit Risk-Annahme)
- `mem://index.md` Core: "BerufOS = Masterbrand. ExamFit + Berufs-KI = Produktlinien. /berufos = Plattform-Hub. Niemals BerufOS-Theme global setzen."

## Was bewusst NICHT in diesem Cut passiert
- Keine Migration von ExamFit-Funnels/Stripe/Email-Brands.
- Keine echten DocumentOS/WorkflowOS/CareerOS/RecruitOS/IndustryOS Backend-Features — nur Brand-Landings + Waitlist.
- Keine Industry-Sub-Modules (HausverwaltungOS etc.) als eigene Pages — nur als IndustryOS-Beispiele auf der Landing.
- Kein Custom-Domain-Switch (`berufos.com` zeigt bereits hierher — passt).

## Rollout-Reihenfolge in dieser Session
1. Phase 1 komplett (Foundation: Registry + Brand + Theme + Memory)
2. Phase 2 komplett (Hub + 10 Landings via Shell + Redirects)
3. Phase 3 minimal (Hub-Filter via Persona, ohne Deep-Touch in ExamFit)
4. Phase 4 minimal (Footer-Bridges)
5. Phase 5 (Tests + Guard)

Geschätzter Umfang: ~15–20 Files. Eine zusammenhängende Build-Session.