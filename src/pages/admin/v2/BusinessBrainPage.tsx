import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Brain, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const BusinessBrainControlCenter = lazy(() => import("@/components/admin/brain/BusinessBrainControlCenter"));

const Loading = () => (
  <Card><CardContent className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
);

export default function BusinessBrainPage() {
  return (
    <div className="space-y-4">
      <div>
        <Link to="/admin/command" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1 transition-colors">
          <ArrowLeft className="h-3 w-3" /> Leitstelle
        </Link>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          AI Business Brain
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Zentrale Entscheidungs- und Orchestrierungsschicht – Snapshots, Empfehlungen, Goals, Actions
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <BusinessBrainControlCenter />
      </Suspense>
    </div>
  );
}
