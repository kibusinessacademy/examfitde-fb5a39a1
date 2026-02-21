import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const RECENT_KEY = 'admin_recent_searches';
const MAX_RECENT = 8;

export interface SearchResult {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle: string | null;
  url: string;
  /** Highlighted title with <mark> tags */
  titleHtml?: string;
}

function highlightMatch(text: string, query: string): string {
  if (!query || query.length < 2) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="bg-primary/20 text-foreground rounded-sm px-0.5">$1</mark>');
}

export function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, MAX_RECENT);
  } catch { return []; }
}

export function addRecentSearch(query: string) {
  const recent = getRecentSearches().filter(q => q !== query);
  recent.unshift(query);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export function clearRecentSearches() {
  localStorage.removeItem(RECENT_KEY);
}

export function useAdminSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);

  const refreshRecent = useCallback(() => setRecentSearches(getRecentSearches()), []);

  const search = useCallback(async (query: string) => {
    if (!query || query.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      // Search title and subtitle with ilike for broad matching
      const { data } = await (supabase as any)
        .from('admin_search_index')
        .select('entity_type,entity_id,title,subtitle,url')
        .or(`title.ilike.%${query}%,subtitle.ilike.%${query}%`)
        .order('updated_at', { ascending: false })
        .limit(20);

      const enriched = (data || []).map((r: SearchResult) => ({
        ...r,
        titleHtml: highlightMatch(r.title, query),
      }));
      setResults(enriched);
    } finally {
      setLoading(false);
    }
  }, []);

  const trackSearch = useCallback((query: string) => {
    addRecentSearch(query);
    refreshRecent();
  }, [refreshRecent]);

  return { results, loading, search, recentSearches, trackSearch, refreshRecent };
}
