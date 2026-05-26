---
name: Namespace-Konsolidierung BerufOS SSOT
description: Kanonische Namespace-Regeln nach Bigbang-Cleanup — BerufOS als Plattform, ExamFit/Berufs-KI als Module, berufski deprecated, Drift-Guard
type: constraint
---

# Namespace-SSOT (BerufOS-Architektur)

## Kanonische Hierarchie
- **`berufos`** = Plattform / Brand / Betriebssystem (Shell, Header, Footer, Hub)
- **`examfit`** = Produktmodul (Prüfungsvorbereitung)
- **`berufs-ki`** = Produktmodul (KI-Copilot, Automation, Documents, Intelligence)
- **`vibeos`** = Produktmodul (Marken-Shell unter BerufOS)
- **`foerdermittel`** = Produktmodul (FördermittelOS, Authority-/Lead-System)
- **`hr`** / **`offer-comparison`** / **`suites`** / **`authority`** / **`demo`** = weitere Module unter BerufOS-Dach

## Deprecated / verboten
- **`berufski`** (Legacy-Namespace): NUR noch Redirect-Routen `/berufski`, `/berufski/*` zu 410/Redirect-Pages. Kein aktiver Code, keine Imports, keine neuen Komponenten, keine SEO-Targets.

## Drift-Guard
- `scripts/guards/namespace-drift-guard.mjs` (CI: `bun run guard:namespace-drift`)
- Verhindert: neue `berufski`-Imports, `berufski-checkout`-Pfade, Parallel-Markennamen, Shadow-Routes.
- Memory + Migrations sind als Audit-Quellen explizit ausgenommen.

## Governance-Regeln
1. Neue Produktmodule MÜSSEN als Submodul unter `berufos` mounten oder als eigenständiger Top-Level-Namespace mit Cross-Link aus `BerufOSHeader`.
2. Keine Custom-Domain-Migration ohne Brand-Entity-Schutz für `berufos.com`.
3. Jede neue Route MUSS sowohl in `src/routes/AppRoutes.tsx` als auch in `src/lib/route-registry.ts` registriert sein (CTA-Routes-Guard).
4. `berufski` als String/Pfad/Import = harter CI-Fehler.

## Bigbang Cut 4 (2026-05-26)
- 0 Treffer für aktive `berufski`-Pfade im Code (außer Redirects).
- Cleanup war No-Op — bestätigt: kein Drift im aktiven Runtime.
