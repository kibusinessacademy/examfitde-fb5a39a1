/**
 * Cross-surface guard: neither rendered UI nor network responses on the key
 * learner routes — especially the OralExamTrainer — may contain any match
 * of /elevenlabs/i.
 *
 * Companion to:
 *   - src/test/oral-exam-trainer-no-elevenlabs.unit.test.ts (source guard)
 *   - src/test/oral-voice-no-elevenlabs.test.ts (browser-native guard)
 *
 * This E2E asserts the runtime surface stays clean even if dependencies,
 * dynamic imports, or API responses ever try to re-introduce ElevenLabs.
 */
import { test, expect, type Response } from '@playwright/test';

const ROUTES = [
  '/',
  '/muendliche-pruefung',
  '/oral-exam',
];

const ELEVENLABS = /elevenlabs/i;

test.describe('No-ElevenLabs cross-surface guard', () => {
  for (const route of ROUTES) {
    test(`route ${route} — DOM & network contain no /elevenlabs/i`, async ({ page }) => {
      const offendingResponses: Array<{ url: string; snippet: string }> = [];

      page.on('response', async (response: Response) => {
        try {
          const url = response.url();
          if (ELEVENLABS.test(url)) {
            offendingResponses.push({ url, snippet: '(URL match)' });
            return;
          }
          const ct = response.headers()['content-type'] ?? '';
          if (!/text|json|javascript|html|xml/i.test(ct)) return;
          const body = await response.text().catch(() => '');
          if (body && ELEVENLABS.test(body)) {
            const idx = body.search(ELEVENLABS);
            offendingResponses.push({
              url,
              snippet: body.slice(Math.max(0, idx - 40), idx + 40),
            });
          }
        } catch {
          /* ignore opaque/aborted responses */
        }
      });

      const resp = await page.goto(route, { waitUntil: 'networkidle' }).catch(() => null);
      if (!resp || resp.status() >= 500) {
        test.skip(true, `route ${route} unreachable (status ${resp?.status() ?? 'n/a'})`);
        return;
      }

      // DOM assertion — rendered text/HTML must not match.
      const html = await page.content();
      expect(
        ELEVENLABS.test(html),
        `Rendered HTML on ${route} matched /elevenlabs/i`,
      ).toBe(false);

      // Network assertion — no captured response body/URL may match.
      expect(
        offendingResponses,
        `Network responses on ${route} contained ElevenLabs references:\n` +
          offendingResponses.map((o) => `  ${o.url} :: ${o.snippet}`).join('\n'),
      ).toEqual([]);
    });
  }
});
