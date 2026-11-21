/* BabyRock first-party visit counter (contract: qa-audit/MINI-MEASUREMENT-API-CONTRACT-20261118.md).
   Independent of the Meta pixel and of cookie consent for Mexico and US pages. No cookies, no sendBeacon.
   Runs only on https://www.babyrock.ai and https://babyrock-site.pages.dev. All errors are swallowed. */
(function () {
  'use strict';
  try {
    var ENDPOINT = 'https://app.babyrock.ai/api/e';
    if (['https://www.babyrock.ai', 'https://babyrock-site.pages.dev'].indexOf(location.origin) < 0) return;

    var MARKETS = { mx: 'MX', us: 'US', za: 'ZA', 'in': 'IN', es: 'ES', fr: 'FR' };
    var COUNTRY = { mx: 'MX', us: 'US', za: 'ZA', 'in': 'IN' };
    var FIRST_PARTY = { mx: 1, us: 1 };            // vid is persistent here regardless of cookie consent
    var PRICES = { MX: { a: 'MXN99', b: 'MXN179' }, ZA: { a: 'ZAR179', b: 'ZAR99' } };
    var UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'];

    function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
    function rnd() {
      var a = new Uint8Array(12);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
      else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      var s = ''; for (i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
      return s;
    }
    function clean(v, n) { v = String(v == null ? '' : v).replace(/[^\w.\-~:+@ ]/g, '').slice(0, n || 100); return v; }

    var path = location.pathname;
    var seg = path.split('/').filter(Boolean);
    var first = seg[0] ? seg[0].toLowerCase() : '';
    var prefix = Object.prototype.hasOwnProperty.call(MARKETS, first) ? first : '';
    var market = prefix ? MARKETS[prefix] : '';
    var country = prefix && COUNTRY[prefix] || '';
    var params = new URLSearchParams(location.search);

    // Variant: data-br-variant on <html> or <body> wins; else home_es / mx_gratis style from the path.
    var variant = safe(function () {
      var d = document.documentElement.getAttribute('data-br-variant') || (document.body && document.body.getAttribute('data-br-variant'));
      if (d) return clean(d, 60);
      var parts = seg.slice();
      if (!parts.length) return 'home_en';
      if (parts.length === 1 && prefix) return 'home_' + prefix;
      return parts.join('_').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60);
    }, '');

    // Identity: sid new on every load; vid persistent on MX/US pages, elsewhere only with consent and no GPC.
    var sid = 's_' + rnd();
    var gpc = safe(function () { return navigator.globalPrivacyControl === true; }, false);
    var persistent = !!FIRST_PARTY[prefix] || (safe(function () { return localStorage.getItem('br-consent') === 'granted'; }, false) && !gpc);
    var vid = null;
    if (persistent) vid = safe(function () {
      var v = localStorage.getItem('br-vid');
      if (!/^v_[a-f0-9]{24}$/.test(v || '')) { v = 'v_' + rnd(); localStorage.setItem('br-vid', v); }
      return v;
    }, null);
    var vidPersisted = !!vid;
    if (!vid) vid = 'v_' + rnd();                  // page-lifetime only, never stored

    // UTM first touch for the browser session.
    var utm = {};
    safe(function () {
      var fromUrl = {}, any = false;
      UTM_KEYS.forEach(function (k) { var v = params.get('utm_' + k); if (v) { fromUrl[k] = clean(v, 100); any = true; } });
      if (any) { try { sessionStorage.setItem('br-utm', JSON.stringify(fromUrl)); } catch (e) {} utm = fromUrl; return; }
      var s = JSON.parse(sessionStorage.getItem('br-utm') || '{}');
      UTM_KEYS.forEach(function (k) { if (s && typeof s[k] === 'string' && s[k]) utm[k] = clean(s[k], 100); });
    });

    var pv = /^[ab]$/.test(params.get('pv') || '') ? params.get('pv') : '';
    var tv = /^[nc]$/.test(params.get('tv') || '') ? params.get('tv') : '';
    var device = window.innerWidth < 768 ? 'phone' : window.innerWidth < 1100 ? 'tablet' : 'desktop';
    var refHost = safe(function () { return document.referrer ? new URL(document.referrer).hostname.slice(0, 100) : ''; }, '');

    function base() {
      var p = { v: 1, vid: vid, sid: sid, page: path.slice(0, 200), variant: variant };
      if (market) p.market_page = market;
      if (country) p.country = country;
      if (pv && PRICES[country] && PRICES[country][pv]) p.price_shown = PRICES[country][pv];
      if (pv) p.pv = pv;
      if (tv) p.tv = tv;
      var u = {}, n = 0; UTM_KEYS.forEach(function (k) { if (utm[k]) { u[k] = utm[k]; n++; } });
      if (n) p.utm = u;
      if (refHost) p.ref_host = refHost;
      p.device = device;
      return p;
    }

    var sent = 0;
    function send(events) {
      if (!events.length || sent + events.length > 40) return;
      sent += events.length;
      var p = base(); p.events = events.slice(0, 10);
      var body = JSON.stringify(p);
      if (body.length > 3800) { delete p.ref_host; body = JSON.stringify(p); }
      if (body.length > 4000) return;
      try {
        fetch(ENDPOINT, { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' }, body: body }).catch(function () {});
      } catch (e) {}
    }

    // Links to the app carry the campaign tags, vid (only when a persistent vid is allowed) and the price/trial arm.
    function decorate(a) {
      safe(function () {
        var u = new URL(a.getAttribute('href'), location.href);
        if (u.hostname !== 'app.babyrock.ai') return;
        var changed = false;
        function put(k, v) { if (v && !u.searchParams.has(k)) { u.searchParams.set(k, v); changed = true; } }
        UTM_KEYS.forEach(function (k) { put('utm_' + k, utm[k]); });
        if (vidPersisted) put('vid', vid);
        put('pv', pv); put('tv', tv);
        if (changed) a.href = u.toString();
      });
    }
    function appLinks() { return document.querySelectorAll('a[href*="app.babyrock.ai"]'); }
    function decorateAll() { Array.prototype.forEach.call(appLinks(), decorate); }

    function ctaOf(a) {
      var pos = a.getAttribute('data-cta') || a.getAttribute('data-br-pos');
      if (!pos) pos = a.closest && a.closest('header') ? 'bar' : a.closest && a.closest('footer') ? 'footer' : 'page';
      var target = a.getAttribute('data-br-target');
      if (!target) safe(function () {
        var u = new URL(a.href);
        target = u.pathname.indexOf('/mini/signup') === 0 ? (u.searchParams.get('plan') === 'free' ? 'free' : 'trial') : 'app';
      });
      return { pos: clean(pos, 24) || 'page', target: clean(target, 24) || 'app' };
    }

    document.addEventListener('click', function (ev) {
      safe(function () {
        var a = ev.target && ev.target.closest && ev.target.closest('a[href]');
        if (!a || !/app\.babyrock\.ai/.test(a.href)) return;
        decorate(a);
        if (new URL(a.href).hostname !== 'app.babyrock.ai') return;
        send([{ e: 'cta_click', t: Date.now(), p: ctaOf(a) }]);
      });
    }, true);

    decorateAll();
    send([{ e: 'page_view', t: Date.now(), p: {} }]);
  } catch (e) {}
})();
