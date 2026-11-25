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

  // The choice is shared with app.babyrock.ai through a first-party cookie on .babyrock.ai (br_consent=state|v1|unix time),
  // so the app's Consent Mode reads the same answer. localStorage keeps the site's own copy.
  function writeCookie(state) {
    try {
      var host = location.hostname, domain = /(^|\.)babyrock\.ai$/.test(host) ? "; Domain=.babyrock.ai" : "";
      document.cookie = "br_consent=" + state + "|v1|" + Math.floor(Date.now() / 1000) + domain + "; Path=/; Max-Age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    } catch (e) {}
  }
  function readCookie() {
    var m = /(?:^|; )br_consent=(granted|denied)/.exec(document.cookie || "");
    return m ? m[1] : null;
  }
  function rememberChoice(state) {
    try {
      localStorage.setItem(CONSENT_KEY, state);
    } catch (e) {}
    writeCookie(state);
  }

  function clearAnalyticsCookies() {
    var cookies = document.cookie ? document.cookie.split(";") : [];
    cookies.forEach(function (part) {
      var name = part.split("=")[0].trim();
      if (!/^(_ga(?:_[A-Za-z0-9]+)?|_gid|_gat(?:_[A-Za-z0-9]+)?)$/.test(name)) return;
      var past = "=; Max-Age=0; path=/; SameSite=Lax";
      document.cookie = name + past;
      // GA sets its cookies on the registrable domain, so expire them there too.
      var host = location.hostname.split(".");
      for (var i = 0; i <= host.length - 2; i++) {
        document.cookie = name + past + "; domain=." + host.slice(i).join(".");
      }
    });
  }

  function updateConsent(state) {
    // Global Privacy Control always wins: all four signals stay denied, even after an earlier Accept.
    if (navigator.globalPrivacyControl) state = "denied";
    if (state === "denied") clearAnalyticsCookies();
    if (typeof window.gtag !== "function") return;
    try {
      // Accept grants all four signals, Refuse denies all four (Ben, 17 Nov 2026 consent rule).
      window.gtag("consent", "update", {
        analytics_storage: state,
        ad_storage: state,
        ad_user_data: state,
        ad_personalization: state
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
  // Keep the shared cookie in step: an answer given before the cookie existed is copied over; an answer given on the app is used here.
  if (stored === "granted" || stored === "denied") { if (readCookie() !== stored) writeCookie(stored); }
  else { stored = readCookie(); if (stored) { try { localStorage.setItem(CONSENT_KEY, stored); } catch (e) {} } }
  if (navigator.globalPrivacyControl && stored === "granted") updateConsent("denied");
  if (stored === "denied") clearAnalyticsCookies();
  banner.hidden = stored === "granted" || stored === "denied";
})();
