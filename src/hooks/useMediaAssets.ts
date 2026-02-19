import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeInvalidation } from './useAdminRealtimeInvalidation';
import { toast } from 'sonner';

export interface MediaAsset {
  id: string;
  storage_path: string;
  file_name?: string;
  width: number | null;
  height: number | null;
  mime_type?: string | null;
  mime?: string | null;
  file_size_bytes?: number | null;
  primary_keyword: string | null;
  generated_alt: string | null;
  manual_alt: string | null;
  generated_caption: string | null;
  manual_caption: string | null;
  context: string | null;
  used_on_pages?: string[];
  created_at: string;
  updated_at: string;
}

export function useMediaAssets() {
  useRealtimeInvalidation('media_assets', [['media-assets']]);

  return useQuery({
    queryKey: ['media-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('media_assets')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []) as MediaAsset[];
    },
  });
}

export function useMediaAssetMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['media-assets'] });

  const create = useMutation({
    mutationFn: async (asset: Partial<MediaAsset>) => {
      const { data, error } = await supabase.from('media_assets').insert(asset as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(); toast.success('Asset hinzugefügt'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MediaAsset> & { id: string }) => {
      const { error } = await supabase.from('media_assets').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Asset aktualisiert'); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('media_assets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Asset gelöscht'); },
  });

  return { create, update, remove };
}
