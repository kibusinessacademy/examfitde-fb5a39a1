import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Globe, ArrowLeft, Megaphone, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const GrowthSeoCommandCenter = lazy(() => import('@/components/admin/command/GrowthSeoCommandCenter'));

export default function GrowthPage() {
  return (
    <div className="space-y-6">
      {/* Header with back-link */}
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin/command" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1 transition-colors">
            <ArrowLeft className="h-3 w-3" /> Leitstelle
          </Link>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Growth & SEO
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Content-Dominanz, SEO-Pipeline und Conversion-Optimierung
          </p>
        </div>
      </div>

      {/* Quick-Nav Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/admin/studio" className="rounded-xl border border-border bg-card p-3 hover:bg-muted/50 transition-colors flex items-center gap-3">
          <Megaphone className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">Kurse verwalten</div>
            <div className="text-[10px] text-muted-foreground">Content-Basis für Growth</div>
          </div>
        </Link>
        <Link to="/admin/test" className="rounded-xl border border-border bg-card p-3 hover:bg-muted/50 transition-colors flex items-center gap-3">
          <TrendingUp className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">Testbereich</div>
            <div className="text-[10px] text-muted-foreground">Learner-Vorschau</div>
          </div>
        </Link>
      </div>

      {/* Main Growth Command Center */}
      <Suspense fallback={
        <Card>
          <CardContent className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      }>
        <GrowthSeoCommandCenter />
      </Suspense>
    </div>
  );
}
