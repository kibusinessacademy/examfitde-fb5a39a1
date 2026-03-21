"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow new admin routes outside command/studio/queue",
    },
    schema: [],
    messages: {
      forbiddenRoute:
        "Only /admin, /admin/command, /admin/studio, /admin/studio/:packageId, /admin/queue and /admin/* are allowed.",
    },
  },

  create(context) {
    const allowed = [
      "/admin",
      "/admin/command",
      "/admin/studio",
      "/admin/studio/:packageId",
      "/admin/queue",
      "/admin/*",
    ];

    const legacyRedirectPrefixes = [
      "/admin/dashboard",
      "/admin/home",
      "/admin/courses",
      "/admin/course-studio",
      "/admin/packages/",
      "/admin/berufski/",
      "/admin/control-tower",
      "/admin/leitstelle",
      "/admin/system/",
      "/admin/business/",
      "/admin/revenue/",
      "/admin/content/",
      "/admin/crm/",
      "/admin/support/",
      "/admin/quality/",
      "/admin/finance/",
      "/admin/council/",
      "/admin/jobs/",
      "/admin/ops/queue/",
    ];

    function checkValue(node, value) {
      if (typeof value !== "string") return;
      if (!value.startsWith("/admin")) return;

      const isAllowed = allowed.includes(value);
      const isLegacyRedirect = legacyRedirectPrefixes.some((p) => value.startsWith(p));

      if (!isAllowed && !isLegacyRedirect) {
        context.report({ node, messageId: "forbiddenRoute" });
      }
    }

    return {
      Literal(node) {
        checkValue(node, node.value);
      },
      TemplateElement(node) {
        if (node.value && typeof node.value.cooked === "string") {
          checkValue(node, node.value.cooked);
        }
      },
    };
  },
};
