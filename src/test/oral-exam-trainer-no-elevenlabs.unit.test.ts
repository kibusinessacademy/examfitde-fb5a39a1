/**
 * Targeted unit test: OralExamTrainer must never re-introduce any
 * ElevenLabs reference (import, identifier, comment, URL, env var).
 *
 * Companion to src/test/oral-voice-no-elevenlabs.test.ts — this file
 * focuses exclusively on the `/elevenlabs/i` regex guard so a failure
 * here pinpoints the regression immediately.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TRAINER_PATH = resolve('src/pages/OralExamTrainer.tsx');
const source = readFileSync(TRAINER_PATH, 'utf8');

describe('OralExamTrainer — /elevenlabs/i guard (unit)', () => {
  it('source does not contain the substring "elevenlabs" in any casing', () => {
    expect(source).not.toMatch(/elevenlabs/i);
  });

  it('source does not contain the ELEVENLABS_API_KEY env var', () => {
    expect(source).not.toMatch(/ELEVENLABS_API_KEY/);
  });

  it('no line — including comments — matches /elevenlabs/i', () => {
    const offenders = source
      .split('\n')
      .map((line, idx) => ({ line, lineNumber: idx + 1 }))
      .filter(({ line }) => /elevenlabs/i.test(line));

    expect(
      offenders,
      `Found ElevenLabs reference(s) in OralExamTrainer.tsx:\n` +
        offenders.map((o) => `  L${o.lineNumber}: ${o.line.trim()}`).join('\n'),
    ).toEqual([]);
  });

  it('does not reference known ElevenLabs hosts or endpoints', () => {
    expect(source).not.toMatch(/api\.elevenlabs\.io/i);
    expect(source).not.toMatch(/elevenlabs\.io/i);
  });
});
