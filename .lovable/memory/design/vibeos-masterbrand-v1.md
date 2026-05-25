---
name: VibeOS Masterbrand v1
description: VibeOS als Plattform-Dachmarke, ExamFit (Learning OS) + Berufs-KI (Workforce OS) als Produktlinien; Landingpage /vibeos mit scoped .vibeos Theme
type: design
---
# VibeOS Masterbrand v1

## Strategie
- **Masterbrand**: VibeOS — "AI-native Operating Systems for Workforces"
- **Produktlinien**: ExamFit (Learning OS, examfit.de) · Berufs-KI (Workforce OS, /berufs-ki)
- **ExamFit ≠ Berufs-KI** — Sprache, Visuals und Funnels strikt getrennt; gemeinsamer Kompetenz-SSOT als Burggraben.

## Stack (logisch)
VibeOS
├── ExamFit (Learning OS)
├── Berufs-KI (Workforce OS)
├── Agent Runtime
├── Workflow Runtime
├── Document OS
├── Knowledge Graph
├── Governance Layer
└── Industry Modules

## Technische Implementierung
- Landingpage: `src/pages/VibeOSLandingPage.tsx` — Routes `/vibeos` und `/platform`.
- Theme: `src/components/vibeos/vibeos-theme.css` — alles unter `.vibeos` scoped (dark, electric mint accent `162 90% 55%`, grid-bg, gradient text). **Keine globalen Tokens überschrieben** — ExamFit-Petrol-System bleibt SSOT für /.
- SEOHead nutzt `canonical=/vibeos` (nicht `path`).

## Sprachregister
- **VibeOS**: Plattform, Infrastruktur, Runtime, Knowledge Graph, Governance, AI-native.
- **ExamFit**: lernen, Prüfung, bestehen, Simulation, Readiness, Kompetenzaufbau.
- **Berufs-KI**: Produktivität, Dokumente, Workflows, Agenten, SOPs, Prozesse, Teams.

## Nicht tun
- VibeOS-Tokens nicht global setzen (würde ExamFit zerstören).
- ExamFit-Landingpage (HomePageV2) nicht überschreiben — sie bleibt Learning-OS-Hero.
- Berufs-KI nicht in ExamFit-Funnels mischen.
