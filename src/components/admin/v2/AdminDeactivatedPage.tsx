import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AdminDeactivatedPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="p-4 rounded-2xl bg-warning-bg-subtle mb-4">
        <AlertTriangle className="h-8 w-8 text-warning" />
      </div>
      <h1 className="text-xl font-bold text-foreground mb-2">
        Bereich vorübergehend deaktiviert
      </h1>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Dieser Admin-Bereich ist vorübergehend deaktiviert. Der Fokus liegt aktuell auf der 
        SSOT-sicheren Leitstelle, Kursen, Kursdetails und Queue.
      </p>
      <Button asChild variant="outline" className="gap-2">
        <Link to="/admin/command">
          <ArrowLeft className="h-4 w-4" />
          Zur Leitstelle
        </Link>
      </Button>
    </div>
  );
}
