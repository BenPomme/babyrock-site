(function () {
  "use strict";

  var CONSENT_KEY = "br-consent";
  var banner = document.querySelector("[data-br-ga-consent-banner]");
  if (!banner) return;

  var accept = banner.querySelector("[data-br-ga-consent-accept]");
  var refuse = banner.querySelector("[data-br-ga-consent-refuse]");

  function readChoice() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }

  function rememberChoice(state) {
    try {
      localStorage.setItem(CONSENT_KEY, state);
    } catch (e) {}
  }

  function clearAnalyticsCookies() {
    var cookies = document.cookie ? document.cookie.split(";") : [];
    cookies.forEach(function (part) {
      var name = part.split("=")[0].trim();
      if (!/^(_ga(?:_[A-Za-z0-9]+)?|_gid|_gat(?:_[A-Za-z0-9]+)?)$/.test(name)) return;
      document.cookie = name + "=; Max-Age=0; path=/; SameSite=Lax";
    });
  }

  function updateConsent(state) {
    if (state === "denied") clearAnalyticsCookies();
    if (typeof window.gtag !== "function") return;
    try {
      window.gtag("consent", "update", {
        analytics_storage: state,
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      });
    } catch (e) {}
  }

  function choose(granted) {
    var state = granted ? "granted" : "denied";
    rememberChoice(state);
    updateConsent(state);
    banner.hidden = true;
  }

  if (accept) accept.addEventListener("click", function () { choose(true); });
  if (refuse) refuse.addEventListener("click", function () { choose(false); });

  document.querySelectorAll("[data-br-ga-consent-open]").forEach(function (control) {
    control.addEventListener("click", function (event) {
      event.preventDefault();
      banner.hidden = false;
    });
  });

  window.addEventListener("storage", function (event) {
    if (event.key !== CONSENT_KEY) return;
    if (event.newValue === "granted") updateConsent("granted");
    if (event.newValue === "denied") updateConsent("denied");
    banner.hidden = event.newValue === "granted" || event.newValue === "denied";
  });

  var stored = readChoice();
  if (stored === "denied") clearAnalyticsCookies();
  banner.hidden = stored === "granted" || stored === "denied";
})();
