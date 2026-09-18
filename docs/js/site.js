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

  // The level cards are the choice, so the pay button has to carry it. Without this the visitor
  // picked Lite, landed on the pay page, and found Plus selected.
  document.querySelectorAll("[data-plan-choices]").forEach(function (fieldset) {
    const cta = document.querySelector("[data-pay-cta]");
    if (!cta) return;
    const base = cta.getAttribute("data-pay-base") || cta.getAttribute("href") || "";
    // Arriving from a card that already said which level, so honour it before anything is clicked.
    const asked = new URLSearchParams(location.search).get("plan");
    if (asked) {
      const radio = fieldset.querySelector("input[name=plan][value='" + asked.replace(/['\\]/g, "") + "']");
      if (radio) {
        radio.checked = true;
      } else {
        // The link names a plan (lite_month), the cards name a level (lite): take the level.
        const level = asked.replace(/_(month|year)$/, "");
        const byLevel = fieldset.querySelector("input[name=plan][value='" + level.replace(/['\\]/g, "") + "']");
        if (byLevel) byLevel.checked = true;
      }
    }
    function selected() {
      const picked = fieldset.querySelector("input[name=plan]:checked");
      return picked ? picked.value : "";
    }
    function sync() {
      const plan = selected();
      if (!base || !plan) return;
      try {
        const url = new URL(base, location.href);
        // The pay flow wants a level AND an interval.
        url.searchParams.set("plan", /_(month|year)$/.test(plan) ? plan : plan + "_month");
        cta.setAttribute("href", url.toString());
      } catch (err) {
        /* keep the fallback link */
      }
    }
    fieldset.addEventListener("change", sync);
    sync();
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
    const errorEl = form.querySelector("[data-form-error]");
    const sentEl = form.querySelector("[data-form-sent]");
    const fallbackEl = form.querySelector("[data-form-fallback]");
    const api = (form.getAttribute("data-api") || cfg.apiUrl || "").replace(/\/$/, "");
    const message = function (key, fallback) {
      return form.getAttribute("data-msg-" + key) || fallback;
    };
    function showError(key, fallback) {
      if (!errorEl) return;
      errorEl.textContent = message(key, fallback);
      errorEl.hidden = false;
    }
    function clearError() {
      if (!errorEl) return;
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
    function value(data, name) {
      return String(data.get(name) || "").trim();
    }
    function selectedPlan() {
      const checked = document.querySelector("[data-plan-choices] input[name=plan]:checked");
      return checked ? checked.value : "";
    }
    function labels(form) {
      const map = {};
      form.querySelectorAll("[data-label]").forEach(function (el) {
        map[el.name] = el.getAttribute("data-label");
      });
      return map;
    }
    function messageBody(data) {
      const lines = [];
      const map = labels(form);
      data.forEach(function (v, k) {
        if (k === "channel") return;
        if (!String(v).trim()) return;
        lines.push((map[k] || k) + ": " + String(v).trim());
      });
      return lines.join("\n");
    }

    // The pay flow is the only place where a contract is signed; this site only links to it. The
    // pay page prefills from the same query contract the factory uses (plan, city, wa, maps,
    // email, name).
    function payTarget(data) {
      const base = form.getAttribute("data-pay") || cfg.payUrl || "";
      if (!base) return "";
      let url;
      try {
        url = new URL(base, location.href);
      } catch (err) {
        return base;
      }
      const plan = selectedPlan();
      // The pay page wants a level AND an interval, like the card links above.
      if (plan) url.searchParams.set("plan", /_(month|year)$/.test(plan) ? plan : plan + "_month");
      if (value(data, "city")) url.searchParams.set("city", value(data, "city"));
      if (/^https?:\/\//i.test(value(data, "listing"))) url.searchParams.set("maps", value(data, "listing"));
      if (value(data, "email")) url.searchParams.set("email", value(data, "email"));
      if (value(data, "business")) url.searchParams.set("name", value(data, "business"));
      const digits = value(data, "whatsapp").replace(/\D/g, "");
      if (digits) url.searchParams.set("wa", digits);
      return url.toString();
    }

    function fallbackMailto(body) {
      return (
        "mailto:" +
        (form.getAttribute("data-mail") || "") +
        "?subject=" +
        encodeURIComponent("BabyRock Social") +
        "&body=" +
        encodeURIComponent(body)
      );
    }

    // The Email button posts to the factory: no mail client needed, and the lead exists even if
    // the visitor never opens an inbox.
    function postToFactory(data, email, body) {
      const buttons = form.querySelectorAll("button[type=submit]");
      const emailButton = form.querySelector("button[value=email]");
      const original = emailButton ? emailButton.textContent : "";
      buttons.forEach(function (b) {
        b.disabled = true;
      });
      if (emailButton) emailButton.textContent = message("sending", "…");
      fetch(api + "/api/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business: value(data, "business"),
          city: value(data, "city"),
          listing: value(data, "listing"),
          email: email,
          whatsapp: value(data, "whatsapp"),
          question: value(data, "question"),
          revenue: value(data, "revenue"),
          plan: selectedPlan(),
          lang: document.documentElement.lang || "",
        }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("http " + res.status);
          return res.json();
        })
        .then(function () {
          if (sentEl) {
            sentEl.textContent = message("sent", "Message received.");
            sentEl.hidden = false;
          }
          form.querySelectorAll("input, textarea, button").forEach(function (n) {
            n.disabled = true;
          });
        })
        .catch(function () {
          buttons.forEach(function (b) {
            b.disabled = false;
          });
          if (emailButton) emailButton.textContent = original;
          showError("error", "Something went wrong.");
          if (fallbackEl) {
            fallbackEl.setAttribute("href", fallbackMailto(body));
            fallbackEl.hidden = false;
          }
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError();
      const data = new FormData(form);
      const body = messageBody(data);
      const wa = form.getAttribute("data-wa");
      const email = value(data, "email");
      const waDigits = value(data, "whatsapp").replace(/\D/g, "");
      const action = e.submitter ? e.submitter.value : "pay";
      if (!email && waDigits.length < 9) {
        showError("need-contact", "Add an email or a WhatsApp number so we can answer.");
        const first = form.querySelector("input[name=email]");
        if (first) first.focus();
        return;
      }
      const pay = action === "pay" ? payTarget(data) : "";
      if (pay) {
        track("pay_click");
        location.href = pay;
      } else if (action === "email") {
        if (!email) {
          showError("need-email", "Add your email, or use Start on WhatsApp.");
          const field = form.querySelector("input[name=email]");
          if (field) field.focus();
          return;
        }
        postToFactory(data, email, body);
      } else if (wa) {
        track("whatsapp_click");
        location.href = "https://wa.me/" + String(wa).replace(/\D/g, "") + "?text=" + encodeURIComponent(body);
      } else {
        location.href = fallbackMailto(body);
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
