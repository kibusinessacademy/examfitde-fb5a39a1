---
name: No ambiguous Postgres function overloads
description: Verbietet semantisch divergente Overloads gleichen Namens, wenn die Aufruf-Arity auch durch DEFAULT eines anderen Overloads erreichbar ist (sqlstate 42725). Bekannte Vorfälle und Regel.
type: constraint
---

## Regel
Bei Funktions-Overloads in `public.*` mit identischem Prefix-Typvektor und überlappender Aufruf-Arity (durch DEFAULT-Argumente einer Variante) darf NUR EINE kanonische Implementation existieren. Alle anderen Overloads MÜSSEN reine SQL-Wrapper sein, die an die kanonische delegieren.

Postgres-Fehler bei Verstoß: `42725 function ... is not unique`.

## Erkennung
SQL-Forensik (Pairing aller Overloads, Prefix-Typgleichheit, Arity-Überlappung):
- siehe Heal-Migration 2026-05-05 fixe von `fn_step_already_terminal` und `admin_force_steps_done`.

## Vorfälle (für Audit)
- 2026-05-05: `fn_step_already_terminal(text,uuid)` vs. `(text,uuid,jsonb DEFAULT)` — 530 Hits in `resolve_pending_enqueue_per_row_error`. Fix: 2-Arg-Wrapper gedroppt.
- 2026-05-05: `admin_force_steps_done` 3/4/5-Args (alle mit DEFAULT, semantisch divergierende Bodies) — 32 Hits in `phantom_cleanup_published_failed`. Fix: 3- und 4-Arg auf SQL-Wrapper → 5-Arg konsolidiert.

## Why
Ambiguity bricht Auto-Heal-Loops still — der Trigger/RPC fällt auf 42725, der Heal-Worker re-enqueued endlos und produziert Cluster-Spam.
