(() => {
  const RTL_DIR = "rtl";
  const STYLE_ID = "gemini-rtl-enforcer-style";
  const RTL_CSS = `
  body, html {
    direction: rtl !important;
  }
  /* Force main layout to RTL order */
  body {
    direction: rtl !important;
  }
  mat-sidenav-container,
  .mat-drawer-container,
  main,
  chat-window {
    direction: rtl !important;
  }
  /* Invert layout wrapper if flex is used */
  bard-sidenav-container,
  .side-nav-container,
  mat-sidenav {
    order: 2 !important;
  }
`;

  function enforceRtl(root) {
    if (!root) {
      return;
    }
    if (root.getAttribute("dir") !== RTL_DIR) {
      root.setAttribute("dir", RTL_DIR);
    }
  }

  function injectLayoutCss(root) {
    if (!root) {
      return;
    }
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = RTL_CSS;
      root.appendChild(style);
      return;
    }
    if (style.textContent !== RTL_CSS) {
      style.textContent = RTL_CSS;
    }
    if (style.parentNode !== root) {
      root.appendChild(style);
    }
  }

  function apply() {
    const html = document.documentElement;
    enforceRtl(html);
    injectLayoutCss(html);
  }

  apply();

  const observer = new MutationObserver(() => {
    apply();
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["dir"],
    childList: true,
  });
})();
