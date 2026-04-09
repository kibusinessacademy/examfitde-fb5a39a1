import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

async function getJwt() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

function apiBase() {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
}

async function fetchFn(path: string, init?: RequestInit) {
  const jwt = await getJwt();
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

// ── Bulk Import ──

export interface ImportRow {
  email: string;
  display_name?: string;
  role?: string;
  product_slug?: string;
  assign_seat?: string;
  external_id?: string;
}

export interface ImportResult {
  job_id: string;
  dry_run: boolean;
  created_count?: number;
  updated_count?: number;
  assigned_seats?: number;
  skipped_count?: number;
  valid_count?: number;
  error_count?: number;
  error_rows: { row: number; email: string; errors?: string[]; error?: string }[];
}

export function useOrgImportJobs(orgId: string) {
  return useQuery({
    queryKey: ['org-import-jobs', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_import_jobs')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });
}

export function useRunBulkImport() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      org_id: string;
      rows: ImportRow[];
      dry_run?: boolean;
      file_name?: string;
    }): Promise<ImportResult> => {
      return fetchFn('/bulk-import-org-users', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['org-import-jobs', vars.org_id] });
    },
  });
}

// ── SSO ──

export interface SSOConnection {
  id: string;
  org_id: string;
  provider: string;
  config: Record<string, any>;
  domain: string | null;
  status: string;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_result: any;
  last_error: string | null;
  created_at: string;
}

export function useOrgSSOConnections(orgId: string) {
  return useQuery({
    queryKey: ['org-sso-connections', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sso_connections')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SSOConnection[];
    },
    enabled: !!orgId,
  });
}

export function useSaveSSOConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      org_id: string;
      provider: string;
      config: Record<string, any>;
      domain?: string;
      auto_provision?: boolean;
      auto_assign_seat?: boolean;
      default_role?: string;
      role_mapping?: Record<string, string>;
    }) => {
      return fetchFn('/admin-test-sso-connection', {
        method: 'POST',
        body: JSON.stringify({ ...params, action: 'save' }),
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['org-sso-connections', vars.org_id] });
      toast.success('SSO-Verbindung gespeichert');
    },
  });
}

export function useTestSSOConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { org_id: string; connection_id: string }) => {
      return fetchFn('/admin-test-sso-connection', {
        method: 'POST',
        body: JSON.stringify({ ...params, action: 'test' }),
      });
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['org-sso-connections', vars.org_id] });
      if (data.success) {
        toast.success('SSO-Test erfolgreich');
      } else {
        toast.error('SSO-Test fehlgeschlagen', { description: data.errors?.[0] });
      }
    },
  });
}

// ── SCIM ──

export function useOrgScimTokens(orgId: string) {
  return useQuery({
    queryKey: ['org-scim-tokens', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scim_tokens')
        .select('id, label, is_active, created_at, expires_at, last_used_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });
}

export function useGenerateScimToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { org_id: string; label: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Generate token
      const rawToken = crypto.randomUUID() + '-' + crypto.randomUUID();
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawToken));
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const { error } = await supabase.from('scim_tokens').insert({
        org_id: params.org_id,
        label: params.label,
        token_hash: hashHex,
        is_active: true,
        created_by: user.id,
      } as any);

      if (error) throw error;
      return { token: rawToken };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['org-scim-tokens', vars.org_id] });
    },
  });
}

// ── Audit ──

export function useOrgAuditEvents(orgId: string) {
  return useQuery({
    queryKey: ['org-audit-events', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_audit_events')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });
}
