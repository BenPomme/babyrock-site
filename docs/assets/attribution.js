/*
 * attribution.js (DRAFT, pending Ben exact approval)
 *
 * Not loaded by the site and not an analytics change.
 *
 * Copies allowlisted incoming UTM values onto same-site start-free and signup
 * links. Destination path, existing query, and hash are preserved. Only these
 * keys can be forwarded:
 *   utm_source, utm_medium, utm_campaign, utm_content, utm_term
 *
 * The helper makes no network request and writes no cookie, localStorage, or
 * sessionStorage entry. Consent-dependent analytics remains a separate decision.
 */
(function () {
  "use strict";

  var ALLOWED = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term"
  ];
  var MAX_LEN = 80;
  var SAFE_VALUE = /^[A-Za-z0-9._~-]{1,80}$/;
  var TARGET_SEGMENTS = { "start-free": true, "signup": true };

  function readIncoming() {
    var incoming = {};
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (error) {
      return incoming;
    }

    ALLOWED.forEach(function (key) {
      var value = params.get(key);
      if (!value || value.length > MAX_LEN) return;
      if (!SAFE_VALUE.test(value)) return;
      if (/^[0-9]{7,}$/.test(value)) return;
      incoming[key] = value;
    });
    return incoming;
  }

  function isEligibleDestination(url) {
    if (url.origin !== window.location.origin) return false;
    var segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) return false;
    return TARGET_SEGMENTS[segments[segments.length - 1]] === true;
  }

  function decorate(anchor, incoming) {
    var keys = Object.keys(incoming);
    if (!keys.length) return;

    var url;
    try {
      url = new URL(anchor.href, window.location.origin);
    } catch (error) {
      return;
    }
    if (!isEligibleDestination(url)) return;

    keys.forEach(function (key) {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, incoming[key]);
      }
    });
    anchor.href = url.pathname + url.search + url.hash;
  }

  function run() {
    var incoming = readIncoming();
    if (!Object.keys(incoming).length) return;
    var anchors = document.querySelectorAll("a[href]");
    Array.prototype.forEach.call(anchors, function (anchor) {
      decorate(anchor, incoming);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
