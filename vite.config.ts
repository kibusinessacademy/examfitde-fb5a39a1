import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Remove dist/404.html Plugin (Vercel)
 * --------------------------------------------------------------
 * Vercel serves dist/404.html (when present) with HTTP 404 for ANY
 * unmatched route BEFORE applying the SPA rewrite in vercel.json.
 * That kills SEO for deep links (e.g. /diag, /aevo-pruefung) even
 * though the body is the SPA shell.
 *
 * By actively deleting dist/404.html after build, Vercel falls through
 * to the rewrite rule `/((?!api/|assets/|sitemaps/).*) → /index.html`
 * and returns HTTP 200 with the SPA shell. React Router then renders
 * the NotFound component client-side.
 */
function removeDist404Plugin(): Plugin {
  const isVercel =
    process.env.VERCEL === "1" || process.env.DEPLOY_TARGET === "vercel";
  const isCloudflare = process.env.DEPLOY_TARGET === "cloudflare";
  return {
    name: "examfit-remove-dist-404",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const dist = path.resolve(process.cwd(), "dist");
      const target = path.join(dist, "404.html");

      if (isCloudflare) {
        console.log("[remove-dist-404] skipped (DEPLOY_TARGET=cloudflare)");
        return;
      }

      // Default + Vercel: dist/404.html must NOT exist (Vercel would serve it
      // with HTTP 404 for any unmatched route, bypassing the SPA rewrite).
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
        console.log(
          `[remove-dist-404] dist/404.html deleted (target=${isVercel ? "vercel" : "default"})`,
        );
      } else {
        console.log("[remove-dist-404] dist/404.html not present — ok");
      }

      // Hard P0 guard: on Vercel, fail the build loudly if anything wrote it back.
      if (isVercel && fs.existsSync(target)) {
        throw new Error(
          "[remove-dist-404] P0 SEO guard failed: dist/404.html still exists after cleanup. " +
            "Vercel would serve it with HTTP 404 and break SEO for deep links.",
        );
      }
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
      // No --experimental-strip-types: Vercel ships Node 20/22, not 24.
      // run-prerender.mjs uses esbuild to load the TS SSOT.
      console.log("[examfit-seo-prerender] starting subprocess…");
      const result = spawnSync(
        process.execPath,
        ["scripts/seo/run-prerender.mjs"],
        { stdio: "inherit", cwd: process.cwd() },
      );
      if (result.status !== 0) {
        throw new Error(
          `[examfit-seo-prerender] subprocess exited with code ${result.status}. ` +
            `Per-route HTML was NOT generated — refusing to ship a SPA-only build.`,
        );
      }
      // Hard post-check: dist/ MUST contain at least one per-route index.html
      // besides the shell, otherwise the deploy would silently serve only the
      // SPA fallback (the exact failure mode that left berufos.com broken).
      const verify = spawnSync(
        process.execPath,
        ["scripts/seo/verify-prerender-output.mjs"],
        { stdio: "inherit", cwd: process.cwd() },
      );
      if (verify.status !== 0) {
        throw new Error(
          `[examfit-seo-prerender] verify-prerender-output FAILED (exit ${verify.status}). ` +
            `Build aborted to prevent shipping an empty CSR shell to Vercel.`,
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
    removeDist404Plugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
