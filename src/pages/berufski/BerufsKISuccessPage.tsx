import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, Mail, ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function BerufsKISuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-lg w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <CheckCircle className="h-14 w-14 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold">Zahlung erfolgreich ✅</h1>
          <p className="text-muted-foreground">
            Du erhältst gleich eine E-Mail mit deinem Download-Link (PDF Screen + Print-Ready).
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" />
            <span>Prüfe ggf. deinen Spam-Ordner.</span>
          </div>
          {sessionId && (
            <p className="text-xs text-muted-foreground">Session: {sessionId.slice(0, 16)}…</p>
          )}
          <Button variant="outline" asChild className="mt-4">
            <Link to="/berufski">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück zu Berufs-KI
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
