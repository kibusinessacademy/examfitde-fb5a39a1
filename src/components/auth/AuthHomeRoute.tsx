import { Navigate } from 'react-router-dom';

/**
 * Route-level guard for /.
 *
 * 2026-06-28: ExamFit/Shop ist die neue Startseite von berufOS.
 * Andere Produkte (Berufs-KI etc.) sind noch nicht produktreif —
 * deshalb leitet "/" deterministisch auf die ExamFit-Landingpage (/examfit),
 * die innerhalb des MainLayouts gemountet ist.
 *
 * Eingeloggte Learner gelangen weiterhin über das Header-Menü zu /dashboard.
 */
export default function AuthHomeRoute() {
  return <Navigate to="/examfit" replace />;
}
