import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Trailing-Slash-Normalizer (SSOT: ohne Trailing-Slash)
 *
 * Politik: Alle Routes außer "/" werden ohne Trailing-Slash kanonisiert.
 * Wenn der User /preise/ aufruft, redirecten wir client-side via replace()
 * auf /preise — so bleibt URL, Canonical und Sitemap konsistent.
 *
 * Auth-/Admin-/Asset-Pfade werden ausgenommen, um keine Auth-State-Verluste zu
 * triggern.
 */
const EXCLUDED_PREFIXES = ['/admin', '/api', '/auth/reset-password'];

export function useTrailingSlashNormalizer() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (pathname === '/') return;
    if (!pathname.endsWith('/')) return;
    if (EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p))) return;
    // Strip trailing slashes (handles /a// → /a)
    const stripped = pathname.replace(/\/+$/, '') || '/';
    navigate(`${stripped}${search}${hash}`, { replace: true });
  }, [pathname, search, hash, navigate]);
}
