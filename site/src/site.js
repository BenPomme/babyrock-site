(function () {
  const cfg = window.BR_CONFIG || {};
  const copy = window.BR_COPY || {};
  const IMPACT = cfg.impact || {};

  const menuBtn = document.querySelector("[data-menu]");
  const mobileNav = document.querySelector("[data-mobile-nav]");
  if (menuBtn && mobileNav) {
    menuBtn.addEventListener("click", function () {
      const open = mobileNav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  const CONSENT_KEY = "br-consent";
  const banner = document.querySelector("[data-cookie-banner]");
  function setConsent(granted) {
    const state = granted ? "granted" : "denied";
    try {
      localStorage.setItem(CONSENT_KEY, state);
    } catch (e) {}
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: state,
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    }
  }
  let choice = null;
  try {
    choice = localStorage.getItem(CONSENT_KEY);
  } catch (e) {}
  if (choice === "granted") setConsent(true);
  else if (choice === "denied") setConsent(false);
  if (banner) {
    if (!choice) banner.hidden = false;
    function closeBanner(granted) {
      setConsent(granted);
      banner.hidden = true;
    }
    const accept = banner.querySelector("[data-cookie-accept]");
    const refuse = banner.querySelector("[data-cookie-refuse]");
    if (accept) accept.addEventListener("click", function () { closeBanner(true); });
    if (refuse) refuse.addEventListener("click", function () { closeBanner(false); });
  }
  document.querySelectorAll("[data-cookie-open]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      if (banner) banner.hidden = false;
    });
  });

  function money(n) {
    if (!isFinite(n)) return "-";
    const abs = Math.abs(n);
    const formatted = new Intl.NumberFormat(document.documentElement.lang || "es", {
      maximumFractionDigits: 0,
    }).format(Math.round(abs));
    return (n < 0 ? "−" : "") + formatted + " €";
  }

  function formatPct(x) {
    const p = Math.round(x * 1000) / 10;
    const s = Number.isInteger(p) ? String(p) : p.toFixed(1);
    return s + "%";
  }

  function parseRevenue(raw) {
    const n = Number(String(raw || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function picked(form, name, fallback) {
    const checked = form.querySelector("[name='" + name + "']:checked");
    if (checked) return checked.value;
    const el = form.querySelector("[name='" + name + "']");
    if (el && el.value) return el.value;
    return fallback;
  }

  function ratesFor(kind, product) {
    const socialMap = IMPACT.social || {};
    const directMap = IMPACT.direct || {};
    const k = socialMap[kind] ? kind : "restaurant";
    const social = socialMap[k] || [0.07, 0.09];
    const direct = directMap[k] || [0.04, 0.1];
    const o = IMPACT.overlap == null ? 0.85 : IMPACT.overlap;
    if (product === "direct") return { low: direct[0], high: direct[1] };
    if (product === "both") return { low: social[0] + o * direct[0], high: social[1] + o * direct[1] };
    return { low: social[0], high: social[1] };
  }

  function compute(revenue, kind, product) {
    const monthly = parseRevenue(revenue);
    const yearly = monthly * 12;
    const rates = ratesFor(kind, product);
    return {
      monthly: monthly,
      yearly: yearly,
      lowPct: rates.low,
      highPct: rates.high,
      lowEur: yearly * rates.low,
      highEur: yearly * rates.high,
    };
  }

  function fillSim(form, result) {
    const set = function (sel, val) {
      form.querySelectorAll(sel).forEach(function (n) {
        n.textContent = val;
      });
    };
    if (!result.monthly) {
      set("[data-sim-low]", "-");
      set("[data-sim-high]", "-");
      set("[data-sim-low-pct]", "");
      set("[data-sim-high-pct]", "");
      return;
    }
    set("[data-sim-low]", money(result.lowEur));
    set("[data-sim-high]", money(result.highEur));
    set("[data-sim-low-pct]", formatPct(result.lowPct));
    set("[data-sim-high-pct]", formatPct(result.highPct));
  }

  function bindSim(form) {
    const run = function () {
      const revenueEl = form.querySelector("[name=revenue]");
      const revenue = revenueEl ? revenueEl.value : "";
      const kind = picked(form, "kind", "restaurant");
      const product = picked(form, "product", "social");
      fillSim(form, compute(revenue, kind, product));
      try {
        sessionStorage.setItem("br-revenue", String(revenue || ""));
        sessionStorage.setItem("br-kind", kind);
        sessionStorage.setItem("br-product", product);
      } catch (e) {}
    };
    form.addEventListener("input", run);
    form.addEventListener("change", run);
    try {
      const savedRev = sessionStorage.getItem("br-revenue");
      const rev = form.querySelector("[name=revenue]");
      if (savedRev && rev && (rev.value === "" || rev.value === rev.getAttribute("placeholder"))) {
        rev.value = savedRev;
      }
      const savedKind = sessionStorage.getItem("br-kind");
      if (savedKind) {
        const radio = form.querySelector("[name=kind][value='" + savedKind + "']");
        const select = form.querySelector("select[name=kind]");
        if (radio) radio.checked = true;
        else if (select) select.value = savedKind;
      }
      const savedProduct = sessionStorage.getItem("br-product");
      if (savedProduct) {
        const radio = form.querySelector("[name=product][value='" + savedProduct + "']");
        if (radio) radio.checked = true;
      }
    } catch (e) {}
    run();
  }

  document.querySelectorAll("[data-sim]").forEach(bindSim);

  function track(name) {
    if (typeof window.gtag === "function") window.gtag("event", name);
  }
  document.querySelectorAll(".btn-wa, .wa-fab").forEach(function (a) {
    a.addEventListener("click", function () {
      track("whatsapp_click");
    });
  });
  document.querySelectorAll("[data-pay-cta]").forEach(function (a) {
    a.addEventListener("click", function () {
      track("pay_click");
    });
  });

  document.querySelectorAll(".step-grid details").forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (!d.open) return;
      const grid = d.closest(".step-grid");
      if (!grid) return;
      grid.querySelectorAll("details[open]").forEach(function (other) {
        if (other !== d) other.open = false;
      });
    });
  });

  document.querySelectorAll("[data-interest-form]").forEach(function (form) {
    // The pay flow is the only place where a contract is signed; this site only links to it.
    // Same query contract as the factory's own pay links (plan, city, wa, maps) — no name or
    // e-mail in the URL, the pay page collects those itself.
    function payTarget(data) {
      const base = form.getAttribute("data-pay") || cfg.payUrl || "";
      if (!base) return "";
      let url;
      try {
        url = new URL(base, location.href);
      } catch (err) {
        return base;
      }
      const field = function (name) {
        return String(data.get(name) || "").trim();
      };
      if (field("plan")) url.searchParams.set("plan", field("plan"));
      if (field("city")) url.searchParams.set("city", field("city"));
      if (/^https?:\/\//i.test(field("listing"))) url.searchParams.set("maps", field("listing"));
      const digits = field("whatsapp").replace(/\D/g, "");
      if (digits) url.searchParams.set("wa", digits);
      return url.toString();
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const data = new FormData(form);
      const lines = [];
      // The message Rosalia receives is written in the language of the page, using the label the
      // visitor just read, never the raw field name.
      const labels = {};
      form.querySelectorAll("[data-label]").forEach(function (el) {
        labels[el.name] = el.getAttribute("data-label");
      });
      data.forEach(function (v, k) {
        if (k === "channel") return;
        if (!String(v).trim()) return;
        lines.push((labels[k] || k) + ": " + String(v).trim());
      });
      const body = lines.join("\n");
      const wa = form.getAttribute("data-wa");
      const mail = form.getAttribute("data-mail");
      const action = e.submitter ? e.submitter.value : "pay";
      const pay = action === "pay" ? payTarget(data) : "";
      if (pay) {
        track("pay_click");
        location.href = pay;
      } else if (action === "email") {
        location.href =
          "mailto:" +
          mail +
          "?subject=" +
          encodeURIComponent("BabyRock Social") +
          "&body=" +
          encodeURIComponent(body);
      } else if (wa) {
        track("whatsapp_click");
        location.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent(body);
      } else {
        location.href =
          "mailto:" +
          mail +
          "?subject=" +
          encodeURIComponent("BabyRock Social") +
          "&body=" +
          encodeURIComponent(body);
      }
    });
  });

  // Remember the language a visitor picked, so the root gate sends them back to it next time.
  document.querySelectorAll("[data-lang]").forEach(function (link) {
    link.addEventListener("click", function () {
      try {
        localStorage.setItem("brmsocial.lang", link.getAttribute("data-lang"));
      } catch (e) {
        /* private mode: the browser language decides */
      }
    });
  });

  // In-page links scroll on the click itself, so a fragment jump cannot be lost to a late layout
  // shift, and the heading lands below the sticky header.
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      var id = link.getAttribute("href").slice(1);
      var target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", "#" + id);
    });
  });
})();
