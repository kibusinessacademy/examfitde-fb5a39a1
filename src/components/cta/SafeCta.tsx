/**
 * SafeCta — SSOT call-to-action component.
 *
 * Hard guarantees:
 *  - No `/bundle/*` link is ever rendered (rewritten to `/paket/*`).
 *  - Unknown internal targets fall back to SAFE_FALLBACK_ROUTE in production
 *    and throw in development/test so regressions are caught early.
 *  - Either an internal `to`, an external `href`, or an `onClick` MUST be set.
 *
 * Use this for every marketing/funnel CTA so we never re-introduce the
 * Vercel-404 class of bugs (e.g. /bundle/zimmerer-in).
 */

import * as React from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { isKnownRoute, SAFE_FALLBACK_ROUTE } from "@/lib/route-registry";
import { resolveAuthorityHref, isAuthorityForceActive } from "@/lib/seo/authorityHref";

export interface SafeCtaProps extends Omit<ButtonProps, "asChild"> {
  /** Internal SPA route. Routed through react-router <Link>. */
  to?: string;
  /** External URL or anchor. Renders <a>. */
  href?: string;
  /** Click handler — required if neither `to` nor `href` is set. */
  onClick?: React.MouseEventHandler<HTMLElement>;
  /** Optional <Link> props passthrough. */
  linkProps?: Omit<LinkProps, "to">;
  /** target/rel for external links. */
  target?: string;
  rel?: string;
  children: React.ReactNode;
}

/**
 * Resolve a raw `to` target to a safe SPA route.
 * - rewrites /bundle/<x> → /paket/<x>
 * - logs + falls back when route is unknown
 */
export function resolveSafeTarget(raw: string): string {
  let target = raw.trim();

  // Hard rewrite: /bundle/* must never be linked.
  if (target === "/bundle" || target.startsWith("/bundle/")) {
    const rewritten = target.replace(/^\/bundle/, "/paket");
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn(
        `[SafeCta] Rewrote forbidden /bundle target → ${rewritten}. Update the call site.`,
      );
    }
    target = rewritten;
  }

  if (!isKnownRoute(target)) {
    const msg = `[SafeCta] Unknown route target "${raw}". Falling back to ${SAFE_FALLBACK_ROUTE}.`;
    if (
      typeof process !== "undefined" &&
      (process.env?.NODE_ENV === "development" || process.env?.NODE_ENV === "test")
    ) {
      throw new Error(msg);
    }
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.error(msg);
    }
    return SAFE_FALLBACK_ROUTE;
  }
  return target;
}

export const SafeCta = React.forwardRef<HTMLButtonElement, SafeCtaProps>(
  function SafeCta({ to, href, onClick, linkProps, target, rel, children, ...buttonProps }, ref) {
    const wiredCount = [to, href, onClick].filter(Boolean).length;
    if (wiredCount === 0) {
      const msg = "[SafeCta] requires one of `to`, `href`, or `onClick`.";
      if (
        typeof process !== "undefined" &&
        (process.env?.NODE_ENV === "development" || process.env?.NODE_ENV === "test")
      ) {
        throw new Error(msg);
      }
      // eslint-disable-next-line no-console
      console.error(msg);
    }

    if (to) {
      const safeTo = resolveSafeTarget(to);
      // Reality-Gate: in Authority-Force-Mode CTAs absolutisieren auf berufos.com,
      // damit Tests cross-origin nicht versehentlich auf preview-hosts driften.
      if (isAuthorityForceActive()) {
        const absHref = resolveAuthorityHref(safeTo);
        return (
          <Button asChild ref={ref} {...buttonProps}>
            <a href={absHref}>{children}</a>
          </Button>
        );
      }
      return (
        <Button asChild ref={ref} {...buttonProps}>
          <Link to={safeTo} {...linkProps}>
            {children}
          </Link>
        </Button>
      );
    }

    if (href) {
      const isExternal = /^(https?:|mailto:|tel:)/i.test(href);
      const safeRel = rel ?? (isExternal && target === "_blank" ? "noopener noreferrer" : rel);
      return (
        <Button asChild ref={ref} {...buttonProps}>
          <a href={href} target={target} rel={safeRel}>
            {children}
          </a>
        </Button>
      );
    }

    return (
      <Button ref={ref} onClick={onClick} {...buttonProps}>
        {children}
      </Button>
    );
  },
);

export default SafeCta;
