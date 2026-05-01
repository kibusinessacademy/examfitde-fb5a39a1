import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, KeyRound } from 'lucide-react';
import { useAccountSummary } from './hooks/useAccountSummary';

export default function AppLicensesPage() {
  const { data, isLoading } = useAccountSummary();
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-text-muted mx-auto mt-10" />;
  const licenses = data?.license_packages_owned ?? [];

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-text-primary flex items-center gap-2"><KeyRound className="h-6 w-6" /> Lizenzen</h2>
      {licenses.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-text-secondary">Keine Lizenzen vorhanden.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {licenses.map((l) => {
            const free = l.seats_total - l.seats_assigned;
            return (
              <Card key={l.package_id}>
                <CardContent className="p-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-text-primary">{l.package_name}</div>
                    <div className="text-xs text-text-muted mt-1">
                      {l.seats_assigned} von {l.seats_total} Seats vergeben
                    </div>
                  </div>
                  <Badge variant={free > 0 ? 'default' : 'secondary'}>{free} frei</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
