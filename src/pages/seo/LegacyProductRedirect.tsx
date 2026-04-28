/**
 * LegacyProductRedirect
 * Bundle-only Strategie: Alle Legacy-Produktrouten leiten dauerhaft auf /bundle/:slug um.
 * Wir nutzen <Navigate replace> für SPA-internes 301-äquivalentes Redirect.
 *
 * Betroffene Routen:
 *  - /lernkurse/:slug   -> /bundle/:slug
 *  - /pruefungstrainer/:slug -> /bundle/:slug
 *  - /lernkurse        -> /bundle
 *  - /pruefungstrainer -> /bundle
 */
import { Navigate, useParams } from 'react-router-dom';

export default function LegacyProductRedirect() {
  const { slug } = useParams<{ slug?: string }>();
  const target = slug ? `/bundle/${slug}` : '/bundle';
  return <Navigate to={target} replace />;
}
