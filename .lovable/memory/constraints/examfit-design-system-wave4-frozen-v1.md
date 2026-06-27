---
name: EXAMFIT.DESIGN.SYSTEM.OS.1 — Wave 4 Frozen
description: Wave 4 (Motion & Microinteractions) ist abgeschlossen und eingefroren. Premium-Motion-Patterns sind in den DS-Primitives verankert und reduced-motion-safe.
type: constraint
---

# Wave 4 — Motion & Microinteractions (FROZEN 2026-06-27)

## Was eingefroren ist
- `HeroSurface` rendert per Default `premium-reveal` (opt-out via `reveal={false}`).
- `ImageCard` (interactive) trägt `premium-lift premium-focus` — keine ad-hoc Hover-Transforms mehr.
- `FloatingChip` nutzt `motion-safe:hover:scale-[1.03]` + token-basierte Transition.
- `ProgressMeter` (Ring) animiert beim Mount von 100% → Ziel via `requestAnimationFrame`, respektiert `prefers-reduced-motion` strikt.
- `CoursesPage` Grid nutzt `premium-stagger` für gestaffelte Karten-Reveals.

## Nicht-Verhandelbar
- Keine neuen Motion-Keyframes ohne Foundation-Token (`--motion-*`, `--ease-*`).
- Reduced-motion-Guard im globalen CSS-Layer ist Pflicht — neue Patterns MÜSSEN dort gelistet werden.
- Keine Layout-Shifts (`translate`/`opacity`/`scale` only — keine `margin`/`width`/`height`-Animationen).
- Hex-Werte für Hover-States verboten — Token-only.

## Tests
- `src/components/examfit-ds/__tests__/wave4-motion.test.tsx` (6 Tests).
- Mobile QA Baseline: 16/16 combos (4 Viewports × 2 Themes × 2 Routes) ohne Overflow / PageErrors. Re-Validation bei jeder Änderung an DS-Primitives Pflicht.

## Aufweichen nur bei
- Performance-Regression > 100ms LCP-Impact attribuierbar auf premium-* Patterns.
- A11y-Befund, dass reduced-motion-Guard nicht greift.
Sonst: extend, don't fork.
