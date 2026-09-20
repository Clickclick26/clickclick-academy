/* Meta pixel (dataset "ClickClick Web", 1380858564208304).

   Loads only after the visitor allows advertising cookies, which is its own
   tickbox: the pixel reports to Facebook and feeds ad targeting, so it is not
   covered by agreeing to analytics.

   What it is for: Meta currently optimises the ads for form fills, because a
   form fill is the only thing it can see. Once it can see who reaches the
   course and who buys, it can look for those people instead. */
(function () {
  const PIXEL_ID = "1380858564208304";
  let loaded = false;

  function loadPixel() {
    if (loaded) return;
    loaded = true;
    /* eslint-disable */
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq("init", PIXEL_ID);
    window.fbq("track", "PageView");
  }

  // There is no unload for the pixel once the script is in, so a later
  // rejection stops any further events rather than pretending otherwise.
  function stopPixel() {
    if (!loaded) return;
    window.fbq = function () {};
  }

  function apply(consent) {
    if (consent && consent.marketing) loadPixel();
    else stopPixel();
  }

  document.addEventListener("cc-consent", function (e) {
    apply(e.detail);
  });

  if (window.ccConsent && window.ccConsent.allowsMarketing && window.ccConsent.allowsMarketing()) {
    loadPixel();
  }
})();
