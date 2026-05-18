import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Shield, GraduationCap, User, Check, X } from 'lucide-react';
import { downloadCsv, toCsv } from '@/lib/csv';

type AppRole = 'admin' | 'teacher' | 'learner';
const ROLES: AppRole[] = ['admin', 'teacher', 'learner'];

interface RouteSpec {
  path: string;
  area: string;
  required: AppRole[]; // any of these grants access
}

// SSOT: Routen-Schutzmatrix (statisch — beschreibt UI-Schutzregeln).
// Public = leeres required (nur Auth empfohlen).
const ROUTES: RouteSpec[] = [
  { path: '/admin/cockpit',       area: 'Admin',   required: ['admin'] },
  { path: '/admin/command',       area: 'Admin',   required: ['admin'] },
  { path: '/admin/studio',        area: 'Admin',   required: ['admin'] },
  { path: '/admin/heal',          area: 'Admin',   required: ['admin'] },
  { path: '/admin/growth',        area: 'Admin',   required: ['admin'] },
  { path: '/admin/support',       area: 'Admin',   required: ['admin'] },
  { path: '/admin/kpi',           area: 'Admin',   required: ['admin'] },
  { path: '/admin/test',          area: 'Admin',   required: ['admin'] },
  { path: '/admin/ops/h5p',       area: 'Admin',   required: ['admin'] },
  { path: '/admin/ops/h5p-smoke', area: 'Admin',   required: ['admin'] },
  { path: '/admin/ops/roles',     area: 'Admin',   required: ['admin'] },
  { path: '/admin/ops/events',    area: 'Admin',   required: ['admin'] },
  { path: '/admin/ops/access',    area: 'Admin',   required: ['admin'] },
  { path: '/dashboard',           area: 'Learner', required: ['admin', 'teacher', 'learner'] },
  { path: '/courses',             area: 'Learner', required: ['admin', 'teacher', 'learner'] },
  { path: '/courses/:id',         area: 'Learner', required: ['admin', 'teacher', 'learner'] },
  { path: '/lesson/:id',          area: 'Learner', required: ['admin', 'teacher', 'learner'] },
  { path: '/exam-trainer/:id',    area: 'Learner', required: ['admin', 'teacher', 'learner'] },
  { path: '/oral-exam/:id',       area: 'Trainer', required: ['admin', 'teacher', 'learner'] },
  { path: '/app',                 area: 'Account', required: ['admin', 'teacher', 'learner'] },
];

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  roles: AppRole[];
  last_sign_in_at: string | null;
  created_at: string;
}

function allowed(route: RouteSpec, role: AppRole | null): boolean {
  if (!role) return false;
  return route.required.includes(role);
}

const RoleIcon = ({ r }: { r: AppRole }) =>
  r === 'admin' ? <Shield className="h-3 w-3" /> :
  r === 'teacher' ? <GraduationCap className="h-3 w-3" /> :
  <User className="h-3 w-3" />;

export default function AdminAccessMatrixPage() {
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['access-matrix-users', search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_users_with_roles', {
        p_search: search.trim() || undefined,
        p_limit: 50,
      });
      if (error) throw error;
      return (data as unknown as UserRow[]) ?? [];
    },
  });

  const matrix = useMemo(() => {
    return ROUTES.map((route) => ({
      route,
      perRole: Object.fromEntries(
        ROLES.map((r) => [r, allowed(route, r)]),
      ) as Record<AppRole, boolean>,
      forUser: selectedUser
        ? selectedUser.roles.some((r) => allowed(route, r))
        : null,
    }));
  }, [selectedUser]);

  const exportCsv = () => {
    const rows = matrix.map((m) => ({
      area: m.route.area,
      path: m.route.path,
      requires: m.route.required.join('|'),
      admin: m.perRole.admin ? 'allow' : 'deny',
      teacher: m.perRole.teacher ? 'allow' : 'deny',
      learner: m.perRole.learner ? 'allow' : 'deny',
      ...(selectedUser
        ? { selected_user: selectedUser.email, selected_user_access: m.forUser ? 'allow' : 'deny' }
        : {}),
    }));
    downloadCsv(`rbac-access-matrix-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">RBAC Access-Matrix</h1>
        <p className="text-sm text-text-secondary mt-1">
          Live-Vergleich: Welche Rolle darf welche Route? Wähle einen User, um die effektive Zugriffslage zu prüfen.
          Export als Audit-Report.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6 grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="q">User-Suche (E-Mail / Name)</Label>
            <Input id="q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="z. B. teacher@…" />
          </div>
          <div className="flex items-end">
            <Button onClick={exportCsv} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" /> CSV-Report exportieren
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">User auswählen ({users?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          ) : !users || users.length === 0 ? (
            <p className="text-text-muted text-sm">Keine Treffer.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {users.map((u) => (
                <li key={u.user_id}>
                  <button
                    onClick={() => setSelectedUser(u)}
                    className={`px-2.5 py-1.5 rounded-md border text-xs flex items-center gap-1.5 ${
                      selectedUser?.user_id === u.user_id
                        ? 'border-border-focus bg-surface-sunken text-text-primary'
                        : 'border-border text-text-secondary hover:border-border-focus'
                    }`}
                  >
                    <span className="font-medium truncate max-w-[12rem]">{u.email}</span>
                    {u.roles.map((r) => (
                      <Badge key={r} variant="secondary" className="gap-1 h-5 px-1.5 text-[10px]">
                        <RoleIcon r={r} /> {r}
                      </Badge>
                    ))}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Matrix {selectedUser && <span className="text-text-muted ml-2">· effektiv für {selectedUser.email}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-text-muted bg-surface-sunken">
              <tr className="border-b border-border">
                <th className="text-left p-2">Bereich</th>
                <th className="text-left p-2">Route</th>
                <th className="text-left p-2">required</th>
                {ROLES.map((r) => (
                  <th key={r} className="text-center p-2 capitalize">
                    <span className="inline-flex items-center gap-1"><RoleIcon r={r} /> {r}</span>
                  </th>
                ))}
                {selectedUser && <th className="text-center p-2">User</th>}
              </tr>
            </thead>
            <tbody>
              {matrix.map(({ route, perRole, forUser }) => (
                <tr key={route.path} className="border-b border-border/60">
                  <td className="p-2 text-text-secondary">{route.area}</td>
                  <td className="p-2 font-mono text-xs text-text-primary">{route.path}</td>
                  <td className="p-2 text-xs text-text-muted">{route.required.join(', ')}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="p-2 text-center">
                      {perRole[r]
                        ? <Check className="h-4 w-4 text-text-primary inline" />
                        : <X className="h-4 w-4 inline" style={{ color: 'hsl(var(--destructive))' }} />}
                    </td>
                  ))}
                  {selectedUser && (
                    <td className="p-2 text-center">
                      {forUser
                        ? <Check className="h-4 w-4 text-text-primary inline" />
                        : <X className="h-4 w-4 inline" style={{ color: 'hsl(var(--destructive))' }} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
