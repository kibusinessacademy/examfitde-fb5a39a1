export type SearchResult = {
  url: string;
  title: string;
  snippet?: string;
};

async function serpApiSearch(query: string): Promise<SearchResult[]> {
  const key = Deno.env.get("SERPAPI_KEY");
  if (!key) return [];

  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&hl=de&gl=de&google_domain=google.de&api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) { await res.text(); return []; }
    const json = await res.json();
    return (json.organic_results || []).map((r: any) => ({
      url: r.link,
      title: r.title,
      snippet: r.snippet,
    }));
  } catch {
    return [];
  }
}

async function searchApiSearch(query: string): Promise<SearchResult[]> {
  const key = Deno.env.get("SEARCHAPI_KEY");
  if (!key) return [];

  try {
    const url = `https://www.searchapi.io/api/v1/search?engine=google&q=${encodeURIComponent(query)}&api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) { await res.text(); return []; }
    const json = await res.json();
    return (json.organic || []).map((r: any) => ({
      url: r.link,
      title: r.title,
      snippet: r.snippet,
    }));
  } catch {
    return [];
  }
}

async function tavilySearch(query: string): Promise<SearchResult[]> {
  const key = Deno.env.get("TAVILY_API_KEY");
  if (!key) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "advanced",
        max_results: 10,
      }),
    });
    if (!res.ok) { await res.text(); return []; }
    const json = await res.json();
    return (json.results || []).map((r: any) => ({
      url: r.url,
      title: r.title,
      snippet: r.content,
    }));
  } catch {
    return [];
  }
}

/**
 * Searches across all configured providers (SerpAPI, SearchAPI, Tavily).
 * Falls back gracefully if no API keys are set — returns empty array.
 * Deduplicates by URL.
 */
export async function searchProviders(query: string): Promise<SearchResult[]> {
  const providers = await Promise.all([
    serpApiSearch(query),
    searchApiSearch(query),
    tavilySearch(query),
  ]);

  const merged = providers.flat();
  const seen = new Set<string>();

  return merged.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}
