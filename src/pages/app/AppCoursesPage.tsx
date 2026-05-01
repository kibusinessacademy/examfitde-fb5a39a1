import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, GraduationCap } from 'lucide-react';
import { useAccountSummary } from './hooks/useAccountSummary';

export default function AppCoursesPage() {
  const { data, isLoading } = useAccountSummary();
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-text-muted mx-auto mt-10" />;
  const courses = data?.active_courses ?? [];

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-text-primary flex items-center gap-2"><GraduationCap className="h-6 w-6" /> Meine Kurse</h2>
      {courses.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-text-secondary">Du hast noch keine aktiven Kurse.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {courses.map((c) => (
            <Card key={c.grant_id} variant="interactive">
              <CardContent className="p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-text-primary truncate">{c.package_name}</div>
                  <div className="text-xs text-text-muted mt-1">
                    Freigeschaltet: {new Date(c.granted_at).toLocaleDateString('de-DE')}
                    {c.expires_at && <> · Läuft ab: {new Date(c.expires_at).toLocaleDateString('de-DE')}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge>
                  <Button asChild size="sm" variant="petrol"><Link to="/dashboard">Lernen</Link></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
