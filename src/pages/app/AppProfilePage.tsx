import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function AppProfilePage() {
  const { user, signOut } = useAuth();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-text-primary flex items-center gap-2"><User className="h-6 w-6" /> Profil</h2>
      <Card>
        <CardHeader><CardTitle className="text-base">Account-Daten</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <span className="text-text-secondary">E-Mail</span>
            <span className="col-span-2 text-text-primary font-medium">{user?.email}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <span className="text-text-secondary">User-ID</span>
            <span className="col-span-2 font-mono text-xs text-text-muted">{user?.id}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <span className="text-text-secondary">Erstellt</span>
            <span className="col-span-2 text-text-primary">
              {user?.created_at ? new Date(user.created_at).toLocaleDateString('de-DE') : '—'}
            </span>
          </div>
          <div className="pt-3 border-t border-border">
            <Button variant="outline" onClick={() => signOut()}>Abmelden</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
