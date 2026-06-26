/**
 * VOICE.DIAGNOSTICS.E2E.1
 *
 * Regressions-Suite für das Voice-Diagnose-Panel im Oral-Exam-Trainer.
 *
 * Was wird geprüft (ohne echten Audio-/Mic-Zugriff im CI):
 *  - Panel rendert & zeigt alle 6 Statuszeilen
 *  - Fehlt SpeechRecognition → Fallback „Texteingabe ist aktiv"
 *  - getUserMedia-Erfolg ändert NICHTS am Fallback, wenn SR fehlt
 *  - onvoiceschanged mit unterschiedlicher voices.length → Gesamtstatus
 *    wird neu berechnet (warn ↔ ok)
 *  - „Erneut testen"-Button bleibt stabil bei Mehrfach-Klick
 *  - Snapshot-/Screenshot-Regression (soft) für die UI
 *
 * Alle Voice-APIs werden vor jedem Pageload per addInitScript
 * deterministisch gestubbt — kein echter Mic-Prompt, kein echter TTS-Ton.
 */
import { test, expect, type Page } from '@playwright/test';
import { login } from './_helpers';

interface VoiceMockOpts {
  withSpeechRecognition?: boolean;
  initialVoices?: number;
  permission?: 'granted' | 'denied' | 'prompt';
  mediaSuccess?: boolean;
}

/**
 * Stubt alle Voice-relevanten Browser-APIs deterministisch.
 * Exponiert window.__voiceMock = { setVoices(n), setPermission(s) } für
 * Laufzeit-Manipulation in den Tests (voiceschanged-Simulation etc.).
 */
async function installVoiceMocks(page: Page, opts: VoiceMockOpts = {}) {
  await page.addInitScript((cfg: Required<VoiceMockOpts>) => {
    // 1) SpeechRecognition
    if (!cfg.withSpeechRecognition) {
      try { delete (window as unknown as Record<string, unknown>).SpeechRecognition; } catch { /* noop */ }
      try { delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition; } catch { /* noop */ }
    } else {
      class FakeSR extends EventTarget {
        lang = ''; continuous = false; interimResults = false;
        start() {} stop() {} abort() {}
      }
      (window as unknown as Record<string, unknown>).SpeechRecognition = FakeSR;
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeSR;
    }

    // 2) speechSynthesis (Event-Target, mutierbarer Voice-Pool)
    let voicesArr: SpeechSynthesisVoice[] = Array.from({ length: cfg.initialVoices }, (_, i) => ({
      default: i === 0,
      lang: 'de-DE',
      localService: true,
      name: `MockVoice ${i + 1}`,
      voiceURI: `mock://voice-${i + 1}`,
    })) as unknown as SpeechSynthesisVoice[];
    const listeners = new Map<string, Set<EventListener>>();
    const synth = {
      getVoices: () => voicesArr.slice(),
      speak: (_u: SpeechSynthesisUtterance) => { /* swallow im CI */ },
      cancel: () => {}, pause: () => {}, resume: () => {},
      paused: false, pending: false, speaking: false,
      onvoiceschanged: null as null | ((e: Event) => void),
      addEventListener(type: string, cb: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(cb);
      },
      removeEventListener(type: string, cb: EventListener) {
        listeners.get(type)?.delete(cb);
      },
      dispatchEvent(ev: Event) {
        listeners.get(ev.type)?.forEach((cb) => cb(ev));
        if (ev.type === 'voiceschanged' && typeof synth.onvoiceschanged === 'function') {
          try { synth.onvoiceschanged(ev); } catch { /* noop */ }
        }
        return true;
      },
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth });
    if (typeof (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance !== 'function') {
      (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance =
        function (this: Record<string, unknown>, text?: string) { this.text = text ?? ''; } as unknown;
    }

    // 3) navigator.permissions.query → konfigurierbar
    const fakePerm = {
      state: cfg.permission as PermissionState,
      onchange: null as null | ((e: Event) => void),
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    };
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      get: () => ({ query: async () => fakePerm }),
    });

    // 4) navigator.mediaDevices.getUserMedia → Erfolg ODER NotAllowedError
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      get: () => ({
        getUserMedia: async () => {
          if (!cfg.mediaSuccess) throw new DOMException('mocked', 'NotAllowedError');
          // Minimaler Fake-MediaStream — nur was die Komponente nutzt.
          const track = {
            kind: 'audio',
            label: 'MockMic',
            enabled: true,
            stop() {},
          };
          return {
            getAudioTracks: () => [track],
            getTracks: () => [track],
            getVideoTracks: () => [],
          } as unknown as MediaStream;
        },
      }),
    });

    // 5) Test-Hook für Laufzeit-Manipulation
    (window as unknown as { __voiceMock: unknown }).__voiceMock = {
      setVoices(n: number) {
        voicesArr = Array.from({ length: n }, (_, i) => ({
          default: i === 0, lang: 'de-DE', localService: true,
          name: `MockVoice ${i + 1}`, voiceURI: `mock://voice-${i + 1}`,
        })) as unknown as SpeechSynthesisVoice[];
        synth.dispatchEvent(new Event('voiceschanged'));
      },
      setPermission(s: PermissionState) {
        fakePerm.state = s;
        if (typeof fakePerm.onchange === 'function') {
          try { fakePerm.onchange(new Event('change')); } catch { /* noop */ }
        }
      },
    };
  }, {
    withSpeechRecognition: opts.withSpeechRecognition ?? false,
    initialVoices: opts.initialVoices ?? 0,
    permission: opts.permission ?? 'prompt',
    mediaSuccess: opts.mediaSuccess ?? false,
  });
}

async function gotoOralSetup(page: Page) {
  await page.goto('/oral-exam', { waitUntil: 'domcontentloaded' });
  if (page.url().includes('404') || page.url().includes('not-found')) {
    await page.goto('/muendliche-pruefung', { waitUntil: 'domcontentloaded' });
  }
}

async function waitForFirstRun(page: Page) {
  const panel = page.getByTestId('voice-diagnostics');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByTestId('voice-diagnostics-rerun')).toBeVisible({ timeout: 10_000 });
  return panel;
}

test.describe('Voice Diagnostics — Panel & Fallback', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Panel rendert mit Statuszeilen + Fallback bei fehlender SpeechRecognition', async ({ page }) => {
    await installVoiceMocks(page, { withSpeechRecognition: false });
    await gotoOralSetup(page);
    const panel = await waitForFirstRun(page);

    await expect(panel.getByText('Spracherkennung (STT)')).toBeVisible();
    await expect(panel.getByText('Sprachausgabe (TTS)')).toBeVisible();
    await expect(panel.getByText(/TTS-Stimmen geladen/)).toBeVisible();
    await expect(panel.getByText('Mikrofon-Berechtigung')).toBeVisible();
    await expect(panel.getByText('Test-Aufnahme')).toBeVisible();
    await expect(panel.getByText('TTS-Testphrase')).toBeVisible();

    const fallback = page.getByTestId('voice-diagnostics-fallback-hint');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText(/Texteingabe ist aktiv/i);

    // Snapshot-Regression (soft) — Baseline beim ersten Run anlegen:
    //   npx playwright test tests/e2e/voice-diagnostics.spec.ts --update-snapshots
    await expect
      .soft(panel)
      .toHaveScreenshot('voice-diagnostics-fail.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.02,
      });
  });

  test('getUserMedia-Erfolg ändert NICHTS am Fallback ohne SpeechRecognition', async ({ page }) => {
    await installVoiceMocks(page, {
      withSpeechRecognition: false,
      mediaSuccess: true,
      permission: 'granted',
      initialVoices: 3,
    });
    await gotoOralSetup(page);
    const panel = await waitForFirstRun(page);

    // Mic-Test grün möglich, aber STT fehlt → Gesamt-Ampel fail → Fallback
    await expect(panel.getByText('Spracherkennung (STT)')).toBeVisible();
    const fallback = page.getByTestId('voice-diagnostics-fallback-hint');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText(/Texteingabe ist aktiv/i);
  });

  test('onvoiceschanged mit wachsender voices.length triggert Recompute (warn → ok)', async ({ page }) => {
    await installVoiceMocks(page, {
      withSpeechRecognition: true,
      mediaSuccess: true,
      permission: 'granted',
      initialVoices: 0,
    });
    await gotoOralSetup(page);
    const panel = await waitForFirstRun(page);

    // Initial: 0 Voices → Ampel „Eingeschränkt"
    await expect(panel.getByText('Eingeschränkt')).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText(/TTS-Stimmen geladen \(0\)/)).toBeVisible();
    // Fallback ist bei warn aktiv → Texteingabe-Hinweis sichtbar
    await expect(page.getByTestId('voice-diagnostics-fallback-hint')).toBeVisible();

    // Voices erscheinen nach (Browser-)Initialisierung → voiceschanged feuern
    await page.evaluate(() => {
      (window as unknown as { __voiceMock: { setVoices: (n: number) => void } })
        .__voiceMock.setVoices(5);
    });

    // Komponente rechnet neu → Ampel „Bereit", Fallback verschwindet
    await expect(panel.getByText('Bereit')).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText(/TTS-Stimmen geladen \(5\)/)).toBeVisible();
    await expect(page.getByTestId('voice-diagnostics-fallback-hint')).toHaveCount(0);
  });

  test('onvoiceschanged auf 0 zurückgesetzt → Ampel fällt wieder auf warn', async ({ page }) => {
    await installVoiceMocks(page, {
      withSpeechRecognition: true,
      mediaSuccess: true,
      permission: 'granted',
      initialVoices: 4,
    });
    await gotoOralSetup(page);
    const panel = await waitForFirstRun(page);

    await expect(panel.getByText('Bereit')).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => {
      (window as unknown as { __voiceMock: { setVoices: (n: number) => void } })
        .__voiceMock.setVoices(0);
    });

    await expect(panel.getByText('Eingeschränkt')).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText(/TTS-Stimmen geladen \(0\)/)).toBeVisible();
    await expect(page.getByTestId('voice-diagnostics-fallback-hint')).toBeVisible();
  });

  test('Erneut-testen-Button stabil bei Mehrfach-Klick', async ({ page }) => {
    await installVoiceMocks(page, { withSpeechRecognition: false });
    await gotoOralSetup(page);
    const panel = await waitForFirstRun(page);

    const rerun = panel.getByTestId('voice-diagnostics-rerun');
    await rerun.click();
    await expect(rerun).toBeEnabled({ timeout: 5_000 });
    await rerun.click();
    await expect(rerun).toBeEnabled({ timeout: 5_000 });

    await expect(page.getByTestId('voice-diagnostics-fallback-hint')).toBeVisible();
  });
});
