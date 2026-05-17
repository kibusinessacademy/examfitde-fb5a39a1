// Bootstrap entrypoint — clears legacy SW/cache artifacts before mounting the app. (rev 2)
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

async function clearLegacyRuntimeArtifacts() {
  if (typeof window === "undefined") return;

  const cleanupKey = "examfit-runtime-cleanup-v3";
  const url = new URL(window.location.href);
  const hasReloadFlag = url.searchParams.get("sw-reset") === "1";

  const cleanupAlreadyDone =
    localStorage.getItem(cleanupKey) === "done" ||
    sessionStorage.getItem(cleanupKey) === "done";

  if (cleanupAlreadyDone && !hasReloadFlag) {
    return;
  }

  let shouldReload = false;

  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const legacyRegistrations = registrations.filter((registration) => {
        const activeUrl = registration.active?.scriptURL ?? registration.installing?.scriptURL ?? registration.waiting?.scriptURL ?? "";
        return !activeUrl.endsWith("/push-sw.js");
      });
      shouldReload = shouldReload || legacyRegistrations.length > 0;
      await Promise.all(legacyRegistrations.map((registration) => registration.unregister().catch(() => false)));
    } catch (error) {
      console.warn("Failed to unregister service workers", error);
    }
  }

  if ("caches" in window) {
    try {
      const cacheKeys = await caches.keys();
      shouldReload = shouldReload || cacheKeys.length > 0;
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey).catch(() => false)));
    } catch (error) {
      console.warn("Failed to clear caches", error);
    }
  }

  try {
    localStorage.setItem(cleanupKey, "done");
  } catch {
    sessionStorage.setItem(cleanupKey, "done");
  }

  if (shouldReload && !hasReloadFlag) {
    url.searchParams.set("sw-reset", "1");
    window.location.replace(url.toString());
    await new Promise(() => undefined);
  }

  if (hasReloadFlag) {
    url.searchParams.delete("sw-reset");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
}

async function bootstrap() {
  await clearLegacyRuntimeArtifacts();
  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
