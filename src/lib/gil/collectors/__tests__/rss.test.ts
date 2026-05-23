import { describe, it, expect } from 'vitest';
import {
  canonicalizeUrl,
  isUnsafeFeedUrl,
  parseRssOrAtom,
  mapFeedItemToRawCollectorItem,
  RSS_PER_FEED_ITEM_LIMIT,
} from '../rss';
import { normalizeCollectorItem } from '../contract';

describe('GIL RSS Collector — pure', () => {
  it('canonicalizeUrl strips utm_* / gclid / fbclid / fragments and keeps real params', () => {
    const out = canonicalizeUrl(
      'https://Example.com/news?id=42&utm_source=x&utm_medium=y&gclid=abc&fbclid=zz#section',
    );
    expect(out).toBeTruthy();
    expect(out).toContain('id=42');
    expect(out).not.toMatch(/utm_/);
    expect(out).not.toContain('gclid');
    expect(out).not.toContain('fbclid');
    expect(out).not.toContain('#section');
  });

  it('canonicalizeUrl rejects non-http(s)', () => {
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalizeUrl('ftp://x.io/y')).toBeNull();
    expect(canonicalizeUrl('')).toBeNull();
    expect(canonicalizeUrl(null)).toBeNull();
  });

  it('isUnsafeFeedUrl blocks localhost, private IPs, link-local and non-http(s)', () => {
    expect(isUnsafeFeedUrl('http://localhost/feed')).toBe(true);
    expect(isUnsafeFeedUrl('http://service.local/feed')).toBe(true);
    expect(isUnsafeFeedUrl('http://127.0.0.1/feed')).toBe(true);
    expect(isUnsafeFeedUrl('http://10.0.0.5/feed')).toBe(true);
    expect(isUnsafeFeedUrl('http://192.168.1.1/feed')).toBe(true);
    expect(isUnsafeFeedUrl('http://172.16.0.1/feed')).toBe(true);
    expect(isUnsafeFeedUrl('http://169.254.1.1/feed')).toBe(true);
    expect(isUnsafeFeedUrl('file:///etc/passwd')).toBe(true);
    expect(isUnsafeFeedUrl('https://example.com/feed.xml')).toBe(false);
  });

  it('parseRssOrAtom handles RSS 2.0 feed', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Press</title>
      <item>
        <title><![CDATA[StudyFlix senkt Preis]]></title>
        <link>https://news.example/a?utm_source=rss</link>
        <guid>guid-1</guid>
        <description>&lt;p&gt;Preis 19€&lt;/p&gt;</description>
        <pubDate>Mon, 12 May 2025 10:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Item 2</title>
        <link>https://news.example/b</link>
      </item>
    </channel></rss>`;
    const f = parseRssOrAtom(xml);
    expect(f.kind).toBe('rss');
    expect(f.feed_title).toBe('Press');
    expect(f.items).toHaveLength(2);
    expect(f.items[0].title).toBe('StudyFlix senkt Preis');
    expect(f.items[0].guid).toBe('guid-1');
    expect(f.items[0].summary).toContain('Preis');
    expect(f.items[0].published_at).toMatch(/^2025-05-12/);
  });

  it('parseRssOrAtom handles Atom feed', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <title>Blog</title>
      <entry>
        <id>tag:example,2025:1</id>
        <title>Atom Item</title>
        <link rel="alternate" href="https://blog.example/x"/>
        <summary>brief</summary>
        <updated>2025-05-12T10:00:00Z</updated>
      </entry>
    </feed>`;
    const f = parseRssOrAtom(xml);
    expect(f.kind).toBe('atom');
    expect(f.items[0].title).toBe('Atom Item');
    expect(f.items[0].guid).toBe('tag:example,2025:1');
    expect(f.items[0].link).toBe('https://blog.example/x');
  });

  it('mapFeedItemToRawCollectorItem produces normalize-compatible draft for rss source', () => {
    const raw = mapFeedItemToRawCollectorItem(
      {
        guid: 'guid-1',
        title: 'Wettbewerber X launcht Tutor',
        link: 'https://news.example/x?utm_source=rss',
        summary: 'AI Tutor neu',
        published_at: '2025-05-12T10:00:00Z',
      },
      { default_signal_type: 'competitor_release', feed_label: 'press', category: 'edutech' },
    );
    expect(raw.url).toBe('https://news.example/x');
    expect(raw.external_id).toBe('guid-1');
    const r = normalizeCollectorItem('rss', raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.signal_type).toBe('competitor_release');
      expect(r.draft.tags).toContain('press');
      expect(r.draft.tags).toContain('edutech');
    }
  });

  it('exports per-feed item limit = 50', () => {
    expect(RSS_PER_FEED_ITEM_LIMIT).toBe(50);
  });
});
