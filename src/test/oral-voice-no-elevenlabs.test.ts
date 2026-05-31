/**
 * Guard: ExamFit Oral-Trainer darf KEINE ElevenLabs- oder oral-voice-* Bridge nutzen.
 * Andere Verticals (conversation-os-*, verwaltung-voice-*) sind erlaubt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('Oral Voice Activation v1 — browser-native guard', () => {
  const trainer = readFileSync('src/pages/OralExamTrainer.tsx', 'utf8');

  it('OralExamTrainer enthält keine ElevenLabs-Referenz', () => {
    expect(trainer).not.toMatch(/elevenlabs/i);
    expect(trainer).not.toMatch(/ELEVENLABS_API_KEY/);
  });

  it('OralExamTrainer ruft keine oral-voice-* Edge-Functions', () => {
    expect(trainer).not.toMatch(/oral-voice-tts/);
    expect(trainer).not.toMatch(/oral-voice-stt/);
  });

  it('OralExamTrainer nutzt Web Speech API + speechSynthesis', () => {
    expect(trainer).toMatch(/webkitSpeechRecognition/);
    expect(trainer).toMatch(/speechSynthesis/);
  });

  it('OralExamTrainer hat einen clientseitigen Quality-Gate', () => {
    expect(trainer).toMatch(/evaluateTranscriptQuality/);
  });

  it('Edge-Functions oral-voice-tts/-stt existieren nicht mehr', () => {
    expect(existsSync('supabase/functions/oral-voice-tts')).toBe(false);
    expect(existsSync('supabase/functions/oral-voice-stt')).toBe(false);
  });
});
