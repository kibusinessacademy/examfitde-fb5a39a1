## Ziel

ExamFit darf sich nirgends mehr wie ein Backoffice anfühlen. Es muss als ein **antizipierendes Betriebssystem** wirken, das den Beruf, die Schmerzpunkte und den Prüfungszustand des Nutzers kennt und proaktiv organisiert — Register: Notion AI / Superhuman.

Die vier Symptome (Tabellen-Look, kalte Sprache, keine Personalisierung, keine Lebendigkeit) werden gezielt abgeräumt — auf Hero, im Pruefungscheck, in /app — als **eine zusammenhängende Reise**.

## Architektur des Shifts — der OS-Spine

Einmal eingeführt, zieht sich derselbe Spine durch alle drei Surfaces:

```text
   ┌─────────────────────────────────────────────────────┐
   │  OS-Companion-Bar  (persistent, oben, ruhig)        │
   │  „Heute fokussieren wir Lernfeld 4 — 12 min"        │
   └─────────────────────────────────────────────────────┘
   ┌─────────────────────────────────────────────────────┐
   │  Beruf-Identity-Chip  (sichtbar, immer)             │
   │  → kennt Beruf, kennt Phase, kennt Schmerzpunkte    │
   └─────────────────────────────────────────────────────┘
                            ▲
                            │ derselbe Sprachcode
   Hero ──── Check ──── /app
   (verspricht) (versteht) (organisiert)
```

Drei Bausteine — werden Schritt für Schritt eingeführt:

1. **OS-Companion-Bar** — schmaler, ruhiger Strip oben (kein Banner, kein Toast). Zeigt eine einzige, antizipierende Zeile: *„Heute fokussieren wir Lernfeld 4 — du bist 6 Tage vor Prüfung."* Reagiert auf Kontext (Route, Tageszeit, letzter Zustand). Ähnliche Idee wie heute `SystemConsciousnessOverlay`, aber wärmer formuliert, an die Oberfläche gebracht und ab Hero sichtbar (nicht erst in /app).
2. **Beruf-Identity-Chip** — der Beruf ist immer sichtbar als kleiner Identity-Token (z. B. „Industriekaufmann · Sommer 2026"). Klickbar → wechselt Beruf. Ersetzt das Gefühl „generisches Tool".
3. **Anticipation-Cards** — statt Tabellen: 1–2 kontextuelle Karten mit *einer* Aussage und *einer* Aktion. Jede Karte beginnt mit einer System-Einsicht (*„Mir fällt auf …"* / *„Ich schlage vor …"*), nicht mit einem Status-Label.

## Sprachreform (SSOT)

Eine kleine Tonalitäts-Spalte, die alle drei Surfaces teilen:

| Raus (Admin) | Rein (OS) |
|---|---|
| Status / Modul / Run | Zustand / Thema / heute |
| Prüfungszustand analysieren | Lass mich kurz draufschauen |
| Auswahl bestätigen | Verstanden — los geht's |
| Fehler / Failed | Nicht sicher — hier nochmal |
| Dashboard | Heute |

Wird als kleine `os-copy.ts`-Konstante eingeführt und in allen drei Surfaces konsumiert — keine neuen Strings woanders erfinden. Begriffe wie „Quiz", „Modul", „Run" verschwinden aus den User-Surfaces (Examiner-Lexicon ist bereits vorhanden, wir erweitern es).

## Schnitt 1 — Hero (verspricht das OS-Gefühl)

- **Companion-Bar oben** wird auf Landing eingeführt — eine Zeile, leicht animiert, persönlich: *„Sag mir deinen Beruf — ich baue dir die Prüfung in 4 Minuten nach."*
- **Beruf-Selector wird zur Command-Box** (Cursor/Raycast-Register): ein Eingabefeld mit Live-Vorschlägen, das aussieht und reagiert wie ein OS-Command — Caret blinkt, Vorschläge erscheinen weich, Enter triggert sofort. Ersetzt das aktuelle Chip-Grid optisch (Chips bleiben als Schnellzugriff darunter).
- **„Living Panel"** rechts/unten zeigt **eine** sich sanft verändernde Anticipation-Card statt der drei statischen Panels — z. B. *„Heute prüft das System mündliche Stabilität bei 14 Azubis"* (live-feel, kein Echo-Tracking).
- Subline + Trust-Chips bleiben — werden in OS-Sprache umgeschrieben.

## Schnitt 2 — Pruefungscheck (das OS versteht)

- Kein Quiz-Look. Der Check wird zu einer **geführten Konversation**: System fragt eine Sache, wartet, reagiert mit einer Mini-Einsicht, fragt die nächste. Eine Frage pro Screen, ruhige Übergänge.
- Nach jeder Antwort: **eine Zeile System-Reaktion** (*„Verstanden — ich passe deine Schwerpunkte an."*) — sichtbar, dass das System mitdenkt.
- Am Ende: kein Score-Dashboard, sondern ein **„Ich habe verstanden:"-Briefing** in zwei kurzen Absätzen + eine einzige Next-Action-Karte.
- Companion-Bar zeigt während des Checks: *„Ich kalibriere deinen Prüfungszustand."*

## Schnitt 3 — /app (das OS organisiert)

- `/app` (Dashboard) wird zu **„Heute"**: keine Karten-Wand, keine Tabellen. Ein **OS-Briefing** ganz oben (3 Zeilen) + eine **primäre Anticipation-Card** *„Mein Vorschlag für jetzt: 12 min Lernfeld 4"* + maximal 2 sekundäre Hinweise.
- Bestehende Tabellen/Listen bleiben über *„Alles sehen"*-Drilldown erreichbar — sie verschwinden nicht, sie werden nur nicht mehr Default-Ansicht.
- `SystemConsciousnessOverlay` wird mit der neuen Companion-Bar konsolidiert — heute überlappen sich beide. Eine Strip-Komponente, drei Routen.
- Beruf-Identity-Chip oben links, immer sichtbar, immer klickbar.

## Sense-of-Intelligence (gegen „statisch, kein Leben")

Drei kleine, sparsame Effekte — kein Glitter:

- **Soft-Recompute-Pulse** wenn das System etwas neu bewertet (heute schon als Recalc-Toast; wird subtiler, häufiger, semantischer).
- **Typing-In Reveal** auf der Companion-Bar bei Wechsel der Aussage (1 Zeile, 250 ms, kein Loop).
- **Beruf-Echo**: nach Auswahl eines Berufs „antwortet" das System einmalig sichtbar (*„Industriekaufmann verstanden — ich richte alles aus."*) — einmal, dann ruhig.

## Was bewusst NICHT passiert

- Keine neue Tabelle, kein neuer Job-Typ, kein neuer Cron — reine Frontend/Sprach-/Komposition-Arbeit.
- Bestehende Examiner-Governance, Token-System v2 und `SystemConsciousness` werden **wiederverwendet**, nicht ersetzt.
- Admin-Surfaces (`/admin/**`) bleiben unberührt — die sind bewusst Tool, nicht OS.
- Keine Layout-Revolution auf /app — nur Default-View-Wechsel und Spine-Einführung; Drilldowns bleiben.

## Reihenfolge der Umsetzung

1. **Spine-Foundation** — `os-copy.ts`, neue `OSCompanionBar`, `BerufIdentityChip`, `AnticipationCard`. Wiederverwendung von `SystemConsciousness`-Hook + Examiner-Lexicon.
2. **Hero umarbeiten** — Command-Box-Look, Living Panel, Companion-Bar oben, Sprache angepasst.
3. **Pruefungscheck** — One-question-at-a-time-Flow + System-Reaktionszeilen + Briefing-Endscreen.
4. **/app „Heute"** — Default-View ersetzt, alte Tabellen hinter Drilldown, Spine integriert, Overlay konsolidiert.
5. **QA-Pass** — Examiner-Copy-Governance Run, Tokens-Check, A11y-Smoke, Mobile-Viewport (411×707) durch.

## Technische Details (nicht nutzerseitig)

- Neue Komponenten: `src/components/os/OSCompanionBar.tsx`, `BerufIdentityChip.tsx`, `AnticipationCard.tsx`.
- Neue SSOT: `src/lib/os/os-copy.ts` (Tonalitäts-Constants, single source).
- Hook-Wiederverwendung: `useSystemConsciousness` für Companion-Inhalt; `useActiveCourseContext` für Beruf-Chip.
- Mount-Punkte: `App.tsx` Root für Companion-Bar mit Route-Allowlist (Landing, /pruefungscheck/*, /app/*) — `/admin/*` explizit ausgeschlossen.
- Examiner-Lexicon (`src/lib/system/ExaminerLexicon.ts`) wird um die neuen Pflicht-Begriffe ergänzt; CI-Guard läuft mit.
- `HomePageV2.tsx` `PremiumHero.tsx` Anpassung; `LeadQuizPage.tsx` Flow-Refactor (One-Question-Mode); `/app`-Index-Route bekommt neue Default-View-Komponente.
- `SystemConsciousnessOverlay.tsx` wird in `OSCompanionBar` aufgehoben (DRY) — selbe Datenquelle, eine Sichtbarkeits-Logik.

## Definition of Done

- Auf Mobile (411×707) und Desktop wirkt jede der drei Surfaces wie *eine* Anwendung mit Erinnerung.
- Auf keinem User-Surface taucht „Status", „Modul", „Run", „Failed" oder „Dashboard" auf.
- Beruf wechseln → das System „antwortet" sichtbar einmal und richtet Hero/Check/App neu aus.
- Examiner-Copy-Guard und Token-Guard grün; A11y-Smoke grün.
- Keine neuen Backend-Migrationen, keine neuen Edge-Functions.

Soll ich so loslegen — oder zuerst nur Schritt 1 + 2 (Spine + Hero) umsetzen und Check/App in einer Folge-Iteration?