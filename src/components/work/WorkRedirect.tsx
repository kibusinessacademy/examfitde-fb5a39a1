import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Catches all /berufski/* routes and redirects to /work/*
 * Preserves search params and hash.
 */
export default function WorkRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const newPath = location.pathname.replace(/^\/berufski/, '/work');
    navigate(newPath + location.search + location.hash, { replace: true });
  }, [location, navigate]);

  return null;
}
