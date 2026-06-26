/**
 * VOICE.DIAGNOSTICS.E2E.1
 *
 * Regressions-Test für das Voice-Diagnose-Panel im Oral-Exam-Trainer.
 *
 * Was wird geprüft (ohne echten Audio-/Mic-Zugriff im CI):
 *  - Diagnose-Panel rendert sichtbar (data-testid="voice-diagnostics")
 *  - Auto-Run liefert Statuszeilen pro Check
 *  - Fehlt SpeechRecognition komplett → Fallback-Hinweis
 *    „Texteingabe ist aktiv" sichtbar (data-testid="voice-diagnostics-fallback-hint")
 *  - Manueller „Erneut testen"-Button erscheint nach erstem Lauf
 *
 * Strategie: alle Voice-APIs werden vor jedem Pageload per addInitScript
 * deterministisch gestubbt — kein echter Mic-Prompt, kein echter TTS-Ton.
 */
import { test, expect, type Page } from '@playwright/test';
import { login } from './_helpers';

/**
 * Stubt SpeechRecognition (fehlend), speechSynthesis, navigator.permissions
 * und navigator.mediaDevices.getUserMedia deterministisch.
 *
 * @param page              Playwright Page
 * @param withSpeechRecognition  true → API vorhanden; false → komplett entfernt
 */
async function installVoiceMocks(
  page: Page,
  opts: { withSpeechRecognition: boolean } = { withSpeechRecognition: false },
) {
  await page.addInitScript((cfg: { withSR: boolean }) => {
    // 1) SpeechRecognition: komplett entfernen, damit Diagnose „fail" meldet
    if (!cfg.withSR) {
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

    // 2) speechSynthesis: leerer Voice-Pool, speak/cancel no-op, Event-Target Surface
    const listeners = new Map<string, Set<EventListener>>();
    const synth = {
      getVoices: () => [] as SpeechSynthesisVoice[],
      speak: (_u: SpeechSynthesisUtterance) => { /* swallow im CI */ },
      cancel: () => {},
      pause: () => {}, resume: () => {},
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
        return true;
      },
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      get: () => synth,
    });
    // SpeechSynthesisUtterance Konstruktor-Stub (sonst `new` crasht in Diagnose)
    if (typeof (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance !== 'function') {
      (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance =
        function (this: Record<string, unknown>, text?: string) { this.text = text ?? ''; } as unknown;
    }

    // 3) navigator.permissions.query → „prompt" (passiv, kein Mic-Prompt)
    const fakePerm = {
      state: 'prompt' as PermissionState,
      onchange: null as null | ((e: Event) => void),
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    };
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      get: () => ({ query: async () => fakePerm }),
    });

    // 4) navigator.mediaDevices.getUserMedia: nicht aufrufen (Diagnose läuft silent),
    //    aber definieren, damit der Branch in der Komponente vorhanden ist.
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      get: () => ({
        getUserMedia: async () => { throw new DOMException('mocked', 'NotAllowedError'); },
      }),
    });
  }, { withSR: opts.withSpeechRecognition });
}

async function gotoOralSetup(page: Page) {
  await page.goto('/oral-exam', { waitUntil: 'domcontentloaded' });
  // Tolerant gegenüber alternativer Route
  if (page.url().includes('404') || page.url().includes('not-found')) {
    await page.goto('/muendliche-pruefung', { waitUntil: 'domcontentloaded' });
  }
}

test.describe('Voice Diagnostics — Panel & Fallback', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Panel rendert mit Statuszeilen und Fallback-Hinweis bei fehlender SpeechRecognition', async ({ page }) => {
    await installVoiceMocks(page, { withSpeechRecognition: false });
    await gotoOralSetup(page);

    const panel = page.getByTestId('voice-diagnostics');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Erst-Button vor Auto-Run-Ergebnis
    const startBtn = panel.getByTestId('voice-diagnostics-start');
    // Auto-Run (silent) finalisiert sich → Re-Run-Button taucht auf
    const rerunBtn = panel.getByTestId('voice-diagnostics-rerun');
    await expect(rerunBtn).toBeVisible({ timeout: 10_000 });
    await expect(startBtn).toHaveCount(0);

    // Statuszeilen sichtbar
    await expect(panel.getByText('Spracherkennung (STT)')).toBeVisible();
    await expect(panel.getByText('Sprachausgabe (TTS)')).toBeVisible();
    await expect(panel.getByText(/TTS-Stimmen geladen/)).toBeVisible();
    await expect(panel.getByText('Mikrofon-Berechtigung')).toBeVisible();
    await expect(panel.getByText('Test-Aufnahme')).toBeVisible();
    await expect(panel.getByText('TTS-Testphrase')).toBeVisible();

    // Fallback-Hinweis sichtbar (Ampel ≠ ok wegen fehlender SR)
    const fallback = page.getByTestId('voice-diagnostics-fallback-hint');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText(/Texteingabe ist aktiv/i);
  });

  test('Erneut testen-Button kann ohne Crash mehrfach geklickt werden', async ({ page }) => {
    await installVoiceMocks(page, { withSpeechRecognition: false });
    await gotoOralSetup(page);

    const panel = page.getByTestId('voice-diagnostics');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    const rerun = panel.getByTestId('voice-diagnostics-rerun');
    await expect(rerun).toBeVisible({ timeout: 10_000 });

    await rerun.click();
    await expect(rerun).toBeEnabled({ timeout: 5_000 });
    await rerun.click();
    await expect(rerun).toBeEnabled({ timeout: 5_000 });

    // Panel & Fallback bleiben stabil
    await expect(page.getByTestId('voice-diagnostics-fallback-hint')).toBeVisible();
  });
});
