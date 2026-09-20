/* Cookie consent.
   Injects the banner on every page, stores the choice, and tells listeners
   (analytics.js) whether analytics cookies are allowed.

   Consent record: { essential: true, analytics: bool, choice: string, ts: number }
   Stored under a versioned key, so adding a new category re-asks once. */
(function () {
  const KEY = "cc-cookie-consent-2";
  const OLD_KEYS = ["cc-cookie-consent"];
  const EVENT = "cc-consent";

  const BANNER_HTML = [
    '<div class="cookie-banner-main">',
    '  <p class="cookie-banner-text">',
    "    We use an essential cookie to remember your choice, and optional analytics",
    "    cookies to see how the site is used so we can improve it.",
    '    <a href="https://www.clickclick.video/cookies.html">Learn more</a>',
    "  </p>",
    '  <div class="cookie-banner-actions">',
    '    <button type="button" class="cookie-btn cookie-btn-reject" data-cookie="reject">Reject</button>',
    '    <button type="button" class="cookie-btn cookie-btn-manage" data-cookie="manage">Manage</button>',
    '    <button type="button" class="cookie-btn cookie-btn-accept" data-cookie="accept">Accept</button>',
    "  </div>",
    "</div>",
    '<div class="cookie-banner-manage" id="cookie-manage" hidden>',
    '  <label class="cookie-option">',
    '    <input type="checkbox" checked disabled />',
    "    <span>",
    "      <strong>Essential</strong>",
    "      Remembers your cookie choice. Always on.",
    "    </span>",
    "  </label>",
    '  <label class="cookie-option">',
    '    <input type="checkbox" id="cookie-analytics" />',
    "    <span>",
    "      <strong>Analytics</strong>",
    "      Microsoft Clarity, so we can see which parts of a page people use.",
    "    </span>",
    "  </label>",
    '  <div class="cookie-banner-actions">',
    '    <button type="button" class="cookie-btn cookie-btn-accept" data-cookie="save">Save choice</button>',
    "  </div>",
    "</div>",
  ].join("\n");

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && typeof raw.analytics === "boolean") return raw;
    } catch (e) {
      /* unreadable or blocked storage: treat as no choice yet */
    }
    return null;
  }

  function write(choice, analytics) {
    const record = {
      essential: true,
      analytics: analytics,
      choice: choice,
      ts: Date.now(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(record));
      OLD_KEYS.forEach(function (k) {
        localStorage.removeItem(k);
      });
    } catch (e) {
      /* storage blocked: the choice still applies for this page view */
    }
    return record;
  }

  // Public read-only view, available before and after a choice is made.
  window.ccConsent = {
    get: function () {
      return read();
    },
    allowsAnalytics: function () {
      const c = read();
      return !!(c && c.analytics);
    },
    EVENT: EVENT,
  };

  function start() {
    let banner = document.getElementById("cookie-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "cookie-banner";
      banner.className = "cookie-banner";
      banner.hidden = true;
      document.body.appendChild(banner);
    }
    banner.innerHTML = BANNER_HTML;

    let tag = document.getElementById("cookie-tag");
    if (!tag) {
      tag = document.createElement("button");
      tag.type = "button";
      tag.id = "cookie-tag";
      tag.className = "cookie-tag";
      tag.textContent = "Manage consent";
      tag.hidden = true;
      document.body.appendChild(tag);
    }

    const managePanel = banner.querySelector("#cookie-manage");
    const analyticsBox = banner.querySelector("#cookie-analytics");
    const openBtn = document.getElementById("cookie-open");

    function hideBanner() {
      banner.hidden = true;
      document.body.classList.remove("cookie-open");
      tag.hidden = false;
    }

    function showBanner(showManage) {
      const current = read();
      analyticsBox.checked = !!(current && current.analytics);
      managePanel.hidden = !showManage;
      banner.hidden = false;
      tag.hidden = true;
      document.body.classList.add("cookie-open");
    }

    function decide(choice, analytics) {
      const record = write(choice, analytics);
      hideBanner();
      document.dispatchEvent(new CustomEvent(EVENT, { detail: record }));
    }

    banner.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-cookie]");
      if (!btn) return;
      const action = btn.getAttribute("data-cookie");
      if (action === "accept") decide("accept", true);
      else if (action === "reject") decide("reject", false);
      else if (action === "save") decide("custom", analyticsBox.checked);
      else if (action === "manage") managePanel.hidden = false;
    });

    function reopen() {
      showBanner(true);
    }

    if (openBtn) openBtn.addEventListener("click", reopen);

    tag.addEventListener("click", reopen);
    tag.addEventListener("mouseenter", function () {
      document.body.classList.add("cursor-on-chat");
    });
    tag.addEventListener("mouseleave", function () {
      if (banner.hidden) document.body.classList.remove("cursor-on-chat");
    });

    const existing = read();
    if (!existing) {
      showBanner(false);
    } else {
      tag.hidden = false;
      document.dispatchEvent(new CustomEvent(EVENT, { detail: existing }));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
