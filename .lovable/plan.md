<final-text>Forensische Abschlussbewertung (code- und screenshotbasiert, ohne finale Live-DB-Gruppierung)

Problembild

- Es gibt aktuell offenbar wieder sichtbare Queue-Aktivität, aber keinen echten fachlichen Durchsatz in Richtung completed.
- In den Processing-Karten sind drei Fehlersignaturen sichtbar:
  1. STALE_LOCK_RECOVERY: attempt x/y by content-runner-...
  2. stuck-scan: stale processing heartbeat
  3. HTTP 502: upstream proxy error (HTML stripped)
- Wichtig: Die Admin-Queue zeigt auf Processing-Karten das persistierte last_error-Feld aus job_queue. Das ist also der letzte bekannte Fehlerzustand des Jobs, nicht zwingend der Fehler der gerade laufenden Ausführung.
- Die React-Console-Warnung um Badge/refs ist nur UI-Rauschen und nicht ursächlich für den Pipeline-Stau.

Root Cause

1. RC1 – hart belegt: Die Jobs konvergieren nicht, sondern werden von Recovery-Mechanismen wieder aus processing herausgelöst.
- STALE_LOCK_RECOVERY kommt direkt aus dem content-runner.
- stuck-scan: stale processing heartbeat kommt direkt aus stuck-scan über kill_stale_processing_jobs_v2.
- Beide Signaturen stehen für Recovery/Reset, nicht für echten Fortschritt.

2. RC2 – hart belegt: HTTP 502 upstream proxy error ist ein Infrastruktur-/Runtime-Fehler auf dem Aufrufpfad Runner → Edge Function.
- Die Meldung wird im content-runner bewusst aus einer HTML-Fehlerseite in diese Kurzform umgeschrieben.
- Das ist kein fachlicher Validator-Fail, sondern ein Upstream-/Timeout-/Crash-Symptom.

3. RC3 – stark belegt: Mehrere betroffene Jobtypen sind weiterhin zu monolithisch oder zu knapp getiert.
- validate-blueprint-variants läuft als T3-Job mit 45s Dispatch-Budget, verarbeitet aber potenziell alle Varianten aller Blueprints eines Curriculums in einem Lauf.
- package_generate_oral_exam macht breite LF-/Kompetenz-/Topic-Verarbeitung in einer Invocation.
- package_generate_exam_pool ist weiterhin ein sehr schwerer Generator.
- Diese Kombination ist prädestiniert für 502-/Timeout-/Retry-Schleifen.

4. RC4 – wichtig: Die neuen cancelled Jobs sind nach aktuellem Beweisstand eher Sekundärsymptom als Primärursache.
- Die zwei in den Screenshots sichtbaren Stale-Akteure canceln nicht direkt, sondern requeueen/resetten.
- Daraus folgt: Der Cancel-Anstieg entsteht sehr wahrscheinlich später durch Cleanup-/Obsolescence-/Package-Exit-Logik auf bereits churnenden Jobs.
- Die exakte Täterzuordnung der Cancels ist noch nicht hart, solange recent transition_source/cancel_reason nicht sauber gruppiert sind.

Kausalkette

- Ein schwerer Job wird geclaimt und geht auf processing.
- Der eigentliche Function-Call scheitert mit 502 oder die Frische-/Heartbeat-Signale werden nicht stabil genug fortgeschrieben.
- content-runner und/oder stuck-scan bewerten den Job als stale und setzen ihn zurück.
- Dadurch entsteht Aktivität, aber kein terminaler Artefaktfortschritt.
- Nachgelagerte Governance-/Cleanup-Writer räumen obsolet gewordene Pending-/Batch-Pending-Jobs weg; daraus entsteht die Welle an cancelled Jobs.
- Weil erfolgreiche Rückgabe plus Artefaktverifikation ausbleiben, bleibt completed aus.

Prüfung der Fehlermeldungen aus den Screenshots

1. STALE_LOCK_RECOVERY: attempt 2/8 bzw. 2/20 by content-runner-...
- Quelle: content-runner, eigener stale-lock-recovery-Pfad.
- Bedeutung: Der Runner hat einen zuvor als processing markierten Job als veraltet angesehen und zwangsweise zurückgesetzt.
- Forensischer Wert: Das ist ein Beleg für Churn, nicht für Erfolg.

2. stuck-scan: stale processing heartbeat
- Quelle: stuck-scan mit p_reason = "stuck-scan: stale processing heartbeat".
- Bedeutung: Ein zweiter Watchdog bewertet denselben oder einen verwandten Lauf ebenfalls als stale.
- Forensischer Wert: Es gibt überlappende Recovery-Akteure auf derselben Fehlerklasse.

3. HTTP 502: upstream proxy error (HTML stripped)
- Quelle: content-runner beim Fetch auf die Ziel-Function.
- Bedeutung: Die Ziel-Function hat keine normale JSON-Antwort geliefert; stattdessen kam eine HTML-Proxyfehlerseite zurück.
- Forensischer Wert: Starker Hinweis auf Timeout/Crash/Upstream-Störung, nicht auf fachliche Ablehnung.

Fix-Design

P0

- Recovery vereinheitlichen:
  - Stale-Handling darf nicht parallel in content-runner und stuck-scan mit eigener Logik leben.
  - Ein SSOT-Pfad auf Basis last_heartbeat_at/heartbeat-Frische ist nötig.
  - Der runner-lokale STALE_LOCK_RECOVERY-Pfad sollte entfernt oder auf dieselbe SSOT-RPC/Threshold-Logik umgestellt werden.

- Langläufer zerlegen oder asynchronisieren:
  - validate-blueprint-variants in kleinere Chunks statt Full-Curriculum-Scan pro Invocation.
  - package_generate_oral_exam und package_generate_exam_pool in resumierbare Teiljobs/Batches zerlegen.
  - Für echte Langläufer eine Accepted/background-Strategie oder bestehende batch_pending-Muster konsequent nutzen.

- Queue-UI schärfen:
  - Bei processing nicht einfach raw last_error als “aktueller Fehler” zeigen.
  - Trennung in: current status, previous error, last heartbeat, last transition actor.

P1

- Cancel-Welle hart zuschneiden:
  - recent cancelled Jobs nach meta.transition_source und meta.cancel_reason gruppieren.
  - Sobald klar ist, welcher Writer dominiert, dort gezielt härten.

P2

- Badge/forwardRef-Warnung beseitigen.
- Nicht ursächlich, aber wichtig für saubere Debug-Telemetrie in der Leitstelle.

Verifikation

Hart belegt

- Die Fehlermeldungen aus den Screenshots sind echte DB-/Runner-Signaturen, keine UI-Erfindung.
- STALE_LOCK_RECOVERY stammt aus dem content-runner.
- stuck-scan stale processing heartbeat stammt aus stuck-scan.
- HTTP 502 upstream proxy error stammt aus der Sanitization des Runner-Aufrufs.
- validate-blueprint-variants ist aktuell ein breit aggregierender Validator mit knapper T3-Laufzeitklasse.

Noch offen für den letzten gerichtsfesten Beweis

- Wer genau die neuen cancelled Jobs schreibt, gruppiert nach transition_source/cancel_reason.
- Welche Jobtypen aktuell in den letzten Zyklen überhaupt noch completed erreichen.
- Wie hoch die tatsächlichen Laufzeiten p95/p99 der problematischen Jobs sind.

Restrisiken

- Wenn nur Thresholds erhöht werden, bleiben monolithische Jobs unter Last weiterhin instabil; sie scheitern dann nur später.
- Wenn beide stale-Akteure aktiv bleiben, bleibt Doppelintervention möglich.
- Solange processing-Karten alte Fehler als Live-Signal zeigen, bleibt die Leitstelle forensisch anfällig für Fehlinterpretationen.

Dauermaßnahmen

- Ein einziger SSOT-Stale-Actor.
- Jobtyp-scharfe Runtime-Verträge mit gemessenen p95/p99-Werten und Test-Gates für Tier-Zuordnung.
- Verpflichtende transition_source/transition_reason für jede Statusänderung.
- Queue-Observability mit last heartbeat, previous error, current attempt, last actor.
- Canaries nicht nur auf Claim-Aktivität, sondern auf echte Completed-Rate und Artefaktmaterialisierung.

Kompaktes Urteil

Der primäre Defekt ist derzeit kein sauber bewiesener einzelner Cancel-Actor, sondern ein Nicht-Konvergieren der Ausführung: Upstream-502-/Timeout-/Heartbeat-Probleme erzeugen Recovery-Churn; dieser verhindert terminale Erfolge; die cancelled-Welle ist mit hoher Wahrscheinlichkeit ein nachgelagerter Folgeschaden. Der nächste harte Hebel ist deshalb nicht “mehr requeue”, sondern: stale recovery auf eine SSOT vereinheitlichen und die betroffenen Langläufer in echte chunked/background-fähige Verarbeitung zerlegen.</final-text>