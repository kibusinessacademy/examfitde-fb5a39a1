---
name: KIMI Comprehension Auditor Doctrine v1
description: Kimi's primary value is comprehension auditing — finding what classic tests, gates, and audits structurally cannot see. Not code generation, not curriculum, not tutoring. Roadmap KIMI.2→KIMI.4 (QFAF, Journey, Conversion).
type: strategie
---

# KIMI Comprehension Auditor Doctrine v1

**Established: 2026-06-13** — after KIMI.1 / KIMI.1.5 empirically proved the thesis.

## Kern-These

> Kimi macht ExamFit nicht intelligenter.
> Kimi macht ExamFit **verständlicher, benutzbarer und erfolgreicher** für echte Lernende.

Klassische Tests prüfen: *Funktioniert es?*
Kimi prüft: *Versteht der Mensch, was er jetzt tun soll?*

Das ist ein **anderer Blickwinkel**, kein Ersatz. Beides nebeneinander.

## Was Kimi NICHT ist (Anti-Scope)

- ❌ Kein Code-Generator
- ❌ Kein Tutor-Ersatz
- ❌ Kein Curriculum-Builder
- ❌ Keine Fragen-Generierung
- ❌ Keine neue Core-Architektur (Architecture Freeze gilt)

Wer Kimi auf eine dieser Aufgaben umwidmet, zerstört den Mehrwert.

## Was Kimi IST (Scope)

Comprehension Auditor mit fünf bewiesenen Modi:

1. **Reality Auditor** — analysiert reale Nutzerpfade post-login
2. **UX-Text Auditor** — erkennt `unclear_ux_text`
3. **Next-Action Auditor** — erkennt `missing_next_action`
4. **CTA-Hierarchie Auditor** — erkennt zu viele konkurrierende Aktionen
5. **Auditor-Verbesserer** — findet Schwächen in den eigenen Prüfmechanismen
   (Beispiel: Tutor 0 Buttons / 3 Links → P0 → Auditor lernte, Links als CTAs zu zählen)

## Warum klassische Gates das nicht finden

Bewiesen an drei Fällen (KIMI.1 / KIMI.1.5):

| Seite | Tech-Status | Kimi-Finding |
|---|---|---|
| `/preise` | alle Gates grün | Preis sichtbar, aber keine klare nächste Aktion |
| `/dashboard` | PASS | Login OK, aber keine klare nächste Handlung |
| `/app/exam-simulation` | Seite funktioniert | 40 CTAs / 22 Buttons / 35 Links — welcher Button? |

Klassische Checks: Existiert Route? Klickbar? Kein Fehler?
Kimi-Check: Versteht der Azubi, **warum** er hier ist und **was als nächstes** zu tun ist?

## Warum das für ExamFit existenziell ist

Ziel ist nicht "Software funktioniert", sondern "**Azubi besteht Prüfung**".
Bei 100→1k→10k Lernenden entstehen die größten Verluste nicht durch Bugs, sondern durch:
Verwirrung · Abbrüche · unklare CTAs · unverständliche Texte · fehlende Orientierung.
Jeder Abbruch kostet Conversion, Lernfortschritt und Prüfungserfolg.
Kimi arbeitet genau an dieser Stelle.

## Roadmap

### KIMI.1 ✅ ABGESCHLOSSEN
Authentifizierter Learner-Reality-Auditor + Dedup + CTA-Modell.
Erfolg: erster vollständiger P0-Reality-Fix-Zyklus
(`/app/exam-simulation` CTA-Hierarchie repariert, P0=0 verifiziert).

### KIMI.2 — Question-First + Action-First Auditor (PILOT)
Scope: **nur 5 Learner-Routen**
`/dashboard` · `/app/lernpfad` · `/app/minicheck` · `/app/tutor` · `/app/exam-simulation`

Pro Route 4 Pflicht-Fragen (QFAF):
1. Wo bin ich? (Orientation)
2. Was bedeutet das für meine Prüfung? (Stakes)
3. Was ist der nächste sinnvolle Schritt? (Action)
4. Was passiert nach dem Klick? (Outcome)

Umsetzung: bestehende Edge-Function `kimi-reality-auditor` erweitert um `audit_mode: 'qfaf'`.
**Keine neuen Edge-Functions.** Erst Pilot, dann Konsolidierung.

### KIMI.3 — Learner Journey Auditor
Komplette Kette: Beruf wählen → Lernpfad → Tutor → MiniCheck → Prüfungssimulation.
Prüft Übergänge, nicht nur einzelne Seiten.

### KIMI.4 — Conversion Auditor
Landingpage → Preis → Registrierung → erste Prüfung.
Prüft den Geld-Pfad mit demselben Comprehension-Blickwinkel.

## Constraints

- Read-only Audits. Keine Mutationen am Produkt.
- Keine neuen Core-Komponenten (Architecture Freeze respektieren).
- Jeder Sprint endet mit Pilot vor Breitenrollout.
- Findings sind **menschen-orientiert**, nicht technisch (User-Impact statt Stack-Trace).
- Auditor-Selbstkritik bleibt Pflicht-Modus — Kimi muss seine eigenen False-Positives erkennen können.
