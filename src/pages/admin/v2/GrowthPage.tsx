import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

const GrowthSeoCommandCenter = lazy(() => import('@/components/admin/command/GrowthSeoCommandCenter'));

export default function GrowthPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <GrowthSeoCommandCenter />
    </Suspense>
  );
}
