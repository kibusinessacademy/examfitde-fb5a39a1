import { describe, it, expect } from 'vitest';
import { parsePasteToRawItems } from '../client';

describe('parsePasteToRawItems', () => {
  it('parses plain titles, pipe-formats and JSON lines, ignores comments', () => {
    const text = [
      '# comment ignored',
      'Plain Title',
      'Title with URL | https://example.com/x',
      'Title with URL and summary | https://a.io | brief summary',
      'Title with summary only | This is only a summary, no URL',
      '{"title":"JSON Item","url":"https://j.io","external_id":"e1"}',
      '   ',
    ].join('\n');
    const items = parsePasteToRawItems(text);
    expect(items.length).toBe(5);
    expect(items[0]).toEqual({ title: 'Plain Title' });
    expect(items[1].url).toBe('https://example.com/x');
    expect(items[2].url).toBe('https://a.io');
    expect(items[2].summary).toBe('brief summary');
    expect(items[3].summary).toBe('This is only a summary, no URL');
    expect(items[3].url).toBeUndefined();
    expect(items[4].external_id).toBe('e1');
  });
});
