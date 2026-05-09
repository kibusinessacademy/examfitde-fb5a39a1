import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Shield, GraduationCap, User, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

type AppRole = 'admin' | 'teacher' | 'learner';
const ROLES: AppRole[] = ['admin', 'teacher', 'learner'];

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  roles: AppRole[];
  last_sign_in_at: string | null;
  created_at: string;
}

const roleIcon = (r: AppRole) =>
  r === 'admin' ? <Shield className="h-3 w-3" /> : r === 'teacher' ? <GraduationCap className="h-3 w-3" /> : <User className="h-3 w-3" />;

export default function AdminRolesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  // simple debounce
  useState(() => {
    const t = setTimeout(() => setDebounced(search.trim() || ''), 300);
    return () => clearTimeout(t);
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users-roles', debounced],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_users_with_roles', {
        p_search: debounced || null,
        p_limit: 100,
      });
      if (error) throw error;
      return (data as unknown as UserRow[]) ?? [];
    },
  });

  const grant = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.rpc('admin_grant_role', { p_user_id: userId, p_role: role });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users-roles'] }); toast.success('Rolle vergeben'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.rpc('admin_revoke_role', { p_user_id: userId, p_role: role });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users-roles'] }); toast.success('Rolle entfernt'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Rollen-Verwaltung</h1>
        <p className="text-sm text-text-secondary mt-1">SSOT <code>user_roles</code> + <code>has_role()</code>. Audit in <code>auto_heal_log</code>.</p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <Input
          placeholder="Suche nach E-Mail oder Name…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setDebounced(e.target.value.trim()); }}
          className="pl-9"
        />
      </div>

      <Card>
        <CardHeader><CardTitle>Nutzer ({data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>
          ) : !data || data.length === 0 ? (
            <p className="text-text-muted py-6 text-center">Keine Nutzer gefunden.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.map((u) => (
                <li key={u.user_id} className="py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-text-primary truncate">{u.display_name || u.email}</div>
                    <div className="text-xs text-text-muted truncate">{u.email}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {u.roles.map((r) => (
                      <Badge key={r} variant="secondary" className="gap-1">
                        {roleIcon(r)} {r}
                        <button
                          aria-label={`Rolle ${r} entfernen`}
                          className="ml-1 opacity-60 hover:opacity-100"
                          onClick={() => revoke.mutate({ userId: u.user_id, role: r })}
                          disabled={revoke.isPending}
                        ><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                    {ROLES.filter((r) => !u.roles.includes(r)).map((r) => (
                      <Button
                        key={r}
                        size="sm"
                        variant="outline"
                        onClick={() => grant.mutate({ userId: u.user_id, role: r })}
                        disabled={grant.isPending}
                        className="gap-1 h-7 text-xs"
                      ><Plus className="h-3 w-3" /> {r}</Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
