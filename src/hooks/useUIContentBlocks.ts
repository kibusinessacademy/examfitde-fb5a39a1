import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeInvalidation } from './useAdminRealtimeInvalidation';
import { toast } from 'sonner';

export interface UIContentBlock {
  id: string;
  scope: string;
  placement: string;
  locale: string;
  audience: string;
  generated_copy: string | null;
  manual_copy: string | null;
  generated_image_id: string | null;
  manual_image_id: string | null;
  cta_label: string | null;
  cta_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function useUIContentBlocks(scope?: string) {
  useRealtimeInvalidation('ui_content_blocks', [['ui-content-blocks']]);

  return useQuery({
    queryKey: ['ui-content-blocks', scope],
    queryFn: async () => {
      let q = supabase.from('ui_content_blocks').select('*').order('updated_at', { ascending: false });
      if (scope) q = q.eq('scope', scope);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as UIContentBlock[];
    },
  });
}

export function useUIContentBlockMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ui-content-blocks'] });

  const create = useMutation({
    mutationFn: async (block: Partial<UIContentBlock>) => {
      const { data, error } = await supabase.from('ui_content_blocks').insert(block as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(); toast.success('Block erstellt'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<UIContentBlock> & { id: string }) => {
      const { error } = await supabase.from('ui_content_blocks').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Block gespeichert'); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ui_content_blocks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Block gelöscht'); },
  });

  return { create, update, remove };
}
