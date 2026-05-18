import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

/**
 * SPA Fallback Plugin (Cloudflare Pages)
 * --------------------------------------------------------------
 * Cloudflare Pages serves dist/404.html for any path without a matching
 * static file, ignoring `_redirects` splat rewrites in some edge cases.
 * By overwriting dist/404.html with a copy of the SPA shell (dist/index.html),
 * unknown paths hydrate React Router and render the correct route.
 *
 * Trade-off: HTTP status remains 404 (CF Pages quirk), but the page is fully
 * functional. Prerendered routes (dist/<path>/index.html) are served verbatim
 * with status 200 and are not affected.
 */
function spaFallback404Plugin(): Plugin {
  return {
    name: "examfit-spa-fallback-404",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const dist = path.resolve(process.cwd(), "dist");
      const src = path.join(dist, "index.html");
      const dest = path.join(dist, "404.html");
      if (!fs.existsSync(src)) {
        console.warn("[spa-fallback-404] dist/index.html missing — skipped");
        return;
      }
      fs.copyFileSync(src, dest);
      console.log("[spa-fallback-404] dist/404.html ← dist/index.html (SPA shell)");
    },
  };
}

/**
 * SEO Prerender Plugin
 * --------------------------------------------------------------
 * After Vite finishes writing dist/, run scripts/seo/run-prerender.mjs in a
 * Node 22 subprocess (--experimental-strip-types), which:
 *   1. Loads SSOT (src/content/seoRoutes.ts)
 *   2. Validates live routes (Quality Gate)
 *   3. Writes per-route HTML shells into dist/<path>/index.html
 *   4. Writes dist/sitemap.xml + dist/sitemaps/{static,products,blog,content}.xml
 *   5. Re-validates the on-disk HTML
 * The whole build aborts on any validation failure.
 */
function seoPrerenderPlugin(): Plugin {
  return {
    name: "examfit-seo-prerender",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const result = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/seo/run-prerender.mjs"],
        { stdio: "inherit", cwd: process.cwd() },
      );
      if (result.status !== 0) {
        throw new Error(
          `[examfit-seo-prerender] subprocess exited with code ${result.status}`,
        );
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
      injectRegister: false,
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
    }),
    seoPrerenderPlugin(),
    // spaFallback404Plugin disabled on Vercel: it overwrote dist/404.html with the
    // SPA shell, which made Vercel serve every unmatched deep route (e.g. /diag,
    // /aevo-pruefung) with status 404 instead of the rewrite to /index.html (200).
    // Vercel's SPA fallback is handled via the rewrite rule in vercel.json.
    // spaFallback404Plugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
