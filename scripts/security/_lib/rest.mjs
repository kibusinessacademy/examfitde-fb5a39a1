/**
 * Supabase REST/RPC/Edge Function call helpers for security tests.
 */
import { jfetch } from "./http.mjs";

export function getEnv() {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const TEST_USER_JWT = process.env.TEST_USER_JWT || null;
  const ADMIN_TEST_JWT = process.env.ADMIN_TEST_JWT || null;
  const DEFAULT_AUDIT_PACKAGE_ID = process.env.DEFAULT_AUDIT_PACKAGE_ID || null;

  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (or VITE_SUPABASE_URL)");
  return { SUPABASE_URL, SERVICE_KEY, ANON_KEY, TEST_USER_JWT, ADMIN_TEST_JWT, DEFAULT_AUDIT_PACKAGE_ID };
}

export function restUrl(base, path) {
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function restSelect({ base, key, table, select = "*", qs = "" }) {
  const url = restUrl(base, `/rest/v1/${table}?select=${encodeURIComponent(select)}${qs}`);
  return jfetch(url, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
}

export async function rpcCall({ base, key, fn, body = {} }) {
  const url = restUrl(base, `/rest/v1/rpc/${fn}`);
  return jfetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

export async function fnCall({ base, bearer, fnName, body }) {
  const url = restUrl(base, `/functions/v1/${fnName}`);
  return jfetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body ?? {}),
  });
}
