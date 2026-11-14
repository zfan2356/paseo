// Run in the affected Mac renderer's DevTools console while the artifacts are visible.
JSON.stringify(
  {
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
    reducedTransparency: matchMedia("(prefers-reduced-transparency: reduce)").matches,
    surfaces: Array.from(document.querySelectorAll("[data-material]")).map((element) => {
      const css = getComputedStyle(element);
      return {
        material: element.getAttribute("data-material"),
        testId: element.getAttribute("data-testid"),
        rect: element.getBoundingClientRect().toJSON(),
        background: css.backgroundColor,
        border: css.border,
        shadow: css.boxShadow,
        filter: css.filter,
        backdropFilter: css.backdropFilter,
        transform: css.transform,
        position: css.position,
        opacity: css.opacity,
        visibility: css.visibility,
        clearance: css.getPropertyValue("--paseo-composer-clearance"),
      };
    }),
  },
  null,
  2,
);
