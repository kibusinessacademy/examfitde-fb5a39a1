import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          "bg-subtle": "hsl(var(--destructive-bg-subtle))",
          "border": "hsl(var(--destructive-border))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          "bg-subtle": "hsl(var(--success-bg-subtle))",
          "border": "hsl(var(--success-border))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          "bg-subtle": "hsl(var(--warning-bg-subtle))",
          "border": "hsl(var(--warning-border))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          "bg-subtle": "hsl(var(--info-bg-subtle))",
          "border": "hsl(var(--info-border))",
        },
        // ── Status family v1 (alias-only; siehe index.css) ──
        // Eigene Tailwind-API, visuell identisch zu destructive/success/warning.
        // Pflicht: KEINE Opacity-Suffixe (/40, /60, …) — nutze immer die
        // benannten Subtokens (border, bg-subtle, text, fg).
        status: {
          error: {
            DEFAULT: "hsl(var(--status-error))",
            text: "hsl(var(--status-error-text))",
            foreground: "hsl(var(--status-error-foreground))",
            fg: "hsl(var(--status-error-fg))",
            subtle: "hsl(var(--status-error-subtle))",
            "bg-subtle": "hsl(var(--status-error-bg-subtle))",
            border: "hsl(var(--status-error-border))",
          },
          success: {
            DEFAULT: "hsl(var(--status-success))",
            text: "hsl(var(--status-success-text))",
            foreground: "hsl(var(--status-success-foreground))",
            fg: "hsl(var(--status-success-fg))",
            subtle: "hsl(var(--status-success-subtle))",
            "bg-subtle": "hsl(var(--status-success-bg-subtle))",
            border: "hsl(var(--status-success-border))",
          },
          warning: {
            DEFAULT: "hsl(var(--status-warning))",
            text: "hsl(var(--status-warning-text))",
            foreground: "hsl(var(--status-warning-foreground))",
            fg: "hsl(var(--status-warning-fg))",
            subtle: "hsl(var(--status-warning-subtle))",
            "bg-subtle": "hsl(var(--status-warning-bg-subtle))",
            border: "hsl(var(--status-warning-border))",
          },
          info: {
            DEFAULT: "hsl(var(--status-info))",
            text: "hsl(var(--status-info-text))",
            foreground: "hsl(var(--status-info-foreground))",
            fg: "hsl(var(--status-info-fg))",
            subtle: "hsl(var(--status-info-subtle))",
            "bg-subtle": "hsl(var(--status-info-bg-subtle))",
            border: "hsl(var(--status-info-border))",
          },
          done: {
            DEFAULT: "hsl(var(--status-done))",
            fg: "hsl(var(--status-done-fg))",
            subtle: "hsl(var(--status-done-subtle))",
            border: "hsl(var(--status-done-border))",
          },
          current: {
            DEFAULT: "hsl(var(--status-current))",
            fg: "hsl(var(--status-current-fg))",
            subtle: "hsl(var(--status-current-subtle))",
            border: "hsl(var(--status-current-border))",
          },
          recommendation: {
            DEFAULT: "hsl(var(--status-recommendation))",
            fg: "hsl(var(--status-recommendation-fg))",
            subtle: "hsl(var(--status-recommendation-subtle))",
            border: "hsl(var(--status-recommendation-border))",
          },
          locked: {
            DEFAULT: "hsl(var(--status-locked))",
            fg: "hsl(var(--status-locked-fg))",
            subtle: "hsl(var(--status-locked-subtle))",
            border: "hsl(var(--status-locked-border))",
          },
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // ── Text Hierarchy v2 ──
        text: {
          primary: "hsl(var(--text-primary))",
          secondary: "hsl(var(--text-secondary))",
          tertiary: "hsl(var(--text-tertiary))",
          quaternary: "hsl(var(--text-quaternary))",
          "on-petrol": "hsl(var(--text-on-petrol))",
          "on-gradient": "hsl(var(--text-on-gradient))",
        },
        scrim: "hsl(var(--scrim))",
        "track-subtle": "hsl(var(--track-subtle))",
        // ── Surface Hierarchy v2 ──
        surface: {
          sunken: "hsl(var(--surface-sunken))",
          DEFAULT: "hsl(var(--surface-default))",
          raised: "hsl(var(--surface-raised))",
          overlay: "hsl(var(--surface-overlay))",
        },
        // ── Border Hierarchy v2 ──
        "border-subtle": "hsl(var(--border-subtle))",
        "border-strong": "hsl(var(--border-strong))",
        "border-focus": "hsl(var(--border-focus))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Semantic colors for learning status
        petrol: {
          50: "hsl(181 61% 95%)",
          100: "hsl(181 61% 90%)",
          200: "hsl(181 61% 80%)",
          300: "hsl(181 61% 60%)",
          400: "hsl(181 61% 40%)",
          500: "hsl(181 61% 25%)",
          600: "hsl(181 61% 20%)",
          700: "hsl(181 61% 15%)",
          800: "hsl(181 64% 12%)",
          900: "hsl(181 64% 8%)",
          950: "hsl(181 64% 5%)",
        },
        mint: {
          50: "hsl(168 64% 95%)",
          100: "hsl(168 64% 90%)",
          200: "hsl(168 64% 80%)",
          300: "hsl(168 64% 70%)",
          400: "hsl(168 64% 60%)",
          500: "hsl(168 64% 50%)",
          600: "hsl(168 64% 40%)",
          700: "hsl(168 64% 30%)",
          800: "hsl(168 64% 20%)",
          900: "hsl(168 64% 10%)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-10px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.8" },
        },
        // ── Premium Motion v3 patterns ──
        "reveal-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 hsl(var(--ring) / 0.0)" },
          "50%": { boxShadow: "0 0 0 8px hsl(var(--ring) / 0.18)" },
        },
        "soft-bounce": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "pulse-subtle": "pulse-subtle 2s ease-in-out infinite",
        "reveal-up": "reveal-up var(--motion-slow, 380ms) var(--ease-out, cubic-bezier(0.22,1,0.36,1)) both",
        "shimmer": "shimmer 1.6s linear infinite",
        "glow-pulse": "glow-pulse 2.4s ease-in-out infinite",
        "soft-bounce": "soft-bounce 1.4s ease-in-out infinite",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.22, 1, 0.36, 1)",
        "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "in-out-quint": "cubic-bezier(0.65, 0, 0.35, 1)",
      },
      transitionDuration: {
        instant: "80ms",
        fast: "150ms",
        base: "220ms",
        slow: "380ms",
      },
      boxShadow: {
        glow: "var(--shadow-glow)",
        "glow-sm": "0 0 10px hsl(168 64% 50% / 0.2)",
        "glow-lg": "0 0 40px hsl(168 64% 50% / 0.3)",
        // ── Elevation system v2 (cool-tinted, not dirty-black) ──
        "elev-1": "0 1px 2px 0 hsl(215 30% 20% / 0.04), 0 1px 3px 0 hsl(215 30% 20% / 0.06)",
        "elev-2": "0 2px 4px -1px hsl(215 30% 20% / 0.06), 0 4px 8px -2px hsl(215 30% 20% / 0.08)",
        "elev-3": "0 4px 8px -2px hsl(215 30% 20% / 0.08), 0 12px 24px -6px hsl(215 30% 20% / 0.10)",
        "elev-4": "0 8px 16px -4px hsl(215 30% 20% / 0.10), 0 24px 48px -12px hsl(215 30% 20% / 0.14)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
