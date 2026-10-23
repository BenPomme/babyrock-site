(function () {
  "use strict";

  var CONSENT_KEY = "br-consent";

  function hasAnalyticsConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY) === "granted";
    } catch (e) {
      return false;
    }
  }

  function track(name, detail) {
    if (!hasAnalyticsConsent() || typeof window.gtag !== "function") return;
    try {
      window.gtag("event", name, detail || {});
    } catch (e) {}
  }

  function videoDetail(video) {
    return {
      demo_id: video.getAttribute("data-demo-id") || "",
      demo_language: video.getAttribute("data-demo-language") || "",
      placement: video.getAttribute("data-demo-placement") || ""
    };
  }

  document.addEventListener(
    "play",
    function (event) {
      var video = event.target;
      if (!video || video.tagName !== "VIDEO") return;
      document.querySelectorAll("video").forEach(function (other) {
        if (other !== video && !other.paused) other.pause();
      });
      track("demo_play", videoDetail(video));
    },
    true
  );

  document.addEventListener(
    "ended",
    function (event) {
      var video = event.target;
      if (!video || video.tagName !== "VIDEO") return;
      track("demo_complete", videoDetail(video));
    },
    true
  );

  function selectHomeDemo(choice) {
    var section = choice.closest("[data-br-home-library]");
    if (!section) return false;
    var video = section.querySelector("[data-br-home-video]");
    var source = video && video.querySelector("source");
    var title = section.querySelector("[data-br-home-title]");
    var description = section.querySelector("[data-br-home-description]");
    var duration = section.querySelector("[data-br-home-duration]");
    var watch = section.querySelector("[data-br-home-watch]");
    var cta = section.querySelector("[data-br-home-cta]");
    var track = section.querySelector("[data-br-home-track]");
    if (!video || !source || !choice.dataset.brFile || !choice.dataset.brPoster) return false;

    video.pause();
    source.setAttribute("src", choice.dataset.brFile);
    video.setAttribute("poster", choice.dataset.brPoster);
    video.setAttribute("data-demo-id", choice.dataset.brDemoId || "");
    video.setAttribute("aria-label", choice.dataset.brTitle || "");
    if (track) {
      if (choice.dataset.brCaptionSrc) {
        track.setAttribute("src", choice.dataset.brCaptionSrc);
        track.disabled = false;
      } else {
        track.removeAttribute("src");
        track.disabled = true;
      }
    }
    video.load();

    if (title) title.textContent = choice.dataset.brTitle || choice.textContent.trim();
    if (description && choice.dataset.brDescription) description.textContent = choice.dataset.brDescription;
    if (duration && choice.dataset.brDuration) duration.textContent = choice.dataset.brDuration;
    if (watch && choice.dataset.brHref) watch.setAttribute("href", choice.dataset.brHref);
    if (cta && choice.dataset.brDemoId) {
      cta.setAttribute("data-demo-id", choice.dataset.brDemoId);
      if (choice.dataset.brCtaHref) cta.setAttribute("href", choice.dataset.brCtaHref);
    }

    section.querySelectorAll("[data-br-home-choice]").forEach(function (item) {
      item.setAttribute("aria-current", item === choice ? "true" : "false");
    });
    choice.focus({ preventScroll: true });
    return true;
  }

  document.addEventListener("click", function (event) {
    var choice = event.target.closest && event.target.closest("[data-br-home-choice]");
    if (choice) {
      if (selectHomeDemo(choice)) event.preventDefault();
      return;
    }

    var cta = event.target.closest && event.target.closest("[data-signup-cta]");
    if (!cta) return;
    track("demo_cta_click", {
      demo_id: cta.getAttribute("data-demo-id") || "",
      demo_language: cta.getAttribute("data-demo-language") || "",
      placement: cta.getAttribute("data-demo-placement") || "",
      signup_mode: cta.getAttribute("data-signup-mode") || "waitlist"
    });
  });

  var banner = document.querySelector("[data-br-consent-banner]");
  if (banner) {
    var choice = null;
    try {
      choice = localStorage.getItem(CONSENT_KEY);
    } catch (e) {}
    if (!choice) banner.hidden = false;

    function setConsent(granted) {
      var state = granted ? "granted" : "denied";
      try {
        localStorage.setItem(CONSENT_KEY, state);
      } catch (e) {}
      if (typeof window.gtag === "function") {
        window.gtag("consent", "update", {
          analytics_storage: state,
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied"
        });
      }
      banner.hidden = true;
    }

    var accept = banner.querySelector("[data-cookie-accept]");
    var refuse = banner.querySelector("[data-cookie-refuse]");
    if (accept) accept.addEventListener("click", function () { setConsent(true); });
    if (refuse) refuse.addEventListener("click", function () { setConsent(false); });
  }
})();
