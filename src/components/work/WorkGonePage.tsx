import { Link } from 'react-router-dom';

/**
 * Shows a 410 Gone page for all legacy /berufski/* routes.
 */
export default function WorkGonePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8">
        <h1 className="text-4xl font-bold">410 – Gone</h1>
        <p className="text-muted-foreground max-w-md">
          Diese Seite existiert nicht mehr. Der Inhalt ist jetzt unter <strong>/work</strong> verfügbar.
        </p>
        <Link to="/work" className="inline-block mt-4 px-6 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90">
          Zu ExamFit@work →
        </Link>
      </div>
    </div>
  );
}
