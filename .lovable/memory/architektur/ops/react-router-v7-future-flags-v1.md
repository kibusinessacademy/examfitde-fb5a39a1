---
name: React-Router v7 Future-Flags v1
description: D7-Fix — BrowserRouter in src/App.tsx mit future={ v7_startTransition, v7_relativeSplatPath } opt-in, eliminiert v6→v7 Console-Warnings und entkoppelt zukünftige Major-Migration.
type: feature
---
# React-Router v7 Future-Flags (D7)

## Problem
Console-Warnings:
- "React Router will begin wrapping state updates in `React.startTransition` in v7"
- "Relative route resolution within Splat routes is changing in v7"

Audit-Finding D7 (P2). Verschmutzt DevTools-Console, blockt strukturiertes Error-Monitoring.

## Fix
`src/App.tsx` `AppContent`: `<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>`.

## Wirkung
- Warnings weg.
- Navigationen laufen ab sofort in `startTransition` → konsistentes Behavior mit v7-Major (smoother für lazy-loaded Routes wie BerufOSHub).
- Splat-Relative-Resolution v7-konform — relevant für unsere dynamischen `/berufos/:slug` und Admin-Splat-Routes.

## Strukturelle Lehre
Opt-in Future-Flags sind die einzige saubere Brücke zwischen Major-Versionen. Nicht warten bis v7-Upgrade — Flag-by-Flag aktivieren, sobald Warning erscheint, sonst akkumulieren sich Migrations-Schulden.

## Nicht enthalten
- React-Router v7 Major-Upgrade (separater Cut).
- `v7_fetcherPersist`, `v7_normalizeFormMethod`, `v7_partialHydration`, `v7_skipActionErrorRevalidation` — nicht von Warnings betroffen, kein Handlungsdruck.
