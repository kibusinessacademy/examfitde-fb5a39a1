import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AdminApiKey {
  id: string;
  org_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  status: string;
  created_by: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ApiKeyEvent {
  id: string;
  api_key_id: string;
  event_type: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export const API_KEY_SCOPES = [
  'admin.read', 'admin.write',
  'users.read', 'users.write',
  'licenses.read', 'licenses.write',
  'integrations.read', 'integrations.write',
  'compliance.read',
] as const;

export function useAdminApiKeys() {
  return useQuery({
    queryKey: ['admin-api-keys'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, org_id, name, key_prefix, scopes, status, created_by, last_used_at, expires_at, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AdminApiKey[];
    },
  });
}

export function useApiKeyEvents(keyId: string | null) {
  return useQuery({
    queryKey: ['admin-api-key-events', keyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_key_events')
        .select('*')
        .eq('api_key_id', keyId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as ApiKeyEvent[];
    },
    enabled: !!keyId,
  });
}

function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) token += chars[Math.floor(Math.random() * chars.length)];
  const raw = `ef_live_${token}`;
  const prefix = raw.slice(0, 12);
  return { raw, prefix, hash: '' }; // hash computed server-side ideally, placeholder for now
}

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { name: string; org_id: string; scopes: string[]; expires_at?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { raw, prefix } = generateApiKey();
      const hash = await sha256(raw);

      const { error } = await supabase.from('api_keys').insert({
        name: params.name,
        org_id: params.org_id,
        key_prefix: prefix,
        key_hash: hash,
        scopes: params.scopes,
        created_by: user.id,
        expires_at: params.expires_at || null,
      } as never);
      if (error) throw error;

      // Log creation event
      const { data: newKey } = await supabase.from('api_keys').select('id').eq('key_prefix', prefix).single();
      if (newKey) {
        await supabase.from('api_key_events').insert({
          api_key_id: (newKey as any).id,
          event_type: 'created',
          actor_id: user.id,
          metadata: { scopes: params.scopes },
        } as never);
      }

      return raw; // Return raw key only once
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-api-keys'] });
      toast.success('API Key erstellt');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (keyId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('api_keys')
        .update({ status: 'revoked' } as never)
        .eq('id', keyId);
      if (error) throw error;

      await supabase.from('api_key_events').insert({
        api_key_id: keyId,
        event_type: 'revoked',
        actor_id: user?.id || null,
      } as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-api-keys'] });
      toast.success('API Key widerrufen');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
