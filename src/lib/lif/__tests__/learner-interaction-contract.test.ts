import { describe, expect, it } from 'vitest';
import {
  validateAnswer,
  type LearnerInteractionSpec,
} from '@/lib/lif/learner-interaction-contract';

const baseText: LearnerInteractionSpec = {
  surfaceId: 'test.text',
  expectedInput: 'text',
  minChars: 2,
  maxChars: 100,
};

describe('LIF.OS.1 — validateAnswer', () => {
  it('rejects empty text', () => {
    expect(validateAnswer(baseText, { kind: 'text', value: '   ' }).ok).toBe(false);
  });

  it('rejects too-short text', () => {
    expect(validateAnswer(baseText, { kind: 'text', value: 'a' }).ok).toBe(false);
  });

  it('accepts valid text', () => {
    expect(validateAnswer(baseText, { kind: 'text', value: 'hallo' }).ok).toBe(true);
  });

  it('rejects null payload', () => {
    expect(validateAnswer(baseText, null).ok).toBe(false);
  });

  it('enforces exactly one choice on singleChoice', () => {
    const spec: LearnerInteractionSpec = {
      surfaceId: 'test.sc',
      expectedInput: 'singleChoice',
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    };
    expect(validateAnswer(spec, { kind: 'singleChoice', selectedIds: [] }).ok).toBe(false);
    expect(validateAnswer(spec, { kind: 'singleChoice', selectedIds: ['a', 'b'] }).ok).toBe(false);
    expect(validateAnswer(spec, { kind: 'singleChoice', selectedIds: ['a'] }).ok).toBe(true);
  });

  it('refuses disabled specs', () => {
    expect(
      validateAnswer({ ...baseText, disabled: true }, { kind: 'text', value: 'hallo' }).ok,
    ).toBe(false);
  });

  it('validates rating range', () => {
    const spec: LearnerInteractionSpec = { surfaceId: 't.r', expectedInput: 'rating' };
    expect(validateAnswer(spec, { kind: 'rating', value: 0 }).ok).toBe(false);
    expect(validateAnswer(spec, { kind: 'rating', value: 6 }).ok).toBe(false);
    expect(validateAnswer(spec, { kind: 'rating', value: 3 }).ok).toBe(true);
  });
});
