import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import esbuild from "esbuild";
import fs from "node:fs";

/**
 * SEO Prerender Plugin
 * Loads src/content/seoRoutes.ts via esbuild, exposes routes on globalThis,
 * runs scripts/seo/prerender.mjs after the bundle is closed.
 * Skipped in dev / SSR / library builds.
 */
function seoPrerenderPlugin(): Plugin {
  return {
    name: "examfit-seo-prerender",
    apply: "build",
    async closeBundle() {
      try {
        const ssotPath = path.resolve(__dirname, "src/content/seoRoutes.ts");
        if (!fs.existsSync(ssotPath)) return;

        const bundled = await esbuild.build({
          entryPoints: [ssotPath],
          bundle: true,
          platform: "node",
          format: "esm",
          target: "es2022",
          write: false,
          external: [],
        });
        const code = bundled.outputFiles[0].text;
        // Evaluate as ESM via data URL
        const dataUrl =
          "data:text/javascript;base64," + Buffer.from(code).toString("base64");
        const mod = await import(dataUrl);
        const routes = mod.seoRoutes || [];
        (globalThis as any).__SEO_ROUTES__ = routes;

        const { runSeoPrerender } = await import("./scripts/seo/prerender.mjs");
        await runSeoPrerender();
      } catch (err) {
        // Do not fail the build for prerender errors in non-CI environments;
        // surface them loudly. CI workflow runs validate separately.
        console.error("[seo-prerender] FAILED:", err);
        if (process.env.CI) throw err;
      }
    },
  };
}


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      selfDestroying: true,
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      devOptions: { enabled: false },
      includeAssets: ["favicon.ico", "robots.txt", "apple-touch-icon.png", "pwa-192x192.png", "pwa-512x512.png", "pwa-maskable-512x512.png"],
      manifest: {
        name: "ExamFit.de - IHK Prüfungsvorbereitung",
        short_name: "ExamFit",
        description: "Deine Plattform für erfolgreiche IHK-Prüfungen. Lernkurse, Prüfungstrainer und mündliche Prüfungssimulation.",
        theme_color: "#0F3D3E",
        background_color: "#F8FAFC",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        categories: ["education", "productivity"],
        lang: "de",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ],
        screenshots: []
      },
      workbox: {
        globPatterns: [],
        navigateFallback: null,
        navigateFallbackDenylist: [/^\/~oauth/],
        runtimeCaching: []
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
