import { Link, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, ShieldCheck, LineChart, History, ArrowRight } from 'lucide-react';

/**
 * Login-Gate für Trainer/Prüfungs-Einstiege.
 * Zeigt einen klaren Hinweis, warum Login Pflicht ist (Fortschritt wird sonst
 * nicht gespeichert), und führt sauber zurück auf die ursprüngliche Route.
 */
export interface RequireLoginToTrainProps {
  feature: string;
  title?: string;
  description?: string;
  redirectTo?: string;
}

export function RequireLoginToTrain({
  feature,
  title = 'Login erforderlich, damit dein Fortschritt gespeichert wird',
  description = 'Damit deine Antworten, Streaks und Schwächen-Analyse dauerhaft sichtbar bleiben, melde dich kurz an. Du springst direkt hierher zurück.',
  redirectTo,
}: RequireLoginToTrainProps) {
  const location = useLocation();
  const target = encodeURIComponent(redirectTo ?? `${location.pathname}${location.search}`);

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl" data-testid={`require-login-${feature}`}>
      <Card variant="raised" data-density="comfortable">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-full bg-petrol-50 text-petrol-700 flex items-center justify-center">
            <Lock className="h-7 w-7" aria-hidden />
          </div>
          <CardTitle className="text-2xl font-display">{title}</CardTitle>
          <CardDescription className="text-base">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ul className="grid gap-3 sm:grid-cols-3 text-sm">
            <li className="flex items-start gap-2 rounded-lg border border-border/60 p-3">
              <LineChart className="h-4 w-4 mt-0.5 text-petrol-600" aria-hidden />
              <span>Fortschritt &amp; Streak werden gespeichert</span>
            </li>
            <li className="flex items-start gap-2 rounded-lg border border-border/60 p-3">
              <History className="h-4 w-4 mt-0.5 text-petrol-600" aria-hidden />
              <span>Du kannst Sessions später fortsetzen</span>
            </li>
            <li className="flex items-start gap-2 rounded-lg border border-border/60 p-3">
              <ShieldCheck className="h-4 w-4 mt-0.5 text-petrol-600" aria-hidden />
              <span>Käufe &amp; Lizenzen werden erkannt</span>
            </li>
          </ul>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button asChild className="flex-1">
              <Link to={`/auth?redirect=${target}`}>
                Jetzt anmelden
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <Link to={`/auth?mode=signup&redirect=${target}`}>Kostenlos registrieren</Link>
            </Button>
          </div>
          <p className="text-xs text-text-secondary text-center">
            Ohne Login starten? Du kannst Demo-Inhalte unter <Link to="/demo" className="underline">/demo</Link> ausprobieren — dort wird kein Fortschritt gespeichert.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default RequireLoginToTrain;
