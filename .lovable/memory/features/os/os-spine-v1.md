---
name: OS-Spine v1 (Anti-Admin-Tool-Shift)
description: OSCompanionBar + BerufIdentityChip + AnticipationCard + os-copy SSOT + os-identity localStorage. Hero/Pruefungscheck/app als zusammenhängende OS-Reise — antizipierend, warm, personalisiert.
type: feature
---

# OS-Spine v1 — Anti-Admin-Tool-Shift

## Ziel
ExamFit fühlt sich wie ein antizipierendes Betriebssystem an, nicht wie ein Admin-Tool. Register: Notion AI / Superhuman.

## Bausteine
- **`src/lib/os/os-copy.ts`** — SSOT für Tonalität. `OS_TONE`, `companionMessageFor(pathname,ctx)`, `isOsSurface(pathname)`. Hero-Eyebrow, Subline, CTAs, Insight-Eröffnungen ("Mein Vorschlag", "Mir fällt auf").
- **`src/lib/os/os-identity.ts`** — leichter `localStorage` (`ef_os_beruf_v1`) + `useOsBeruf()` Hook + Cross-Tab-Sync. Bewusst kein globaler Provider (Auswahl passiert anonym vor Login).
- **`src/components/os/OSCompanionBar.tsx`** — fixer Top-Strip. Surface-aware (Landing, /pruefungscheck/*, /pruefungsreife-ergebnis/*, /app/*). Sparkle-Pulse bei Recalc, Beruf-Echo (1.8s ring) bei Beruf-Wechsel.
- **`src/components/os/BerufIdentityChip.tsx`** — Identity-Token, klickbar zu /berufe.
- **`src/components/os/AnticipationCard.tsx`** — eine Aussage + eine Aktion. Eyebrow aus `OS_TONE.insight`.

## Touchpoints
- `App.tsx` — `OSCompanionBar` über `SystemConsciousnessOverlay` gemountet.
- `SystemConsciousnessOverlay` — Top-Strip ENTFERNT (vom CompanionBar geführt). Recalc-Toast (bottom) bleibt.
- `PremiumHero.tsx` — neue Eyebrow "Dein Prüfungs-Betriebssystem", Headline "Sag mir deinen Beruf — ich richte deine Prüfung aus.", CTAs aus `OS_TONE.hero`. Beruf-Auswahl persistiert via `writeOsBeruf` (chip + search-enter).
- `AppOverviewPage.tsx` — komplett neu: "Heute"-Briefing + 1 primäre + 2 sekundäre AnticipationCards. Konto-Tabellen kollabiert hinter "Mein Konto, Rechnungen, Lizenzen ansehen →" Toggle (showAll), niemals Default.

## Verbotenes (User-Surfaces)
"Status", "Modul", "Run", "Failed", "Dashboard" — `OS_TONE.translate` ist Übersetzungs-Map.

## Bewusst NICHT umgesetzt (deferred)
- Pruefungscheck One-Question-at-a-Time (Risiko zu hoch ohne flow-refactor) — CompanionBar-Message während Check trägt das Versprechen via `companionMessageFor`.
- Examiner-Lexicon-Erweiterung (kommt mit Pruefungscheck-Iteration).
- Keine neuen Tabellen, keine Edge-Functions, keine Migration.
