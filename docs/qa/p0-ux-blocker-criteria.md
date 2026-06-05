# P0 UX-Blocker — SSOT Criteria

Ein **P0 UX-Blocker** liegt vor, wenn ein Nutzer eine **fachliche Kernaufgabe**
in ExamFit/Beruf=OS nicht ausführen kann.

## Definition

Ein P0 ist insbesondere gegeben, wenn:

- Login möglich ist, der Learner danach aber **keine fachliche Kernseite**
  nutzen kann.
- Navigation sichtbar ist, **Klicks aber keinen fachlich neuen Inhalt** laden.
- Eine globale **Sicherheits-/TOTP-/MFA-Seite** den gesamten Learner-Bereich
  blockiert (kanonisches Beispiel).
- Dashboard, Kurs, MiniCheck, AI Tutor, Prüfungssimulation oder Oral Exam
  nicht erreichbar sind.
- Eine Seite leer bleibt, whitescreent, dauerhaft lädt oder nur einen
  technischen Blocker zeigt.
- Ein CTA klickbar wirkt, aber keine fachliche Zustandsänderung erzeugt.
- Der Nutzer in einer Pflichtschleife hängt, ohne die eigentliche
  Lern-/Prüfungsaufgabe ausführen zu können.

Security darf weiter existieren, **aber nur seiten- oder action-bezogen**.
Es darf **kein globales MFA/TOTP-Hard-Gate** geben, das die AppShell oder
alle Learner-Routen blockiert.

## Severities

| Stufe | Bedeutung                                                          |
|-------|--------------------------------------------------------------------|
| P0    | Kernaufgabe unmöglich. Release-blockierend.                        |
| P1    | Vertrauen/Conversion stark beschädigt, Aufgabe grundsätzlich möglich. |
| P2    | Reibung/Unklarheit, Aufgabe möglich.                               |

## SSOT-Files

- `tests/customer-reality/learner/_p0-ux-criteria.ts` — Patterns + Helper
- `tests/customer-reality/learner/12-navigation-no-global-totp-blocker.spec.ts`
- `scripts/customer-reality-gate.mjs` — **Any P0 → BLOCK**
- `scripts/learner-reality-aggregate.mjs` — `J11_navigation_no_totp_blocker`

## Guard-Verhalten

Der Guard verhält sich wie ein echter Learner:
1. Login mit `REALITY_LEARNER_EMAIL` / `REALITY_LEARNER_PASSWORD`.
2. `/dashboard` öffnen, Cookies dismissen.
3. Body lesen, auf globalen TOTP/Security-Blocker prüfen.
4. Nacheinander Dashboard, Heute, Kurse, MiniCheck, Tutor, Prüfung klicken.
5. Pro Klick: Body-Diff, Blocker-Pattern-Check, Business-Content-Check.
6. Bei jedem Treffer → `recordFinding({ severity: 'P0', ... })`.

## Gate-Regel

```
Any P0 finding → BLOCK
sonst PASS>=10/12 → RELEASE · 8..9 → REVIEW · <8 → BLOCK
```

Ein TOTP-P0 blockt den Release auch dann, wenn 10/12 Journeys grün wären.

## Lokal ausführen

```bash
bunx playwright test --project=learner-reality -g "J11"
node scripts/learner-reality-aggregate.mjs
node scripts/customer-reality-gate.mjs
```
