(() => {
  const RTL_DIR = "rtl";

  function enforceRtl(root) {
    if (!root) {
      return;
    }
    if (root.getAttribute("dir") !== RTL_DIR) {
      root.setAttribute("dir", RTL_DIR);
    }
  }

  const html = document.documentElement;
  enforceRtl(html);

  const observer = new MutationObserver(() => {
    enforceRtl(document.documentElement);
  });

  observer.observe(html, {
    attributes: true,
    attributeFilter: ["dir"],
  });
})();
