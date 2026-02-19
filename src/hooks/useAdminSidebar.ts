import { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Pin { id: string; label: string; url: string; entity_type: string; position: number }
interface RecentPage { id: string; label: string; url: string; visited_at: string }
interface NavBadges { failed_jobs_24h: number; critical_competencies: number; seo_errors: number; open_alerts: number }

export function useAdminPins() {
  const { user } = useAuth();
  const [pins, setPins] = useState<Pin[]>([]);

  const fetchPins = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from('admin_pins')
      .select('id,label,url,entity_type,position')
      .eq('user_id', user.id)
      .order('position', { ascending: true });
    setPins(data || []);
  }, [user]);

  useEffect(() => { fetchPins(); }, [fetchPins]);

  const addPin = async (label: string, url: string, entity_type = 'page') => {
    if (!user) return;
    await (supabase as any).from('admin_pins').insert({
      user_id: user.id, label, url, entity_type, position: pins.length,
    });
    fetchPins();
  };

  const removePin = async (id: string) => {
    await (supabase as any).from('admin_pins').delete().eq('id', id);
    fetchPins();
  };

  return { pins, addPin, removePin, refetch: fetchPins };
}

export function useAdminRecents() {
  const { user } = useAuth();
  const location = useLocation();
  const [recents, setRecents] = useState<RecentPage[]>([]);

  const fetchRecents = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from('admin_recent_pages')
      .select('id,label,url,visited_at')
      .eq('user_id', user.id)
      .order('visited_at', { ascending: false })
      .limit(8);
    setRecents(data || []);
  }, [user]);

  useEffect(() => { fetchRecents(); }, [fetchRecents]);

  const trackVisit = useCallback(async (label: string) => {
    if (!user || !location.pathname.startsWith('/admin')) return;
    // Upsert: delete old same-url, insert new
    await (supabase as any).from('admin_recent_pages')
      .delete()
      .eq('user_id', user.id)
      .eq('url', location.pathname);
    await (supabase as any).from('admin_recent_pages').insert({
      user_id: user.id, url: location.pathname, label,
    });
    // Keep max 20
    const { data: all } = await (supabase as any)
      .from('admin_recent_pages')
      .select('id')
      .eq('user_id', user.id)
      .order('visited_at', { ascending: false });
    if (all && all.length > 20) {
      const idsToDelete = all.slice(20).map((r: any) => r.id);
      await (supabase as any).from('admin_recent_pages').delete().in('id', idsToDelete);
    }
    fetchRecents();
  }, [user, location.pathname, fetchRecents]);

  return { recents, trackVisit, refetch: fetchRecents };
}

export function useNavBadges() {
  const [badges, setBadges] = useState<NavBadges>({ failed_jobs_24h: 0, critical_competencies: 0, seo_errors: 0, open_alerts: 0 });

  useEffect(() => {
    const fetch = async () => {
      const { data } = await (supabase as any).from('kpi_admin_nav_badges').select('*').single();
      if (data) setBadges(data);
    };
    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, []);

  return badges;
}
