import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { SEOHead } from "@/components/seo/SEOHead";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft, Search } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <SEOHead
        title="Seite nicht gefunden – ExamFit"
        description="Die angeforderte Seite wurde nicht gefunden. Kehre zur Startseite zurück oder nutze die Suche."
        noindex
      />
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center max-w-md">
          <div className="text-8xl font-display font-bold text-gradient mb-4">404</div>
          <h1 className="text-2xl font-display font-bold mb-2">Seite nicht gefunden</h1>
          <p className="text-muted-foreground mb-8">
            Die Seite <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{location.pathname}</code> existiert leider nicht.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/">
              <Button className="gap-2 w-full sm:w-auto">
                <Home className="h-4 w-4" />
                Zur Startseite
              </Button>
            </Link>
            <Link to="/suche">
              <Button variant="outline" className="gap-2 w-full sm:w-auto">
                <Search className="h-4 w-4" />
                Suche
              </Button>
            </Link>
            <Button variant="ghost" className="gap-2" onClick={() => window.history.back()}>
              <ArrowLeft className="h-4 w-4" />
              Zurück
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default NotFound;
