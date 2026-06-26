/**
 * Voice Diagnostics — Self-Test für den Oral-Exam-Trainer.
 *
 * Pflicht-Surface für Support & Geräte-Kompatibilität:
 * prüft SpeechRecognition, speechSynthesis, voices.length,
 * Mic-Permission, ein kurzes Test-Recording (auto-stop) und
 * eine TTS-Testphrase. Speichert keine Audio-Daten.
 *
 * Auto-Re-Check bei:
 *  - Mount
 *  - onvoiceschanged (Browser lädt TTS-Stimmen nach)
 *  - visibilitychange (Tab-Wechsel zurück)
 *  - PermissionStatus.onchange (Mic-Berechtigung verändert)
 *
 * Liefert Ergebnis per onResult-Callback nach oben, damit das
 * Parent-UI bei „warn"/„fail" automatisch auf Texteingabe-Fallback
 * umschalten und Speech-UI deaktivieren kann.
 *
 * Kein externer Voice-Provider (BRIDGE: bleibt browser-native).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  key: string;
  label: string;
  status: Status;
  detail: string;
}

export interface DiagnosticsResult {
  overall: Status;
  checks: Check[];
  ranAt: string;
}

const STATUS_STYLES: Record<Status, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
  fail: 'bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300',
};

const STATUS_LABEL: Record<Status, string> = {
  ok: 'Bereit',
  warn: 'Eingeschränkt',
  fail: 'Nicht unterstützt',
};

function StatusIcon({ status }: { status: Status }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4" />;
  if (status === 'warn') return <AlertTriangle className="h-4 w-4" />;
  return <XCircle className="h-4 w-4" />;
}

export interface VoiceDiagnosticsProps {
  locale?: string;
  /** Wird nach jedem Lauf aufgerufen — Parent kann Speech-UI darauf basierend disablen. */
  onResult?: (result: DiagnosticsResult) => void;
  /** TTS-Testphrase nur beim ersten manuellen Lauf abspielen, nicht bei jedem Auto-Re-Check. */
  speakTestPhrase?: boolean;
}

export function VoiceDiagnostics({
  locale = 'de-DE',
  onResult,
  speakTestPhrase = true,
}: VoiceDiagnosticsProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const hasRunOnceRef = useRef(false);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const run = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    setRunning(true);
    const checks: Check[] = [];

    // 1) SpeechRecognition vorhanden?
    const hasSR =
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
    checks.push({
      key: 'speech_recognition',
      label: 'Spracherkennung (STT)',
      status: hasSR ? 'ok' : 'fail',
      detail: hasSR
        ? 'Web Speech API verfügbar.'
        : 'Browser unterstützt keine Spracherkennung (z. B. Firefox). Texteingabe ist verfügbar.',
    });

    // 2) speechSynthesis vorhanden?
    const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;
    checks.push({
      key: 'speech_synthesis',
      label: 'Sprachausgabe (TTS)',
      status: hasTTS ? 'ok' : 'fail',
      detail: hasTTS
        ? 'speechSynthesis API verfügbar.'
        : 'Browser unterstützt keine Sprachausgabe. Fragen werden nur angezeigt.',
    });

    // 3) Voices geladen?
    let voicesCount = 0;
    if (hasTTS) {
      voicesCount = window.speechSynthesis.getVoices().length;
      if (voicesCount === 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 800);
          const prev = window.speechSynthesis.onvoiceschanged;
          window.speechSynthesis.onvoiceschanged = (ev) => {
            clearTimeout(t);
            // restore listener so unseren globalen Watcher nicht killen
            window.speechSynthesis.onvoiceschanged = prev;
            resolve();
            // re-trigger prev wenn vorhanden
            if (typeof prev === 'function') {
              try { (prev as (e: Event) => void).call(window.speechSynthesis, ev); } catch { /* noop */ }
            }
          };
        });
        voicesCount = window.speechSynthesis.getVoices().length;
      }
    }
    checks.push({
      key: 'voices',
      label: `TTS-Stimmen geladen (${voicesCount})`,
      status: !hasTTS ? 'fail' : voicesCount === 0 ? 'warn' : 'ok',
      detail:
        !hasTTS
          ? 'Keine Sprachausgabe verfügbar.'
          : voicesCount === 0
            ? 'Keine Stimmen geladen — Ausgabe kann stumm bleiben. Browser/OS-Stimmen prüfen.'
            : `${voicesCount} Stimmen verfügbar.`,
    });

    // 4) Mic-Permission Status (passiv)
    let permState: PermissionState | 'unknown' = 'unknown';
    try {
      const nav = navigator as Navigator & {
        permissions?: { query: (d: { name: PermissionName }) => Promise<PermissionStatus> };
      };
      if (nav.permissions?.query) {
        const s = await nav.permissions.query({ name: 'microphone' as PermissionName });
        permState = s.state;
      }
    } catch {
      /* Safari/FF: ignore */
    }
    checks.push({
      key: 'mic_permission',
      label: 'Mikrofon-Berechtigung',
      status:
        permState === 'granted' ? 'ok' : permState === 'denied' ? 'fail' : 'warn',
      detail:
        permState === 'granted'
          ? 'Bereits erteilt.'
          : permState === 'denied'
            ? 'Im Browser blockiert — in Adressleiste (Schloss-Symbol) freigeben.'
            : permState === 'prompt'
              ? 'Wird beim Aufnahme-Start abgefragt.'
              : 'Status nicht abfragbar — Test-Recording folgt.',
    });

    // 5) Test-Recording (kurz, kein Speichern)
    //    Bei silent-Re-Check überspringen, damit Auto-Refresh nicht den Mic-Prompt erneut triggert.
    let recOk: Status = 'fail';
    let recDetail = 'getUserMedia nicht verfügbar.';
    if (silent && permState !== 'granted') {
      recOk = permState === 'denied' ? 'fail' : 'warn';
      recDetail = silent
        ? 'Übersprungen (Auto-Re-Check) — manueller Lauf testet Mikrofon erneut.'
        : recDetail;
    } else if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tracks = stream.getAudioTracks();
        recDetail = tracks.length > 0
          ? `Mikrofon "${tracks[0].label || 'default'}" erreichbar.`
          : 'Stream ohne Audio-Track.';
        recOk = tracks.length > 0 ? 'ok' : 'warn';
        tracks.forEach((t) => t.stop());
      } catch (err) {
        const name = (err as DOMException)?.name ?? 'Error';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          recDetail = 'Zugriff abgelehnt. Bitte Mikrofon im Browser erlauben.';
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          recDetail = 'Kein Mikrofon gefunden.';
        } else if (name === 'NotReadableError') {
          recDetail = 'Mikrofon wird von anderer App belegt.';
        } else {
          recDetail = `Fehler: ${name}`;
        }
        recOk = 'fail';
      }
    }
    checks.push({
      key: 'test_recording',
      label: 'Test-Aufnahme',
      status: recOk,
      detail: recDetail,
    });

    // 6) TTS-Testphrase (technisch ausgelöst, kein Warten auf Audio).
    //    Bei silent-Re-Check NICHT erneut sprechen, sonst quatscht der Browser ungefragt.
    let ttsOk: Status = 'fail';
    let ttsDetail = 'Keine TTS-API.';
    if (hasTTS) {
      try {
        if (!silent && speakTestPhrase) {
          const u = new SpeechSynthesisUtterance('Voice-Diagnose erfolgreich.');
          u.lang = locale;
          u.volume = 1;
          u.rate = 1;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        }
        ttsOk = voicesCount > 0 ? 'ok' : 'warn';
        ttsDetail =
          voicesCount > 0
            ? silent
              ? 'TTS einsatzbereit (Auto-Re-Check, ohne Test-Ton).'
              : 'TTS-Phrase wurde ausgelöst (jetzt hörbar, falls Lautsprecher aktiv).'
            : 'TTS-API ohne geladene Stimme — ggf. stumm.';
      } catch (err) {
        ttsDetail = `TTS-Fehler: ${(err as Error).message}`;
        ttsOk = 'fail';
      }
    }
    checks.push({
      key: 'tts_phrase',
      label: 'TTS-Testphrase',
      status: ttsOk,
      detail: ttsDetail,
    });

    const overall: Status = checks.some((c) => c.status === 'fail')
      ? 'fail'
      : checks.some((c) => c.status === 'warn')
        ? 'warn'
        : 'ok';

    const out: DiagnosticsResult = {
      overall,
      checks,
      ranAt: new Date().toISOString(),
    };
    setResult(out);
    setRunning(false);
    hasRunOnceRef.current = true;
    // eslint-disable-next-line no-console
    console.info('[VoiceDiagnostics]', { silent, ...out });
    onResultRef.current?.(out);
  }, [locale, speakTestPhrase]);

  // Auto-Run bei Mount (silent — kein Mic-Prompt, kein Test-Ton).
  useEffect(() => {
    void run({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-Re-Check bei Browser-Voice-Änderung.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const handler = () => { void run({ silent: true }); };
    window.speechSynthesis.addEventListener?.('voiceschanged', handler);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', handler);
    };
  }, [run]);

  // Auto-Re-Check bei Tab-Wechsel zurück.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && hasRunOnceRef.current) {
        void run({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [run]);

  // Auto-Re-Check bei Mic-Permission-Wechsel.
  useEffect(() => {
    const nav = navigator as Navigator & {
      permissions?: { query: (d: { name: PermissionName }) => Promise<PermissionStatus> };
    };
    if (!nav.permissions?.query) return;
    let status: PermissionStatus | null = null;
    nav.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((s) => {
        status = s;
        s.onchange = () => { void run({ silent: true }); };
      })
      .catch(() => { /* noop */ });
    return () => { if (status) status.onchange = null; };
  }, [run]);

  const isInitial = !result;

  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3" data-testid="voice-diagnostics">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Voice-Diagnose</span>
          {result && (
            <Badge
              variant="outline"
              className={cn('ml-1 border', STATUS_STYLES[result.overall])}
            >
              <StatusIcon status={result.overall} />
              <span className="ml-1">{STATUS_LABEL[result.overall]}</span>
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => run({ silent: false })}
          disabled={running}
          data-testid={isInitial ? 'voice-diagnostics-start' : 'voice-diagnostics-rerun'}
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Prüfe …
            </>
          ) : isInitial ? (
            'Voice-Diagnose starten'
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Erneut testen
            </>
          )}
        </Button>
      </div>

      {result && (
        <ul className="space-y-1.5 text-sm">
          {result.checks.map((c) => (
            <li
              key={c.key}
              className={cn(
                'flex items-start gap-2 rounded-md border px-2.5 py-1.5',
                STATUS_STYLES[c.status],
              )}
            >
              <StatusIcon status={c.status} />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{c.label}</div>
                <div className="opacity-90 text-xs leading-snug">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {result && result.overall !== 'ok' && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="voice-diagnostics-fallback-hint"
        >
          Hinweis: <strong>Texteingabe ist aktiv</strong> — Sprachaufnahme/-ausgabe
          wurde automatisch deaktiviert, weil mindestens ein Check fehlschlug. Du
          kannst die Prüfung vollständig per Tastatur durchführen.
        </p>
      )}
    </div>
  );
}

export default VoiceDiagnostics;
