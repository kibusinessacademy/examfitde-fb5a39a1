import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const SW_PATH = "/push-sw.js";

type Status = "idle" | "unsupported" | "denied" | "prompt" | "subscribed" | "error";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidPublicKey(): Promise<string | null> {
  // Public key may be exposed via a tiny edge function or env. We try the
  // edge function first (safe to call unauth, returns only the public key).
  try {
    const { data, error } = await supabase.functions.invoke("get-vapid-public-key", {
      body: {},
    });
    if (error) return null;
    return (data as any)?.publicKey ?? null;
  } catch {
    return null;
  }
}

export function usePushSubscription() {
  const [status, setStatus] = useState<Status>("idle");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    const perm = Notification.permission;
    if (perm === "denied") { setStatus("denied"); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        setEndpoint(sub.endpoint);
        setStatus("subscribed");
        return;
      }
    } catch { /* fall through */ }
    setStatus(perm === "granted" ? "prompt" : "prompt");
  }, []);

  useEffect(() => { detect(); }, [detect]);

  const subscribe = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported"); return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "prompt");
        return;
      }
      const publicKey = await fetchVapidPublicKey();
      if (!publicKey) throw new Error("Push-Server (VAPID) noch nicht bereit. Bitte später erneut versuchen.");

      const reg = await navigator.serviceWorker.register(SW_PATH);
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      const json: any = sub.toJSON();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Bitte einloggen, um Push zu aktivieren.");

      const { error: upsertError } = await supabase
        .from("learner_push_subscriptions")
        .upsert({
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth_key: json.keys?.auth ?? "",
          platform: "web",
          user_agent: navigator.userAgent.slice(0, 500),
          last_seen_at: new Date().toISOString(),
          revoked_at: null,
        }, { onConflict: "user_id,endpoint" });

      if (upsertError) throw upsertError;
      setEndpoint(sub.endpoint);
      setStatus("subscribed");
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        const ep = sub.endpoint;
        await sub.unsubscribe();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from("learner_push_subscriptions")
            .update({ revoked_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .eq("endpoint", ep);
        }
      }
      setEndpoint(null);
      setStatus("prompt");
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, endpoint, busy, error, subscribe, unsubscribe, refresh: detect };
}
