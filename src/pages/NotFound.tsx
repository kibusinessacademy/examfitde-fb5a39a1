import { useLocation, Link } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { SEOHead } from "@/components/seo/SEOHead";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Home,
  ArrowLeft,
  Search,
  Building2,
  GraduationCap,
  Sparkles,
  ShieldAlert,
  ShoppingBag,
} from "lucide-react";

type Suggestion = {
  label: string;
  to?: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: "petrol" | "outline" | "ghost" | "default";
};

type RouteHint = {
  headline: string;
  body: string;
  primary: Suggestion;
  secondary?: Suggestion;
};

function getHintForPath(pathname: string): RouteHint {
  const p = pathname.toLowerCase();

  // Org-Bereich: Nutzer ohne Org-Mitgliedschaft
  if (p.startsWith("/org")) {
    return {
      headline: "Kein Zugriff auf den Organisations-Bereich",
      body:
        "Diese Seite ist nur für Mitglieder einer Organisation sichtbar. Lass dich von deiner Org einladen oder kontaktiere unser Team für ein Enterprise-Setup.",
      primary: {
        label: "Enterprise kontaktieren",
        href: "mailto:sales@berufos.com?subject=Organisations-Zugang",
        icon: Building2,
        variant: "petrol",
      },
      secondary: {
        label: "Zum Dashboard",
        to: "/dashboard",
        icon: Home,
        variant: "outline",
      },
    };
  }

  // AI-Tutor ist als Panel embedded — leite in den Trainer
  if (p.startsWith("/ai-tutor") || p.startsWith("/tutor")) {
    return {
      headline: "Der KI-Prüfungscoach ist im Trainer integriert",
      body:
        "Starte ein Prüfungstraining für deinen Beruf — der KI-Tutor erscheint dann direkt im Übungsfluss, sobald du Hilfe brauchst.",
      primary: {
        label: "Prüfungstrainer öffnen",
        to: "/exam-trainer",
        icon: Sparkles,
        variant: "petrol",
      },
      secondary: {
        label: "Zum Dashboard",
        to: "/dashboard",
        icon: Home,
        variant: "outline",
      },
    };
  }

  // Admin-Bereich
  if (p.startsWith("/admin")) {
    return {
      headline: "Admin-Bereich nicht erreichbar",
      body:
        "Diese Seite ist nur für Admins. Melde dich mit einem Admin-Account an oder kehre zurück zur App.",
      primary: {
        label: "Anmelden",
        to: "/auth",
        icon: ShieldAlert,
        variant: "petrol",
      },
      secondary: {
        label: "Zur Startseite",
        to: "/",
        icon: Home,
        variant: "outline",
      },
    };
  }

  // Lerner-Routes
  if (
    p.startsWith("/dashboard") ||
    p.startsWith("/heatmap") ||
    p.startsWith("/exam") ||
    p.startsWith("/training") ||
    p.startsWith("/shuttle")
  ) {
    return {
      headline: "Lernbereich nicht gefunden",
      body:
        "Die angeforderte Lern-Seite existiert nicht. Starte direkt mit deinem Prüfungstraining oder öffne dein Dashboard.",
      primary: {
        label: "Trainer starten",
        to: "/exam-trainer",
        icon: GraduationCap,
        variant: "petrol",
      },
      secondary: {
        label: "Zum Dashboard",
        to: "/dashboard",
        icon: Home,
        variant: "outline",
      },
    };
  }

  // Berufe / Personas / Marketing
  if (
    p.startsWith("/berufe") ||
    p.startsWith("/personas") ||
    p.startsWith("/preise") ||
    p.startsWith("/shop")
  ) {
    return {
      headline: "Diese Marketing-Seite gibt es nicht",
      body:
        "Vielleicht ist der Beruf umbenannt oder die Aktion abgelaufen. Stöbere im Shop oder finde deinen Beruf über die Suche.",
      primary: {
        label: "Zum Shop",
        to: "/shop",
        icon: ShoppingBag,
        variant: "petrol",
      },
      secondary: {
        label: "Beruf suchen",
        to: "/personas",
        icon: Search,
        variant: "outline",
      },
    };
  }

  // Default
  return {
    headline: "Seite nicht gefunden",
    body: "Die angeforderte Seite existiert nicht. Vielleicht hilft dir einer dieser Links weiter.",
    primary: {
      label: "Zur Startseite",
      to: "/",
      icon: Home,
      variant: "petrol",
    },
    secondary: {
      label: "Suche",
      to: "/personas",
      icon: Search,
      variant: "outline",
    },
  };
}

function CTAButton({ s }: { s: Suggestion }) {
  const inner = (
    <Button variant={(s.variant as any) ?? "default"} className="gap-2 w-full sm:w-auto">
      <s.icon className="h-4 w-4" />
      {s.label}
    </Button>
  );
  if (s.href) {
    return (
      <a href={s.href} className="block w-full sm:w-auto">
        {inner}
      </a>
    );
  }
  return (
    <Link to={s.to ?? "/"} className="block w-full sm:w-auto">
      {inner}
    </Link>
  );
}

const NotFound = () => {
  const location = useLocation();
  const hint = useMemo(() => getHintForPath(location.pathname), [location.pathname]);

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <SEOHead
        title="Seite nicht gefunden – ExamFit"
        description="Die angeforderte Seite wurde nicht gefunden. Wir leiten dich zum passenden Bereich weiter."
        noindex
      />
      <div
        className="flex min-h-screen items-center justify-center bg-background px-4 py-16"
        data-density="comfortable"
      >
        <Card variant="raised" className="w-full max-w-xl p-8 sm:p-10 text-center">
          <div className="text-6xl sm:text-7xl font-display font-bold text-petrol-400 mb-3 tabular-nums">
            404
          </div>
          <h1 className="text-2xl font-display font-bold text-text-primary mb-3">
            {hint.headline}
          </h1>
          <p className="text-text-secondary mb-2">{hint.body}</p>
          <p className="text-xs text-text-tertiary mb-8">
            Pfad:{" "}
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-text-secondary">
              {location.pathname}
            </code>
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
            <CTAButton s={hint.primary} />
            {hint.secondary && <CTAButton s={hint.secondary} />}
          </div>

          <Button
            variant="ghost"
            className="gap-2 text-text-tertiary hover:text-text-primary"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </Button>
        </Card>
      </div>
    </>
  );
};

export default NotFound;
