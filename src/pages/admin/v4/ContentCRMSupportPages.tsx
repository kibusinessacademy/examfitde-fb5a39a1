import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import RealtimePipelineMonitor from '@/components/admin/RealtimePipelineMonitor';
import RealtimeAlerts from '@/components/admin/RealtimeAlerts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Edit, Eye, Upload, Search, Link2, Image, Globe } from 'lucide-react';

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

// ═══════════════════════════════════════════════════════════
// Content Pages Overview
// ═══════════════════════════════════════════════════════════
function ContentPagesOverview() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Content & SEO</h1>
        <p className="text-sm text-muted-foreground mt-1">Seiten, Blog, Assets & SEO verwalten</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <ContentCard
          icon={FileText}
          title="Produktseiten"
          description="Landing Pages, Prüfungspakete"
          count={0}
          status="Noch nicht konfiguriert"
        />
        <ContentCard
          icon={Edit}
          title="Blog"
          description="Artikel & Kategorien"
          count={0}
          status="Noch nicht konfiguriert"
        />
        <ContentCard
          icon={Image}
          title="Assets"
          description="Bilder, Alt-Texte, Lizenzen"
          count={0}
          status="Noch nicht konfiguriert"
        />
        <ContentCard
          icon={Globe}
          title="SEO"
          description="Redirects, Canonicals, Schema"
          count={0}
          status="Noch nicht konfiguriert"
        />
      </div>

      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Content Studio wird in Phase 2 implementiert.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Draft → Review → Publish Workflow mit Live-Preview & SEO-Checklist.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ContentCard({ icon: Icon, title, description, count, status }: {
  icon: React.ElementType; title: string; description: string; count: number; status: string;
}) {
  return (
    <Card className="hover:border-primary/30 transition-colors cursor-pointer">
      <CardContent className="py-4">
        <div className="flex items-center gap-3 mb-2">
          <Icon className="h-5 w-5 text-primary" />
          <h3 className="font-medium text-sm">{title}</h3>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        <div className="flex items-center gap-2 mt-3">
          <Badge variant="outline" className="text-[10px]">{count} Einträge</Badge>
          <span className="text-[10px] text-muted-foreground">{status}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// CRM Overview
// ═══════════════════════════════════════════════════════════
function CRMOverview() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">CRM</h1>
        <p className="text-sm text-muted-foreground mt-1">Kontakte, Segmente & Churn Risk</p>
      </div>

      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            CRM wird in Phase 3 implementiert.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Buyer ≠ Learner · Segmente (Azubi/Betrieb/Schule) · Churn Risk · Nudges
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Support Overview
// ═══════════════════════════════════════════════════════════
function SupportOverview() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Support</h1>
        <p className="text-sm text-muted-foreground mt-1">Tickets, Auto-Antworten & FAQ</p>
      </div>

      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <Link2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Support-System wird in Phase 3 implementiert.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Ticket Inbox · Auto-Vorschläge via KI · FAQ-Knüpfung · SLA Tracking
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ContentCRMSupportPages() {
  return { ContentPagesOverview, CRMOverview, SupportOverview };
}

export { ContentPagesOverview, CRMOverview, SupportOverview };
