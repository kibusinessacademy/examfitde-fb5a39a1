import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SearchResult {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

export function useAdminSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query: string) => {
    if (!query || query.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      // Use trigram similarity search on title
      const { data } = await (supabase as any)
        .from('admin_search_index')
        .select('entity_type,entity_id,title,subtitle,url')
        .ilike('title', `%${query}%`)
        .order('updated_at', { ascending: false })
        .limit(20);
      setResults(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, search };
}
