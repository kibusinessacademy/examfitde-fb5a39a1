import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const AdminSupportPanel = lazy(() => import('@/components/admin/support/AdminSupportPanel'));

export default function SupportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Support-Tickets</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Alle Nutzer-Tickets · Verwaltung & Triage</p>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AdminSupportPanel />
      </Suspense>
    </div>
  );
}
