#!/usr/bin/env node
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  existsSync,
  unlinkSync,
  copyFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogue } from "./lib/catalogue.mjs";
import { houseLineFor, loadHouseLines } from "./lib/house-lines.mjs";
import {
  checkPriceLines,
  checkSiteGrid,
  fillPrices,
  formatEuro,
  stripPriceTokens,
  typesAnAmount,
} from "./lib/prices.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");
const contentDir = join(root, "content");
const GUIDES = JSON.parse(readFileSync(join(contentDir, "guides.json"), "utf8")).guides;
const srcDir = join(root, "src");
const assetDir = join(root, "assets");
const outDir = join(root, "..", "docs");

/**
 * The site never holds a price of its own. The catalogue is read here, checked against the content
 * file before anything is written, and asked for every amount a page publishes.
 */
const catalogue = loadCatalogue(repoRoot);

/** The lines the product itself publishes in a quiet week (ticket 25). */
const HOUSE_LINES = loadHouseLines(repoRoot);

/** The locale the root serves and `x-default` points at (`17-seo-site-brm.md`). */
const DEFAULT_LOCALE = "es";

const LOCALES = {
  es: {
    name: "ES",
    html: "es",
    /** The country grid the pages of this language quote. Both grids are read from the catalogue. */
    country: "ES",
    slugs: {
      home: "",
      simulator: "simulador",
      how: "como-funciona",
      research: "investigacion",
      about: "nosotros",
      services: "servicios",
      audit: "auditoria",
      guides: "guias",
      subscribe: "suscribirse",
      account: "cuenta",
      privacy: "privacidad",
      terms: "condiciones",
      legal: "aviso-legal",
      cookies: "cookies",
      dpa: "encargo",
    },
  },
  ca: {
    name: "CA",
    html: "ca",
    country: "ES",
    slugs: {
      home: "",
      simulator: "simulador",
      how: "com-funciona",
      research: "recerca",
      about: "nosaltres",
      services: "serveis",
      audit: "auditoria",
      guides: "guies",
      subscribe: "subscriure",
      account: "compte",
      privacy: "privadesa",
      terms: "condicions",
      legal: "avis-legal",
      cookies: "galetes",
      dpa: "encarrec",
    },
  },
  fr: {
    name: "FR",
    html: "fr",
    country: "FR",
    slugs: {
      home: "",
      simulator: "simulateur",
      how: "comment-ca-marche",
      research: "recherche",
      about: "a-propos",
      services: "services",
      audit: "audit",
      guides: "guides",
      subscribe: "s-abonner",
      account: "compte",
      privacy: "confidentialite",
      terms: "conditions",
      legal: "mentions-legales",
      cookies: "cookies",
      dpa: "accord-traitement",
    },
  },
  en: {
    name: "EN",
    html: "en",
    /** English is the cross-border page, so it quotes the same default country the app does. */
    country: "ES",
    slugs: {
      home: "",
      simulator: "simulator",
      how: "how-it-works",
      research: "research",
      about: "about",
      services: "services",
      audit: "audit",
      guides: "guides",
      subscribe: "subscribe",
      account: "account",
      privacy: "privacy",
      terms: "terms",
      legal: "legal-notice",
      cookies: "cookies",
      dpa: "dpa",
    },
  },
};

/**
 * Ticket 22, the price pages. This market shops by price ("cuanto cuesta", "precios", "tarifs"), so
 * the level pages live under the section word a shop would type. The slug is written once here and
 * read from `slugs` like every other page: `href`, `absUrl`, `pagePath` and the sitemap follow it
 * without knowing there is a level in the path.
 */
const PRICE_SECTIONS = { es: "precios", ca: "preus", fr: "tarifs", en: "pricing" };
for (const [code, section] of Object.entries(PRICE_SECTIONS)) {
  for (const tier of catalogue.tiers) LOCALES[code].slugs[`price_${tier}`] = `${section}/${tier}`;
}

/**
 * Ticket 25 (site-seo 06), the pages by trade and city. The set is data, not markup:
 * `site/content/trades.json` names the trades, the cities and one page per pair, and the build turns
 * that list into pages. Adding a trade, a city or a page is an edit in that file; nothing here knows
 * the name of a trade.
 *
 * Three rules keep the set a set of pages and not a doorway farm, and the build refuses the day one
 * of them is broken:
 *
 * 1. `cap` is a ceiling on generated pages. The day the list reaches it, the build stops and a human
 *    decides what to drop or whether the ceiling moves.
 * 2. Every page carries its own `angle`, one paragraph per language, at least
 *    `MIN_TRADE_ANGLE` characters, and no two pages of the same trade and language may carry the
 *    same one. A page whose angle is missing, thin or a copy of its neighbour is refused.
 * 3. A page may only be written in a language its city's country speaks, so a Spanish city never
 *    quotes the French grid and the other way round.
 */
const MIN_TRADE_ANGLE = 140;
const TRADE_DATA = JSON.parse(readFileSync(join(contentDir, "trades.json"), "utf8"));

/** `trade_<trade>_<city>` is the page key; the slug is per language and lives under the locale. */
function tradeKey(tradeId, cityId) {
  return `trade_${tradeId}_${cityId}`;
}

/**
 * The data file against the catalogue and the rest of the site, before a page is written. Returns the
 * flat list of pages the build then renders, one row per language.
 */
function readTradeData() {
  const where = "site/content/trades.json";
  const problems = [];
  const cap = TRADE_DATA.cap;
  if (!Number.isInteger(cap) || cap <= 0) {
    problems.push(`- ${where} has no whole-number cap. The ceiling is what keeps the set useful, and the build cannot guess it.`);
  }
  const trades = TRADE_DATA.trades ?? [];
  const cities = TRADE_DATA.cities ?? [];
  const rows = TRADE_DATA.pages ?? [];
  if (!trades.length || !cities.length || !rows.length) {
    problems.push(`- ${where} needs at least one trade, one city and one page.`);
  }
  const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
  const cityById = new Map(cities.map((city) => [city.id, city]));

  for (const city of cities) {
    if (!catalogue.countries.includes(city.country)) {
      problems.push(`- ${where} city "${city.id}" names the country "${city.country}", which the catalogue does not sell.`);
    }
    for (const locale of Object.keys(LOCALES)) {
      if (!city.locales?.includes(locale)) continue;
      if (LOCALES[locale].country !== city.country) {
        problems.push(
          `- ${where} city "${city.id}" is in ${city.country}, so it cannot be published in ${locale}: that page would quote the ${LOCALES[locale].country} grid.`,
        );
      }
    }
  }

  const seenAngles = new Map();
  const pages = [];
  for (const row of rows) {
    const trade = tradeById.get(row.trade);
    const city = cityById.get(row.city);
    if (!trade) {
      problems.push(`- ${where} page for the city "${row.city}" names the trade "${row.trade}", which is not in the file.`);
      continue;
    }
    if (!city) {
      problems.push(`- ${where} page for the trade "${row.trade}" names the city "${row.city}", which is not in the file.`);
      continue;
    }
    if (!row.locales?.length) {
      problems.push(`- ${where} page ${trade.id}/${city.id} names no language.`);
      continue;
    }
    for (const locale of row.locales) {
      const label = `${trade.id}/${city.id} (${locale})`;
      if (!LOCALES[locale]) {
        problems.push(`- ${where} page ${label} names a language the site does not build.`);
        continue;
      }
      if (!city.locales?.includes(locale)) {
        problems.push(`- ${where} page ${label} is not among the languages of ${city.id} (${(city.locales ?? []).join(", ")}).`);
        continue;
      }
      for (const [field, map] of [["slugs", trade.slugs], ["names", trade.names]]) {
        if (!map?.[locale]) problems.push(`- ${where} trade "${trade.id}" has no ${field} for ${locale}.`);
      }
      if (!city.slugs?.[locale] || !city.names?.[locale]) {
        problems.push(`- ${where} city "${city.id}" has no name or slug for ${locale}.`);
      }
      const angle = String(row.angles?.[locale] ?? "").trim();
      if (angle.length < MIN_TRADE_ANGLE) {
        problems.push(
          `- ${where} page ${label} carries ${angle.length} characters of angle, and a page under ${MIN_TRADE_ANGLE} is a doorway, not a page. Write what changes for this trade in this city.`,
        );
      } else {
        const fingerprint = `${trade.id}|${locale}|${angle.replace(/\s+/g, " ").toLowerCase()}`;
        if (seenAngles.has(fingerprint)) {
          problems.push(`- ${where} page ${label} carries the same angle as ${seenAngles.get(fingerprint)}: one of the two has to say something of its own.`);
        } else {
          seenAngles.set(fingerprint, label);
        }
      }
      if (!trade.slugs?.[locale] || !city.slugs?.[locale]) continue;
      const slug = `${trade.slugs[locale]}-${city.slugs[locale]}`;
      const taken = Object.entries(LOCALES[locale].slugs).find(([, value]) => value === slug);
      if (taken) {
        problems.push(`- ${where} page ${label} would be written at /${locale}/${slug}/, where the ${taken[0]} page already lives.`);
        continue;
      }
      LOCALES[locale].slugs[tradeKey(trade.id, city.id)] = slug;
      pages.push({ key: tradeKey(trade.id, city.id), slug, locale, angle, trade, city });
    }
  }
  if (Number.isInteger(cap) && pages.length > cap) {
    problems.push(
      `- ${where} would generate ${pages.length} pages and the cap is ${cap}. Drop a page or raise the cap on purpose; a set that grows past its ceiling is the city grid the spec rules out.`,
    );
  }
  if (problems.length) throw new Error(`The trade and city pages cannot be published:\n${problems.join("\n")}`);
  return pages;
}

const TRADE_PAGES = readTradeData();

/** The languages that publish at least one trade and city page, which is where their copy is required. */
const TRADE_LOCALES = Object.keys(LOCALES).filter((code) => TRADE_PAGES.some((page) => page.locale === code));

/** The languages a trade and city page is published in, in the site's own order, for its alternates. */
function tradeLanguages(page) {
  const mine = TRADE_PAGES.filter((row) => row.key === page.key).map((row) => row.locale);
  return Object.keys(LOCALES).filter((code) => mine.includes(code));
}

function tradeHref(locale, page, depth) {
  return `${"../".repeat(depth)}${locale}/${LOCALES[locale].slugs[page.key]}/`;
}

function absTradeUrl(locale, page) {
  return `${SITE}/${locale}/${LOCALES[locale].slugs[page.key]}/`;
}

/**
 * Ticket 26 (site-seo 07), the comparison pages: the shop that is already comparing. The three the
 * spec names are here, the local agency, the software the shop was about to buy and the platform a
 * franchise imposes, and each one is published in the language of the market it belongs to.
 *
 * The page is a set of claims about the other party, so the data file carries the other party's own
 * page under every claim, with the date it was read, and the build refuses the day one of these is
 * broken:
 *
 * 1. A claim with no source, a source that is not an http(s) link a reader can open, a source with no
 *    read date, a source dated in the future, and a source read more than `maxAgeDays` ago (a stale
 *    comparison is refused with the URL to re-read, not published quietly).
 * 2. Fewer than three claims, or fewer than two things the alternative does better. A comparison
 *    nobody believes converts nobody, and one that only lists what we do better is an advert.
 * 3. A page that closes on anything other than the audit or the trial, and a page whose slug is
 *    already taken in that language.
 */
const MIN_COMPARISON_CLAIMS = 3;
const MIN_COMPARISON_BETTER = 2;
const COMPARISON_DATA = JSON.parse(readFileSync(join(contentDir, "comparisons.json"), "utf8"));

/** `compare_agency` is the page key; the slug is per language and lives under the locale. */
function comparisonKey(id) {
  return `compare_${id}`;
}

const READ_ON_MONTHS = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  ca: ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

/** The day a page was read, as the reader reads dates: 24 de septiembre de 2026, 24 septembre 2026. */
function formatReadOn(iso, locale) {
  const [year, month, day] = String(iso).split("-").map(Number);
  const months = READ_ON_MONTHS[locale] ?? READ_ON_MONTHS.es;
  const name = months[(month || 1) - 1];
  if (locale === "en" || locale === "fr") return `${day} ${name} ${year}`;
  return `${day} de ${name} de ${year}`;
}

/** How long ago a source was read, in days, or `null` when the date is not a date. */
function daysSinceRead(iso, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null;
  const [year, month, day] = String(iso).split("-").map(Number);
  const when = Date.UTC(year, month - 1, day);
  const parsed = new Date(when);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return (now.getTime() - when) / 86400000;
}

/**
 * The data file against itself and against the site, before a page is written. A row that carries a
 * problem is not registered and not rendered: the build stops with every problem listed, so a page
 * cannot be published with a claim nobody can check.
 */
function readComparisonData() {
  const where = "site/content/comparisons.json";
  const problems = [];
  const maxAgeDays = COMPARISON_DATA.maxAgeDays;
  if (!Number.isInteger(maxAgeDays) || maxAgeDays <= 0) {
    problems.push(`- ${where} has no whole-number maxAgeDays: it is how old a source may be before the comparison has to be read again.`);
  }
  const rows = COMPARISON_DATA.pages ?? [];
  if (!rows.length) problems.push(`- ${where} carries no page.`);
  const now = new Date();
  const seenClaims = new Map();
  const pages = [];
  for (const row of rows) {
    const label = `${row.id} (${row.locale})`;
    const mine = [];
    if (!/^[a-z][a-z0-9-]*$/.test(String(row.id ?? ""))) {
      problems.push(`- ${where} page ${label} has no id: write a short lowercase id, one per comparison.`);
      continue;
    }
    if (!LOCALES[row.locale]) {
      problems.push(`- ${where} page ${label} names a language the site does not build.`);
      continue;
    }
    for (const [field, value] of [["title", row.title], ["lead", row.lead], ["alternative", row.alternative]]) {
      if (String(value ?? "").trim() === "") {
        mine.push(`- ${where} page ${label} has no ${field}, so the page would publish a hole.`);
      }
    }
    if (row.cta !== "audit" && row.cta !== "trial") {
      mine.push(`- ${where} page ${label} closes on "${row.cta}": a comparison page ends on the audit or the trial, never on a form.`);
    }
    const slug = String(row.slug ?? "").trim().replace(/^\/+|\/+$/g, "");
    if (!slug) {
      mine.push(`- ${where} page ${label} has no slug.`);
    } else {
      if (LOCALES[row.locale].slugs[comparisonKey(row.id)]) {
        mine.push(`- ${where} carries two pages for ${label}: one comparison is one page per language.`);
      }
      const taken = Object.entries(LOCALES[row.locale].slugs).find(([, value]) => value === slug);
      if (taken) {
        mine.push(`- ${where} page ${label} would be written at /${row.locale}/${slug}/, where the ${taken[0]} page already lives.`);
      }
    }
    const claims = Array.isArray(row.claims) ? row.claims : [];
    if (claims.length < MIN_COMPARISON_CLAIMS) {
      mine.push(
        `- ${where} page ${label} carries ${claims.length} claims, and a comparison under ${MIN_COMPARISON_CLAIMS} claims is a slogan, not a comparison.`,
      );
    }
    claims.forEach((claim, index) => {
      const at = `${label} claim ${index + 1}`;
      const text = String(claim?.text ?? "").trim();
      if (text === "") mine.push(`- ${where} ${at} has no text.`);
      else {
        const fingerprint = text.replace(/\s+/g, " ").toLowerCase();
        if (seenClaims.has(fingerprint)) {
          mine.push(`- ${where} ${at} repeats the claim written for ${seenClaims.get(fingerprint)}: one of the two has to say something of its own.`);
        } else {
          seenClaims.set(fingerprint, at);
        }
      }
      const sources = Array.isArray(claim?.sources) ? claim.sources : [];
      if (!sources.length) {
        mine.push(`- ${where} ${at} names no source: every claim about the other party comes from that party's own published page.`);
      }
      for (const source of sources) {
        const url = String(source?.url ?? "").trim();
        if (!/^https?:\/\/\S+$/.test(url)) {
          mine.push(`- ${where} ${at} carries the source "${url}", which a reader cannot open: every source is an http(s) link.`);
        }
        if (String(source?.label ?? "").trim() === "") {
          mine.push(`- ${where} ${at} has a source with no label, so a reader cannot see whose page it is.`);
        }
        const days = daysSinceRead(source?.readOn, now);
        if (days === null) {
          mine.push(`- ${where} ${at}, source ${url}, has no read date: write readOn as YYYY-MM-DD, the day the page was read.`);
        } else if (days < -1) {
          mine.push(`- ${where} ${at}, source ${url}, is dated in the future (${source.readOn}).`);
        } else if (Number.isInteger(maxAgeDays) && days > maxAgeDays) {
          mine.push(
            `- ${where} ${at}, source ${url}, was read on ${source.readOn}, more than ${maxAgeDays} days ago: re-read the page before publishing the comparison.`,
          );
        }
      }
    });
    const better = (Array.isArray(row.better) ? row.better : []).filter((line) => String(line ?? "").trim() !== "");
    if (better.length < MIN_COMPARISON_BETTER) {
      mine.push(
        `- ${where} page ${label} states ${better.length} things the other party does better, and a comparison nobody believes converts nobody: write at least ${MIN_COMPARISON_BETTER}.`,
      );
    }
    problems.push(...mine);
    if (mine.length || !slug) continue;
    LOCALES[row.locale].slugs[comparisonKey(row.id)] = slug;
    pages.push({ ...row, slug, claims, better });
  }
  if (problems.length) throw new Error(`The comparison pages cannot be published:\n${problems.join("\n")}`);
  return pages;
}

const COMPARISON_PAGES = readComparisonData();

/** The languages that publish a comparison page, which is where their copy is required. */
const COMPARISON_LOCALES = Object.keys(LOCALES).filter((code) =>
  COMPARISON_PAGES.some((page) => page.locale === code),
);

/** The languages one comparison is published in, in the site's own order, for its alternates. */
function comparisonLanguages(id) {
  const mine = COMPARISON_PAGES.filter((row) => row.id === id).map((row) => row.locale);
  return Object.keys(LOCALES).filter((code) => mine.includes(code));
}

function comparisonHref(locale, id, depth) {
  return href(locale, comparisonKey(id), depth);
}

function absComparisonUrl(locale, id) {
  return absUrl(locale, comparisonKey(id));
}

/** The copy every price page shares, once per language. */
const PRICE_PAGE_SHARED_KEYS = [
  "price.kicker",
  "price.for_title",
  "price.included_title",
  "price.change_title",
  "price.not_included_title",
  "price.trial_title",
  "price.levels_title",
  "price.audit_line",
  "price.ht_label",
  "price.ttc_label",
  "price.vat_note",
];

/**
 * The copy one level's page carries on its own. These six keys are what keeps the four pages of a
 * language from being one page with the level swapped: each one writes its own audience, its own
 * fence and its own step up.
 */
const PRICE_PAGE_LEVEL_KEYS = ["title", "lead", "for", "change", "not_included", "trial"];

function pricePageKey(tierId, key) {
  return `price.${tierId}_${key}`;
}

/**
 * Ticket 08, the audit page's copy, once per language. The form's labels, the consent line and the
 * three states the endpoint does not write are all a visitor reads before anything else happens, and
 * an empty one is a hole in a public form, so the build refuses it.
 */
const AUDIT_PAGE_KEYS = [
  "audit.kicker",
  "audit.title",
  "audit.lead",
  "audit.form_name",
  "audit.form_name_ph",
  "audit.form_city",
  "audit.form_city_ph",
  "audit.form_email",
  "audit.form_email_hint",
  "audit.form_consent",
  "audit.form_submit",
  "audit.form_note",
  "audit.loading",
  "audit.error",
  "audit.fixes_heading",
  "audit.parts_heading",
  "audit.emailed",
  "audit.not_emailed",
];

function parseMd(text) {
  const map = {};
  let key = null;
  const buf = [];
  for (const line of text.split(/\n/)) {
    const m = line.match(/^##\s+(\S+)\s*$/);
    if (m) {
      if (key) map[key] = buf.join("\n").trim();
      key = m[1];
      buf.length = 0;
    } else buf.push(line);
  }
  if (key) map[key] = buf.join("\n").trim();
  // A leftover {placeholder} is copy that renders literally on a public page. Fail the build. The
  // price tokens are the exception: the build fills those from the catalogue once the language and
  // the country of the page are known, a few lines below.
  for (const [k, v] of Object.entries(map)) {
    const hole = stripPriceTokens(v).match(/\{[a-z][a-z0-9_]*\}/i);
    if (hole) throw new Error(`content placeholder ${hole[0]} never filled in "${k}", write the real words or drop it`);
  }
  return map;
}

function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function paras(s) {
  return String(s || "")
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replaceAll("\n", "<br>")}</p>`)
    .join("\n");
}

function mdInline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/g,
      '<a href="$2" rel="noopener">$1</a>',
    );
}

function legalBody(s) {
  return String(s || "")
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const first = lines[0] ?? "";
      if (first.startsWith("# ")) {
        const rest = lines.slice(1).join("\n").trim();
        return `<h1>${mdInline(first.slice(2))}</h1>${rest ? `<p>${mdInline(rest)}</p>` : ""}`;
      }
      if (first.startsWith("## ")) {
        const rest = lines.slice(1).join("\n").trim();
        return `<h2>${mdInline(first.slice(3))}</h2>${rest ? `<p>${mdInline(rest)}</p>` : ""}`;
      }
      if (lines.every((l) => l.trim().startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${mdInline(l.replace(/^\s*-\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${mdInline(block)}</p>`;
    })
    .join("\n");
}

const LEGAL_FILES = {
  legal: "aviso.md",
  terms: "condiciones.md",
  privacy: "privacidad.md",
  cookies: "cookies.md",
  dpa: "encargo.md",
};

function loadLegalMarkdown(locale, page) {
  const file = LEGAL_FILES[page];
  if (!file) return "";
  const path = join(root, "..", "legal", locale, file);
  if (!existsSync(path)) return "";
  // The legal pages quote the same prices as the rest of the site, so they read the catalogue too:
  // a term that states a price the invoice will not honour is worse than a wrong marketing line.
  return fillPrices(readFileSync(path, "utf8"), {
    catalogue,
    country: LOCALES[locale].country,
    locale,
    where: `legal/${locale}/${file}`,
  });
}

function homeLead(s) {
  return String(s || "")
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => {
      const lines = p.split("\n");
      const hm = lines[0].match(/^##\s+(.+)$/);
      if (hm) {
        const rest = lines.slice(1).join("\n").trim();
        return `<h2 class="lead-product">${esc(hm[1])}</h2>${rest ? `<p>${esc(rest).replaceAll("\n", "<br>")}</p>` : ""}`;
      }
      return `<p>${esc(p).replaceAll("\n", "<br>")}</p>`;
    })
    .join("\n");
}

function inlineLinks(locale, s, depth = 3) {
  return esc(s)
    .replaceAll("\n", "<br>")
    // The page name allows underscores because the price pages are `price_<level>` since ticket 22.
    .replace(/\[([^\]]+)\]\(\[\[page:([a-z_]+)\]\]\)/g, (_, label, page) => `<a href="${esc(href(locale, page, depth))}">${label}</a>`)
    .replace(/\[([^\]]+)\]\(\[\[([a-z]+)\]\]\)/g, (_, label, id) => `<a href="${esc(guideHref(locale, id, depth))}">${label}</a>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => `<a href="${esc(url)}" rel="noopener" target="_blank">${label}</a>`);
}

function guideBody(locale, s) {
  return String(s || "")
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => {
      const lines = p.split("\n");
      const hm = lines[0].match(/^##\s+(.+)$/);
      if (hm) {
        const rest = lines.slice(1).join("\n").trim();
        return `<h2>${esc(hm[1])}</h2>${rest ? `<p>${inlineLinks(locale, rest)}</p>` : ""}`;
      }
      return `<p>${inlineLinks(locale, p)}</p>`;
    })
    .join("\n");
}

function t(copy, key) {
  return copy[key] ?? "";
}

/** A parsed content file, with every price token filled from the catalogue for that page's country. */
function fillCopy(locale, file, copy) {
  const country = LOCALES[locale].country;
  const filled = {};
  for (const [key, value] of Object.entries(copy)) {
    filled[key] = fillPrices(value, { catalogue, country, locale, where: `${file} ${key}` });
  }
  return filled;
}

function withPrices(locale, file, raw) {
  return fillCopy(locale, file, parseMd(raw));
}

/**
 * The levels a page presents: every level of the catalogue whose name this language's content
 * writes, in the catalogue's order. The prices are never part of that decision, they come from the
 * catalogue. A level whose copy has not been written yet is not presented, and the day its copy
 * lands its card, its price and its place in the pay grid appear without touching this build.
 */
function presentedTiers(copy, config) {
  const shown = config.tiers
    .filter((tier) => catalogue.tiers.includes(tier.id))
    .filter((tier) => t(copy, `product.social_${tier.id}_name`).trim() !== "");
  if (!shown.length) {
    throw new Error("the site content names no level of the catalogue, so no page can present a price");
  }
  return shown;
}

function splitStepTitle(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d+)\.\s*(.+)$/);
  if (m) return { n: m[1], title: m[2] };
  return { n: "", title: s };
}

const SITE = "https://www.babyrock.ai";

function href(locale, page, depth) {
  const slug = LOCALES[locale].slugs[page];
  const prefix = "../".repeat(depth);
  return slug ? `${prefix}${locale}/${slug}/` : `${prefix}${locale}/`;
}

function absUrl(locale, page) {
  const slug = LOCALES[locale].slugs[page];
  return slug ? `${SITE}/${locale}/${slug}/` : `${SITE}/${locale}/`;
}

/**
 * The pages that publish a country's grid, so a price error can name the page a reviewer has to look
 * at instead of only the content file.
 */
const pricePagesByCountry = Object.fromEntries(
  catalogue.countries.map((country) => [
    country,
    Object.keys(LOCALES)
      .filter((code) => LOCALES[code].country === country)
      .flatMap((code) =>
        ["home", "services", "subscribe"].map((page) => absUrl(code, page).replace(SITE, "")),
      ),
  ]),
);

/**
 * The subscribe page, with the level the visitor already chose. A "Start with Plus" button that
 * opens a page presenting Lite first is the same lost choice as a pay page that forgets the plan.
 */
function subscribeHref(locale, depth, plan) {
  const base = href(locale, "subscribe", depth);
  /*
   * The country travels with the link, even when no level does.
   *
   * A bare pay page used to quote Spain to everyone, so a French reader who clicked "subscribe" from
   * a French page started on the Spanish grid and read 48,76 when the card would be charged 65,83
   * (independent verification, 25 September 2026). The pay page now reads the country, and this is
   * where the country comes from.
   */
  const country = LOCALES[locale].country;
  return plan
    ? `${base}?plan=${encodeURIComponent(payPlanId(plan, country))}`
    : `${base}?country=${encodeURIComponent(country)}`;
}

/**
 * The free audit, as the price pages link to it. This was the WhatsApp conversation with
 * `home.audit_prefill` while the audit page did not exist; ticket 08 landed the page, so the one
 * helper now points at it and the sixteen price pages followed without being touched.
 */
function auditHref(locale, depth) {
  return href(locale, "audit", depth);
}

/**
 * A tier as the pay flow names it: a level, an interval and a country, which is the SKU the catalogue
 * builds. `lite` is not a plan and neither is `lite_month`, which names Spain; a French reader has to
 * reach `lite_month_fr` or the card is charged the Spanish grid.
 */
function payPlanId(tierId, country) {
  if (tierId === "free_trial") return "free_trial";
  if (/_(month|year)_[a-z]{2}$/.test(tierId)) return tierId;
  const level = tierId.replace(/_(month|year)$/, "");
  return `${level}_month_${String(country).toLowerCase()}`;
}

/**
 * The alternates of one page. A normal page exists in the four languages, so `codes` is every locale;
 * a trade and city page is published only in the languages its city's country speaks (ticket 25), so
 * it passes its own list and `x-default` falls back to the first of them when Spanish is not one.
 */
function hreflangLinks(page, absHrefFor, codes = Object.keys(LOCALES)) {
  const url = (code) => (absHrefFor ? absHrefFor(code) : absUrl(code, page));
  const tags = codes.map(
    (code) => `  <link rel="alternate" hreflang="${LOCALES[code].html}" href="${url(code)}">`
  );
  const fallback = codes.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : codes[0];
  tags.push(`  <link rel="alternate" hreflang="x-default" href="${url(fallback)}">`);
  return tags.join("\n");
}

function jsonLd(locale, page, copy, config, extraGraph) {
  const org = {
    "@type": ["Organization", "LocalBusiness"],
    name: config.legalName || "BabyRock",
    alternateName: "BabyRock",
    url: SITE + "/",
    email: config.privacyEmail || config.email,
    vatID: config.vatId || undefined,
    image: `${SITE}/assets/og.jpg`,
    address: {
      "@type": "PostalAddress",
      streetAddress: config.streetAddress || undefined,
      addressLocality: "Sant Cugat del Vallès",
      postalCode: config.postalCode || undefined,
      addressCountry: "ES",
    },
  };
  const graph = [org];
  // What this page sells, at the price the catalogue charges for the country the page speaks to.
  const offered = presentedTiers(copy, config).map((tier) => ({
    "@type": "Offer",
    name: `BabyRock Social ${tier.name}`,
    price: (catalogue.centsHt(tier.id, "month", LOCALES[locale].country) / 100).toFixed(2),
    priceCurrency: "EUR",
    url: absUrl(locale, "subscribe"),
  }));
  if (page === "home") {
    graph.push({
      "@type": "Service",
      name: "BabyRock Social",
      description: t(copy, "meta.description"),
      provider: { "@id": SITE + "/#org" },
      areaServed: ["ES", "FR"],
      offers: offered.map((offer) => ({ ...offer, unitText: "MONTH" })),
    });
    graph.push({
      "@type": "FAQPage",
      mainEntity: [1, 2, 3, 4, 5, 6, 7].map((i) => ({
        "@type": "Question",
        name: t(copy, `home.faq_${i}_q`),
        acceptedAnswer: { "@type": "Answer", text: t(copy, `home.faq_${i}_a`) },
      })),
    });
  }
  if (page === "subscribe") {
    graph.push(...offered);
  }
  if (extraGraph && extraGraph.length) graph.push(...extraGraph);
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  })}</script>`;
}

function guideExtraLd(locale, g, gcopy) {
  const url = absGuideUrl(locale, g.id);
  const extra = [
    {
      "@type": "Article",
      headline: gcopy.title,
      description: gcopy.dek,
      mainEntityOfPage: url,
      url,
      inLanguage: LOCALES[locale].html,
      image: `${SITE}/assets/illustrations/${g.img}`,
      author: { "@type": "Organization", name: "BabyRock Social" },
      publisher: {
        "@type": "Organization",
        name: "BabyRock Social",
        logo: { "@type": "ImageObject", url: `${SITE}/assets/og.jpg` },
      },
    },
  ];
  const faq = [];
  const blocks = String(gcopy.body || "").split(/\n\s*\n/);
  const stripMd = (s) =>
    String(s || "")
      .replace(/\[([^\]]+)\]\(\[\[[^\]]+\]\]\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split("\n");
    const hm = lines[0] && lines[0].match(/^##\s+(.+)$/);
    if (!hm) continue;
    const q = hm[1].trim();
    if (!q.includes("?")) continue;
    let a = stripMd(lines.slice(1).join(" "));
    if (!a && i + 1 < blocks.length && !/^##\s+/.test(blocks[i + 1])) {
      a = stripMd(blocks[i + 1]);
    }
    if (!a) continue;
    faq.push({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    });
  }
  if (faq.length) extra.push({ "@type": "FAQPage", mainEntity: faq });
  return extra;
}

function langSwitcher(locale, page, depth, hrefFor, codes = Object.keys(LOCALES)) {
  return codes
    .map((code) => {
      const current = code === locale ? ' aria-current="true"' : "";
      const url = hrefFor ? hrefFor(code, depth) : href(code, page, depth);
      return `<a href="${url}" data-lang="${code}"${current}>${LOCALES[code].name}</a>`;
    })
    .join("");
}

function nav(locale, page, copy, depth, config) {
  const item = (key, slugKey) => {
    const current = page === slugKey ? ' aria-current="page"' : "";
    return `<a href="${href(locale, slugKey, depth)}"${current}>${esc(t(copy, key))}</a>`;
  };
  return `
    ${item("nav.services", "services")}
    ${item("nav.guides", "guides")}
    ${item("nav.simulator", "simulator")}
    ${item("nav.how", "how")}
    ${item("nav.research", "research")}
    ${item("nav.about", "about")}
    ${item("nav.account", "account")}
  `;
}

function mailLink(config, subject) {
  const email = String(config.email || "").trim();
  const sub = encodeURIComponent(subject || "BabyRock Social");
  return `mailto:${email}?subject=${sub}`;
}

function waLink(config, text) {
  const msg = encodeURIComponent(text || "Hola Rosalia");
  const digits = String(config.whatsapp || "").replace(/\D/g, "");
  if (digits) return `https://wa.me/${digits}?text=${msg}`;
  return `mailto:${config.email}?subject=${encodeURIComponent("BabyRock Social")}&body=${msg}`;
}

// The pay flow lives on the factory (app.babyrock.ai / pay.babyrock.ai), never on this site.
// One value decides it: content/config.json → payUrl. No hardcoded copies per locale.
// `plan`, `country` and `lang` travel with the link: the pay page opens on the level the visitor
// chose, on the grid of the market the page speaks to, and in the language they were reading. Without
// the country a French reader landed on the Spanish grid and read the Spanish amounts (independent
// verification, 25 September 2026).
function payLink(config, plan, locale) {
  const base = String(config.payUrl || "").trim().replace(/\/$/, "");
  if (!base) return "";
  try {
    const url = new URL(base);
    if (plan) url.searchParams.set("plan", plan);
    if (locale) url.searchParams.set("lang", locale);
    const country = locale ? LOCALES[locale]?.country : null;
    if (country && !plan) url.searchParams.set("country", country);
    return url.toString();
  } catch {
    return base;
  }
}

function waIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
}

function asset(depth, path) {
  return `${"../".repeat(depth)}assets/${path}`;
}

/**
 * Real pixel size of a JPEG, read from the file itself. `width`/`height` on an `<img>` are what
 * stop the page from jumping while the picture loads, and guessing them is how that breaks.
 */
const sizeCache = new Map();
function imageSize(relPath) {
  if (sizeCache.has(relPath)) return sizeCache.get(relPath);
  const buf = readFileSync(join(assetDir, relPath));
  let i = 2;
  let size = null;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0–SOF15, minus the tables and the arithmetic-coded variants.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      size = { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      break;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  if (!size) throw new Error(`could not read the JPEG size of ${relPath}`);
  sizeCache.set(relPath, size);
  return size;
}

/**
 * One illustration, offered in the sizes a phone and a laptop actually need (ticket 09).
 *
 * Each `illustrations/<name>.jpg` ships a committed `<name>-640.jpg` derivative — 52–56 KB at
 * quality 65 instead of ~300 KB, generated with:
 *
 *   sips -Z 640 --setProperty formatOptions 65 site/assets/illustrations/<name>.jpg \
 *     --out site/assets/illustrations/<name>-640.jpg
 *
 * `hero.jpg` also gets a `-1024.jpg`. The originals stay for large screens; `sizes` is what keeps
 * a phone off them.
 */
function illustration(depth, file, opts = {}) {
  const base = `illustrations/${file}`;
  const small = base.replace(/\.jpg$/, "-640.jpg");
  const wide = opts.wide ? base.replace(/\.jpg$/, "-1024.jpg") : null;
  const size = imageSize(base);
  const srcset = [
    `${asset(depth, small)} 640w`,
    ...(wide ? [`${asset(depth, wide)} 1024w`] : []),
    `${asset(depth, base)} ${size.width}w`,
  ].join(", ");
  const attrs = [
    `src="${asset(depth, small)}"`,
    `srcset="${srcset}"`,
    `sizes="${opts.sizes || "(max-width: 640px) 92vw, 640px"}"`,
    `alt="${esc(opts.alt ?? "")}"`,
    `width="${size.width}"`,
    `height="${size.height}"`,
    `decoding="async"`,
    opts.eager ? `fetchpriority="high"` : `loading="lazy"`,
  ];
  if (opts.className) attrs.unshift(`class="${opts.className}"`);
  return `<img ${attrs.join(" ")}>`;
}

/** A head-and-shoulders portrait: 480 px is enough for every place it is displayed. */
function portraitImage(depth, name, alt) {
  const size = imageSize(`portraits/${name}.jpg`);
  const small = asset(depth, `portraits/${name}-480.jpg`);
  return `<img src="${small}" srcset="${small} 480w, ${asset(depth, `portraits/${name}.jpg`)} ${size.width}w" sizes="(max-width: 900px) 60vw, 320px" alt="${esc(alt)}" width="${size.width}" height="${size.height}" decoding="async" loading="lazy">`;
}

function cssJs(depth) {
  const p = "../".repeat(depth);
  return {
    css: `${p}css/site.css`,
    js: `${p}js/site.js`,
  };
}

function gaSnippet(config) {
  const id = String(config.gaId || "").trim();
  if (!/^G-[A-Z0-9]+$/i.test(id)) return "";
  const safe = esc(id);
  return `
  <link rel="preconnect" href="https://www.googletagmanager.com">
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
      wait_for_update: 500
    });
    gtag('js', new Date());
    gtag('config', '${safe}');
  </script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=${safe}"></script>`;
}

function consentBanner(copy, locale, depth) {
  return `<div class="cookie-banner" data-cookie-banner hidden>
    <h2>${esc(t(copy, "cookies.title"))}</h2>
    <p>${esc(t(copy, "cookies.body"))} <a href="${href(locale, "cookies", depth)}">${esc(t(copy, "footer.cookies"))}</a>.</p>
    <div class="cookie-actions">
      <button type="button" class="btn btn-coral" data-cookie-accept>${esc(t(copy, "cookies.accept"))}</button>
      <button type="button" class="btn btn-ghost" data-cookie-refuse>${esc(t(copy, "cookies.refuse"))}</button>
    </div>
  </div>`;
}

function trustBar(copy) {
  const raw = t(copy, "home.trust") || "";
  if (!raw) return "";
  return `<div class="trust-wrap"><p class="wrap trust-bar">${esc(raw)}</p></div>`;
}

/**
 * The BETA mark: one word, one treatment, on the public site and the hunter site. It is a link, not a
 * decoration, because the mark only means something next to the clause that explains it (article 6 of
 * the terms). The word and the hover line live in the content files, one entry per locale.
 */
function betaPill(copy, locale, depth) {
  const word = t(copy, "beta.pill") || "Beta";
  const note = t(copy, "beta.pill_title");
  return `<a class="beta-pill" href="${href(locale, "terms", depth)}"${note ? ` title="${esc(note)}"` : ""}>${esc(word)}</a>`;
}

/** One quiet line, in the plans section and in the trial block, so BETA is not just a badge. */
function betaLine(copy) {
  const line = t(copy, "beta.line");
  return line ? `<p class="beta-line">${esc(line)}</p>` : "";
}

function faviconLinks(depth) {
  const root = depth ? "../".repeat(depth) : "./";
  return `  <link rel="icon" href="${root}favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="48x48" href="${asset(depth, "favicon-48.png")}">
  <link rel="icon" type="image/png" sizes="192x192" href="${asset(depth, "favicon-192.png")}">
  <link rel="apple-touch-icon" href="${root}apple-touch-icon.png">`;
}

function shell({ locale, page, copy, config, depth, title, description, body, langHref, canonicalUrl, hreflangAbs, extraGraph, ogType, languages }) {
  const { css, js } = cssJs(depth);
  const navHtml = nav(locale, page, copy, depth, config);
  const wa = waLink(config, t(copy, "wa.prefill"));
  const canonical = canonicalUrl || absUrl(locale, page);
  const ogImage = `${SITE}/assets/og.jpg`;
  const robots = page === "account" ? "noindex,follow" : "index,follow";
  const codes = languages && languages.length ? languages : Object.keys(LOCALES);
  return `<!doctype html>
<html lang="${LOCALES[locale].html}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${canonical}">
${faviconLinks(depth)}
${hreflangLinks(page, hreflangAbs, codes)}
  <meta property="og:type" content="${esc(ogType || "website")}">
  <meta property="og:site_name" content="BabyRock Social">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:locale" content="${locale === "en" ? "en_GB" : locale === "ca" ? "ca_ES" : locale === "fr" ? "fr_FR" : "es_ES"}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${ogImage}">
  <link rel="stylesheet" href="${css}">
  ${jsonLd(locale, page, copy, config, extraGraph)}
  ${gaSnippet(config)}
</head>
<body>
  <a class="skip" href="#main">${esc(t(copy, "nav.skip") || "Skip")}</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <div class="logo-group">
        <a class="logo" href="${href(locale, "home", depth)}"><img class="logo-mark" src="${asset(depth, "favicon-192.png")}" alt="" width="28" height="28" decoding="async">BabyRock</a>
        ${betaPill(copy, locale, depth)}
      </div>
      <nav class="nav-links">${navHtml}</nav>
      <div class="header-actions">
        <div class="lang">${langSwitcher(locale, page, depth, langHref, codes)}</div>
        <a class="btn btn-wa" href="${wa}" target="_blank" rel="noopener">${waIcon()} ${esc(t(copy, "nav.whatsapp"))}</a>
        <a class="btn btn-coral" href="${href(locale, "subscribe", depth)}">${esc(t(copy, "nav.subscribe"))}</a>
        <button class="menu-toggle" type="button" data-menu aria-expanded="false" aria-label="${esc(t(copy, "nav.menu"))}"><span></span><span></span><span></span></button>
      </div>
    </div>
    <nav class="mobile-nav wrap" data-mobile-nav>
      ${navHtml}
      <a class="btn btn-wa" href="${wa}" target="_blank" rel="noopener">${waIcon()} ${esc(t(copy, "nav.whatsapp"))}</a>
    </nav>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div>
        <p class="logo">BabyRock</p>
        ${paras(t(copy, "footer.tagline"))}
        <p>${esc(t(copy, "footer.city"))}</p>
      </div>
      <div>
        <p><a href="${href(locale, "services", depth)}">${esc(t(copy, "nav.services"))}</a></p>
        <p><a href="${href(locale, "guides", depth)}">${esc(t(copy, "nav.guides"))}</a></p>
        <p><a href="${href(locale, "simulator", depth)}">${esc(t(copy, "nav.simulator"))}</a></p>
        <p><a href="${href(locale, "how", depth)}">${esc(t(copy, "nav.how"))}</a></p>
        <p><a href="${href(locale, "research", depth)}">${esc(t(copy, "nav.research"))}</a></p>
        <p><a href="${href(locale, "about", depth)}">${esc(t(copy, "nav.about"))}</a></p>
      </div>
      <div>
        <p><a href="${href(locale, "subscribe", depth)}">${esc(t(copy, "nav.subscribe"))}</a></p>
        <p><a href="${href(locale, "account", depth)}">${esc(t(copy, "nav.account"))}</a></p>
        <p><a href="${href(locale, "legal", depth)}">${esc(t(copy, "footer.legal"))}</a></p>
        <p><a href="${href(locale, "privacy", depth)}">${esc(t(copy, "footer.privacy"))}</a></p>
        <p><a href="${href(locale, "terms", depth)}">${esc(t(copy, "footer.terms"))}</a></p>
        <p><a href="${href(locale, "cookies", depth)}">${esc(t(copy, "footer.cookies"))}</a></p>
        <p><a href="${href(locale, "dpa", depth)}">${esc(t(copy, "footer.dpa"))}</a></p>
        <p><a href="https://hunt.babyrock.ai/${locale}" target="_blank" rel="noopener">${esc(t(copy, "footer.hunt"))}</a></p>
        <p><a href="${wa}" target="_blank" rel="noopener">${esc(t(copy, "nav.whatsapp"))} · Rosalia</a></p>
        <p><a href="mailto:${esc(config.privacyEmail || "contact@babyrock.ai")}">${esc(config.privacyEmail || "contact@babyrock.ai")}</a></p>
      </div>
    </div>
  </footer>
  ${consentBanner(copy, locale, depth)}
  <a class="wa-fab" href="${wa}" target="_blank" rel="noopener" aria-label="${esc(t(copy, "nav.whatsapp"))} Rosalia">
    ${waIcon()}
  </a>
  <script>window.BR_CONFIG = ${JSON.stringify({ ...config, country: LOCALES[locale].country })};</script>
  <script src="${js}"></script>
</body>
</html>`;
}

function shops(copy, depth) {
  const items = [
    ["shop-restaurant.jpg", "home.shop_restaurant"],
    ["shop-bakery.jpg", "home.shop_bakery"],
    ["shop-salon.jpg", "home.shop_salon"],
    ["shop-florist.jpg", "home.shop_florist"],
    ["shop-cafe.jpg", "home.shop_cafe"],
    ["shop-workshop.jpg", "home.shop_workshop"],
    ["shop-clinic.jpg", "home.shop_clinic"],
    ["shop-physio.jpg", "home.shop_physio"],
    ["shop-club.jpg", "home.shop_club"],
  ];
  return items
    .map(
      ([img, key]) =>
        `<figure class="photo-card">${illustration(depth, img, {
          sizes: "(max-width: 640px) 92vw, (max-width: 1000px) 45vw, 300px",
        })}<figcaption>${esc(t(copy, key))}</figcaption></figure>`
    )
    .join("");
}

const KIND_ORDER = ["restaurant", "cafe", "bakery", "salon", "florist", "workshop", "clinic", "physio", "club"];

function pctLabel(n) {
  const x = Math.round(n * 1000) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function simProducts(copy) {
  const items = [
    ["social", "product.social_name", "sim.product_social_sub"],
    ["direct", "product.direct_name", "sim.product_direct_sub"],
    ["both", "sim.product_both", "sim.product_both_sub"],
  ];
  return `<fieldset class="sim-products">
    <legend>${esc(t(copy, "sim.product"))}</legend>
    <div class="sim-product-row">
      ${items
        .map(
          ([value, nameKey, subKey], i) => `<label class="sim-product">
        <input type="radio" name="product" value="${value}"${i === 0 ? " checked" : ""}>
        <span><strong>${esc(t(copy, nameKey))}</strong><em>${esc(t(copy, subKey))}</em></span>
      </label>`
        )
        .join("")}
    </div>
  </fieldset>`;
}

function simOutcomes(copy) {
  return `<div class="sim-outcomes">
    <div class="sim-out sim-out-low">
      <p class="tiny">${esc(t(copy, "sim.low_label"))}</p>
      <p class="big" data-sim-low>-</p>
      <p class="tiny"><span data-sim-low-pct></span> ${esc(t(copy, "sim.pct_of_year"))}</p>
    </div>
    <div class="sim-out sim-out-high">
      <p class="tiny">${esc(t(copy, "sim.high_label"))}</p>
      <p class="big" data-sim-high>-</p>
      <p class="tiny"><span data-sim-high-pct></span> ${esc(t(copy, "sim.pct_of_year"))}</p>
    </div>
  </div>
  <p class="tiny sim-note">${esc(t(copy, "sim.note"))}</p>`;
}

function compactSim(locale, copy, depth) {
  const kinds = KIND_ORDER.map(
    (k) => `<option value="${k}"${k === "restaurant" ? " selected" : ""}>${esc(t(copy, "sim.kind_" + k))}</option>`
  ).join("");
  return `<form class="sim-card sim-card-home" data-sim>
    <h2>${esc(t(copy, "home.sim_title"))}</h2>
    ${paras(t(copy, "home.sim_lead"))}
    <label for="rev">${esc(t(copy, "home.sim_label"))}</label>
    <input id="rev" name="revenue" inputmode="numeric" placeholder="${esc(t(copy, "home.sim_placeholder"))}" value="${esc(t(copy, "home.sim_placeholder"))}">
    <label for="kind">${esc(t(copy, "sim.kind"))}</label>
    <select id="kind" name="kind">${kinds}</select>
    ${simProducts(copy)}
    ${simOutcomes(copy)}
    <p class="sim-links">
      <a href="${href(locale, "research", depth)}">${esc(t(copy, "sim.research_link"))}</a>
      ·
      <a href="${href(locale, "simulator", depth)}">${esc(t(copy, "home.sim_link"))}</a>
    </p>
  </form>`;
}

function homePage(locale, copy, config, depth) {
  return `
  ${trustBar(copy)}
  <section class="hero-stage">
    <div class="wrap hero-split">
      <div class="hero-panel">
        <p class="kicker">${esc(t(copy, "home.kicker"))}</p>
        <h1 class="hero-title">${esc(t(copy, "home.headline"))}</h1>
        <div class="lead">${homeLead(t(copy, "home.lead"))}</div>
        <div class="cta-row">
          <a class="btn btn-wa" href="${waLink(config, t(copy, "home.trial_wa_prefill"))}" target="_blank" rel="noopener">${waIcon()} ${esc(t(copy, "home.cta_trial"))}</a>
          <a class="btn btn-coral" href="#productos">${esc(t(copy, "home.cta_price"))}</a>
          <a class="btn btn-ghost" href="${href(locale, "simulator", depth)}">${esc(t(copy, "home.cta_sim"))}</a>
        </div>
      </div>
      <figure class="hero-visual">${illustration(depth, "hero.jpg", {
        className: "hero-photo",
        wide: true,
        eager: true,
        sizes: "(max-width: 900px) 92vw, 640px",
        alt: t(copy, "home.hero_alt"),
      })}</figure>
    </div>
  </section>
  <section class="section">
    <div class="wrap watch">
      <div>
        <p class="kicker">${esc(t(copy, "home.watch_kicker"))}</p>
        <h2>${esc(t(copy, "home.watch_title"))}</h2>
        ${paras(t(copy, "home.watch_lead"))}
        <div class="stat-row">
          <div class="stat"><b>${esc(t(copy, "home.watch_stat1_value"))}</b><span>${esc(t(copy, "home.watch_stat1_label"))}</span><em>${esc(t(copy, "home.watch_src"))}</em></div>
          <div class="stat"><b>${esc(t(copy, "home.watch_stat2_value"))}</b><span>${esc(t(copy, "home.watch_stat2_label"))}</span><em>${esc(t(copy, "home.watch_src"))}</em></div>
        </div>
      </div>
      <div class="listing">
        <div class="listing-rating"><span class="listing-stars">${esc(t(copy, "home.listing_rating"))}</span><span class="listing-num">${esc(t(copy, "home.listing_num"))}</span></div>
        ${paras(t(copy, "home.listing_body"))}
        <p class="listing-lift">${esc(t(copy, "home.listing_lift"))}</p>
        <p class="src">${esc(t(copy, "home.listing_note"))}</p>
      </div>
    </div>
  </section>
  <section class="section" id="productos">
    <div class="wrap">
      <h2>${esc(t(copy, "home.products_title"))}</h2>
      ${paras(t(copy, "home.products_lead"))}
      ${compareProducts(locale, copy, config, depth)}
      <p style="margin-top:1rem"><a href="${href(locale, "services", depth)}">${esc(t(copy, "nav.services"))}</a></p>
      ${t(copy, "home.not_included_title") ? `<p class="note" style="margin-top:1rem"><strong>${esc(t(copy, "home.not_included_title"))}</strong> ${esc(t(copy, "home.not_included"))}</p>` : ""}
      ${betaLine(copy)}
    </div>
  </section>
  <section class="section">
    <div class="wrap">
      <h2>${esc(t(copy, "home.for_whom_title"))}</h2>
      ${paras(t(copy, "home.for_whom_lead"))}
      <div class="shops">${shops(copy, depth)}</div>
    </div>
  </section>
  <section class="section section-alt" id="sim">
    <div class="wrap">${compactSim(locale, copy, depth)}</div>
  </section>
  <section class="section">
    <div class="wrap value-grid">
      <article class="value-card"><h3>${esc(t(copy, "home.value_time_title"))}</h3>${paras(t(copy, "home.value_time"))}</article>
      <article class="value-card"><h3>${esc(t(copy, "home.value_trust_title"))}</h3>${paras(t(copy, "home.value_trust"))}</article>
      <article class="value-card"><h3>${esc(t(copy, "home.value_rating_title"))}</h3>${paras(t(copy, "home.value_rating"))}</article>
    </div>
  </section>
  <section class="section section-alt">
    <div class="wrap watch">
      <div>
        <p class="kicker">${esc(t(copy, "home.wa_kicker"))}</p>
        <h2>${esc(t(copy, "home.wa_title"))}</h2>
        <ul class="compare-features" style="margin-top:1.2rem">
          <li>${checkIcon()}<div><strong>${esc(t(copy, "home.wa_item1_title"))}</strong><span>${esc(t(copy, "home.wa_item1"))}</span></div></li>
          <li>${checkIcon()}<div><strong>${esc(t(copy, "home.wa_item2_title"))}</strong><span>${esc(t(copy, "home.wa_item2"))}</span></div></li>
          <li>${checkIcon()}<div><strong>${esc(t(copy, "home.wa_item3_title"))}</strong><span>${esc(t(copy, "home.wa_item3"))}</span></div></li>
          <li>${checkIcon()}<div><strong>${esc(t(copy, "home.wa_item4_title"))}</strong><span>${esc(t(copy, "home.wa_item4"))}</span></div></li>
        </ul>
      </div>
      <div class="chat" role="img" aria-label="${esc(t(copy, "home.wa_chat_alt"))}">
        <div class="bubble">${esc(t(copy, "home.wa_chat_1"))}<small>${esc(t(copy, "home.wa_chat_1_meta"))}</small></div>
        <div class="bubble us"><strong>${esc(t(copy, "home.wa_chat_2_author"))}</strong><br />${esc(t(copy, "home.wa_chat_2"))}<small>${esc(t(copy, "home.wa_chat_2_meta"))}</small></div>
        <div class="bubble">${esc(t(copy, "home.wa_chat_3"))}</div>
        <div class="bubble us">${esc(t(copy, "home.wa_chat_4"))}<small>${esc(t(copy, "home.wa_chat_4_meta"))}</small></div>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="wrap human">
      <figure class="portrait">${portraitImage(depth, "rosalia", "Rosalia")}</figure>
      <div class="human-copy">
        <h2>${esc(t(copy, "home.human_title"))}</h2>
        ${paras(t(copy, "home.human"))}
        ${paras(t(copy, "home.whatsapp_line"))}
      </div>
    </div>
  </section>
  ${t(copy, "home.audit_title") ? `
  <section class="section" id="audit">
    <div class="wrap">
      <p class="kicker">${esc(t(copy, "home.audit_kicker"))}</p>
      <h2>${esc(t(copy, "home.audit_title"))}</h2>
      ${paras(t(copy, "home.audit_lead"))}
      <div class="value-grid" style="margin-top:1rem">
        <article class="value-card"><p>${esc(t(copy, "home.audit_item1"))}</p></article>
        <article class="value-card"><p>${esc(t(copy, "home.audit_item2"))}</p></article>
        <article class="value-card"><p>${esc(t(copy, "home.audit_item3"))}</p></article>
      </div>
      <p class="cta-row" style="margin-top:1.25rem">
        <a class="btn btn-coral" href="${href(locale, "audit", depth)}">${esc(t(copy, "home.audit_cta"))}</a>
      </p>
    </div>
  </section>` : ""}
  ${t(copy, "home.trial_title") ? `
  <section class="section" id="trial">
    <div class="wrap">
      <p class="kicker">${esc(t(copy, "home.trial_kicker"))}</p>
      <h2>${esc(t(copy, "home.trial_title"))}</h2>
      ${paras(t(copy, "home.trial_lead"))}
      <div class="compare">
        <article class="compare-card live">
          <div class="compare-head"><h2 class="compare-name">${esc(t(copy, "home.trial_opt1_title"))}</h2></div>
          ${paras(t(copy, "home.trial_opt1"))}
        </article>
        <article class="compare-card live">
          <div class="compare-head"><h2 class="compare-name">${esc(t(copy, "home.trial_opt2_title"))}</h2></div>
          ${paras(t(copy, "home.trial_opt2"))}
          <p><a href="${href(locale, "how", depth)}">${esc(t(copy, "home.trial_video"))}</a></p>
        </article>
        <article class="compare-card live">
          <div class="compare-head"><h2 class="compare-name">${esc(t(copy, "home.trial_opt3_title"))}</h2></div>
          ${paras(t(copy, "home.trial_opt3"))}
        </article>
      </div>
      <div class="cta-row" style="margin-top:1.4rem">
        <a class="btn btn-coral trial-cta-form" href="${href(locale, "subscribe", depth)}">${esc(t(copy, "home.trial_cta"))}</a>
        <a class="btn btn-ghost trial-cta-form-secondary" href="${waLink(config, t(copy, "home.trial_wa_prefill"))}" target="_blank" rel="noopener">${esc(t(copy, "home.trial_cta_whatsapp"))}</a>
        <a class="btn btn-wa trial-cta-mobile" href="${waLink(config, t(copy, "home.trial_wa_prefill"))}" target="_blank" rel="noopener">${waIcon()} ${esc(t(copy, "home.trial_cta_wa"))}</a>
        <a class="btn btn-ghost trial-cta-mobile-secondary" href="${href(locale, "subscribe", depth)}">${esc(t(copy, "home.trial_cta_form"))}</a>
      </div>
      ${paras(t(copy, "home.trial_note"))}
      ${betaLine(copy)}
    </div>
  </section>` : ""}
  <section class="section">
    <div class="wrap faq">
      <h2>${esc(t(copy, "home.faq_title"))}</h2>
      ${[1, 2, 3, 4, 5, 6, 7]
        .map(
          (i) => `<details><summary>${esc(t(copy, "home.faq_" + i + "_q"))}</summary>${paras(t(copy, "home.faq_" + i + "_a"))}</details>`
        )
        .join("")}
    </div>
  </section>`;
}

function simulatorPage(locale, copy, depth) {
  const chips = KIND_ORDER.map(
    (k) => `<label class="sim-chip">
      <input type="radio" name="kind" value="${k}"${k === "restaurant" ? " checked" : ""}>
      <span>${esc(t(copy, "sim.kind_" + k))}</span>
    </label>`
  ).join("");
  return `
  <section class="wrap section">
    <h1>${esc(t(copy, "sim.headline"))}</h1>
    <div class="lead">${paras(t(copy, "sim.lead"))}</div>
    <form class="sim-card sim-card-full" data-sim>
      <label>${esc(t(copy, "sim.revenue"))}
        <input name="revenue" inputmode="numeric" placeholder="${esc(t(copy, "home.sim_placeholder"))}" value="${esc(t(copy, "home.sim_placeholder"))}">
      </label>
      <fieldset class="sim-kinds">
        <legend>${esc(t(copy, "sim.kind"))}</legend>
        <div class="sim-chip-row">${chips}</div>
      </fieldset>
      ${simProducts(copy)}
      ${simOutcomes(copy)}
      <div class="cta-row">
        <a class="btn btn-coral" href="${href(locale, "subscribe", depth)}">${esc(t(copy, "sim.cta"))}</a>
        <a class="btn btn-ghost" href="${href(locale, "research", depth)}">${esc(t(copy, "sim.research_link"))}</a>
      </div>
    </form>
  </section>`;
}

function howPage(locale, copy, config, depth) {
  const steps = [
    ["step-whatsapp.jpg", "how.step1_title", "how.step1"],
    ["step-manager.jpg", "how.step2_title", "how.step2"],
    ["step-write.jpg", "how.step3_title", "how.step3"],
    ["step-recap.jpg", "how.step4_title", "how.step4"],
  ];
  return `
  <section class="wrap section">
    <h1>${esc(t(copy, "how.headline"))}</h1>
    <div class="lead">${paras(t(copy, "how.lead"))}</div>
    <div class="step-grid">
      ${steps
        .map(([img, titleKey, body], i) => {
          const { n, title } = splitStepTitle(t(copy, titleKey));
          const num = n || String(i + 1);
          const videoLabel = t(copy, "how.step2_video");
          const video = i === 1
            ? `<figure class="story-video">
          <video controls playsinline preload="none" poster="${asset(depth, `videos/manager-${locale}.jpg`)}" title="${esc(videoLabel)}" aria-label="${esc(videoLabel)}" width="1080" height="1920">
            <source src="${asset(depth, `videos/manager-${locale}.mp4`)}" type="video/mp4">
          </video>
        </figure>`
            : "";
          return `<details class="story-card"${i === 1 ? " open" : ""}>
        <summary>
          <img src="${asset(depth, "illustrations/" + img)}" alt="" width="72" height="72" loading="lazy" decoding="async">
          <span class="story-num">${esc(num)}</span>
          <h3>${esc(title)}</h3>
        </summary>
        <div class="story-copy">
          ${paras(t(copy, body))}
          ${video}
        </div>
      </details>`;
        })
        .join("")}
    </div>
    <div class="note" style="margin-top:1.5rem">${paras(t(copy, "how.ai_box"))}${paras(t(copy, "how.whatsapp"))}</div>
    <form class="sim-card form-grid" data-interest-form data-intent="trial" data-api="${esc(config.apiUrl || "https://app.babyrock.ai")}" data-pay="${esc(payLink(config, "free_trial", locale))}" data-wa="${esc(String(config.whatsapp || "").replace(/\D/g, ""))}" data-mail="${esc(config.email)}" data-msg-need-contact="${esc(t(copy, "sub.form_need_contact"))}" data-msg-need-email="${esc(t(copy, "sub.form_need_email"))}" data-msg-sending="${esc(t(copy, "sub.form_sending"))}" data-msg-sent="${esc(t(copy, "sub.form_sent"))}" data-msg-error="${esc(t(copy, "sub.form_error"))}" style="margin-top:1.5rem">
      <h2>${esc(t(copy, "how.trial_form_title"))}</h2>
      <p>${esc(t(copy, "how.trial_form_note"))}</p>
      <label>${esc(t(copy, "sub.form_name"))}<input name="business" data-label="${esc(t(copy, "sub.form_name"))}" required></label>
      <label>${esc(t(copy, "sub.form_listing"))}<input name="listing" data-label="${esc(t(copy, "sub.form_listing"))}" required></label>
      <label>${esc(t(copy, "sub.form_email"))}<input name="email" type="email" data-label="${esc(t(copy, "sub.form_email"))}" required></label>
      <label>${esc(t(copy, "sub.form_wa"))}<input name="whatsapp" data-label="${esc(t(copy, "sub.form_wa"))}" required></label>
      <p class="form-error" data-form-error hidden></p>
      <p class="form-sent" data-form-sent hidden></p>
      <div class="cta-row">
        <button class="btn btn-coral" name="channel" value="email" type="submit">${esc(t(copy, "how.trial_form_cta"))}</button>
      </div>
      <p><a class="form-fallback" data-form-fallback hidden>${esc(t(copy, "sub.form_fallback_mail"))}</a></p>
    </form>
  </section>`;
}

function impactTable(copy, config) {
  const impact = config.impact || { social: {}, direct: {}, overlap: 0.85 };
  const o = impact.overlap == null ? 0.85 : impact.overlap;
  const rows = KIND_ORDER.map((k) => {
    const social = impact.social[k] || [0, 0];
    const direct = impact.direct[k] || [0, 0];
    const bothLow = social[0] + o * direct[0];
    const bothHigh = social[1] + o * direct[1];
    return `<tr>
      <th scope="row">${esc(t(copy, "sim.kind_" + k))}</th>
      <td>${pctLabel(social[0])}-${pctLabel(social[1])}%</td>
      <td>${pctLabel(direct[0])}-${pctLabel(direct[1])}%</td>
      <td>${pctLabel(bothLow)}-${pctLabel(bothHigh)}%</td>
    </tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="impact-table">
    <thead><tr>
      <th></th>
      <th>${esc(t(copy, "product.social_name"))}</th>
      <th>${esc(t(copy, "product.direct_name"))}</th>
      <th>${esc(t(copy, "sim.product_both"))}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function researchPage(copy, config) {
  return `
  <section class="wrap section research prose">
    <h1>${esc(t(copy, "research.headline"))}</h1>
    <div class="lead">${paras(t(copy, "research.lead"))}</div>
    <article><h2>${esc(t(copy, "research.luca_title"))}</h2>${paras(t(copy, "research.luca"))}</article>
    <article><h2>${esc(t(copy, "research.womply_title"))}</h2>${paras(t(copy, "research.womply"))}</article>
    <article><h2>${esc(t(copy, "research.direct_title"))}</h2>${paras(t(copy, "research.direct"))}</article>
    <article><h2>${esc(t(copy, "research.formula_title"))}</h2>${paras(t(copy, "research.formula"))}${impactTable(copy, config)}</article>
    <article>${paras(t(copy, "research.what_we_use"))}</article>
  </section>`;
}

function aboutPage(copy, depth) {
  return `
  <section class="wrap section about-page">
    <h1>${esc(t(copy, "about.headline"))}</h1>
    <div class="lead">${paras(t(copy, "about.lead"))}</div>
    <div class="team-grid">
      <article>
        <figure class="portrait">${portraitImage(depth, "rosalia", "Rosalia")}</figure>
        <h2>${esc(t(copy, "about.rosalia_role"))}</h2>
        ${paras(t(copy, "about.rosalia"))}
      </article>
      <article>
        <figure class="portrait">${portraitImage(depth, "ben", "Benjamin Pommeraud")}</figure>
        <h2>${esc(t(copy, "about.ben_role"))}</h2>
        ${paras(t(copy, "about.ben"))}
      </article>
    </div>
    <div class="note" style="margin-top:2rem">
      <h2>${esc(t(copy, "about.human_title"))}</h2>
      ${paras(t(copy, "about.human"))}
      ${paras(t(copy, "about.whatsapp"))}
    </div>
  </section>`;
}

/**
 * Ticket 09 (site-seo 09), box three: a guide keeps the source of every claim it makes. The index
 * promises the reader the sources are at the bottom of each piece, so a guide whose `sources` block
 * is empty, or whose source lines are not links a reader can open, is refused before it is written.
 */
function checkGuideSources(gcopy, file) {
  const lines = String(gcopy.sources || "")
    .split(/\n/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new Error(
      `${file} carries no sources: a guide keeps the source of every claim it makes, which is also what it tells its reader it does`,
    );
  }
  const unopenable = lines.filter((line) => !/^\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(line));
  if (unopenable.length) {
    throw new Error(
      `${file} carries a source a reader cannot open: ${unopenable.join(" | ")}. Every source is a link the reader can check.`,
    );
  }
}

function readGuide(locale, id) {
  const p = join(contentDir, "guides", locale, `${id}.md`);
  const fb = join(contentDir, "guides", "es", `${id}.md`);
  const file = existsSync(p) ? `guides/${locale}/${id}.md` : `guides/es/${id}.md`;
  const gcopy = withPrices(locale, `site/content/${file}`, readFileSync(existsSync(p) ? p : fb, "utf8"));
  checkGuideSources(gcopy, `site/content/${file}`);
  return gcopy;
}

function guideHref(locale, id, depth) {
  const prefix = "../".repeat(depth);
  const index = LOCALES[locale].slugs.guides;
  const slug = GUIDES.find((g) => g.id === id).slugs[locale];
  return `${prefix}${locale}/${index}/${slug}/`;
}

function absGuideUrl(locale, id) {
  const index = LOCALES[locale].slugs.guides;
  const slug = GUIDES.find((g) => g.id === id).slugs[locale];
  return `${SITE}/${locale}/${index}/${slug}/`;
}

function sourceList(raw) {
  return `<ul class="sources">${String(raw || "")
    .split(/\n/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^\[(.+)\]\((https?:\/\/[^)]+)\)\s*(.*)$/);
      if (!m) return `<li>${esc(line)}</li>`;
      const rest = m[3] ? ` ${esc(m[3])}` : "";
      return `<li><a href="${esc(m[2])}" rel="noopener" target="_blank">${esc(m[1])}</a>${rest}</li>`;
    })
    .join("")}</ul>`;
}

function guidesIndexPage(locale, copy, config, depth) {
  const cards = GUIDES.map((g) => {
    const gcopy = readGuide(locale, g.id);
    return `<article class="guide-card"><a href="${guideHref(locale, g.id, depth)}">
      ${illustration(depth, g.img, { sizes: "(max-width: 640px) 92vw, (max-width: 1000px) 45vw, 360px" })}
      <h3>${esc(gcopy.title)}</h3>
      <p>${esc(gcopy.dek)}</p>
    </a></article>`;
  }).join("");
  return `
  <section class="wrap section">
    <h1>${esc(t(copy, "guides.headline"))}</h1>
    <div class="lead">${paras(t(copy, "guides.lead"))}</div>
    <div class="guide-grid">${cards}</div>
  </section>`;
}

function guideArticlePage(locale, copy, config, depth, id) {
  const g = GUIDES.find((x) => x.id === id);
  const gcopy = readGuide(locale, id);
  const wa = waLink(config, gcopy.wa_prefill);
  return `
  <article class="wrap section guide-article">
    <p class="kicker"><a href="${href(locale, "guides", depth)}">${esc(t(copy, "nav.guides"))}</a></p>
    <h1>${esc(gcopy.title)}</h1>
    <div class="lead">${paras(gcopy.dek)}</div>
    <figure class="guide-hero">${illustration(depth, g.img, {
      sizes: "(max-width: 900px) 92vw, 640px",
      alt: gcopy.title,
    })}</figure>
    <aside class="impact-box">
      <p class="tiny">${esc(gcopy.impact_label)}</p>
      ${paras(gcopy.impact)}
    </aside>
    ${guideBody(locale, gcopy.body)}
    <h2>${esc(t(copy, "guides.sources"))}</h2>
    ${sourceList(gcopy.sources)}
    <p class="cta-row" style="margin-top:1.5rem">
      <a class="btn btn-wa" href="${wa}" target="_blank" rel="noopener">${waIcon()} ${esc(t(copy, "nav.whatsapp"))} Rosalia</a>
      <a class="btn btn-coral" href="${mailLink(config)}">${esc(t(copy, "home.cta_sub"))}</a>
    </p>
    <aside class="guide-next">
      <p>${inlineLinks(locale, t(copy, "guides.covered"))}</p>
      <p>${inlineLinks(locale, t(copy, "guides.audit_line"))}</p>
    </aside>
  </article>`;
}

function checkIcon(soon) {
  const c = soon ? "#6a645c" : "#3c9a4e";
  return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="9" stroke="${c}" stroke-width="1.6"/><path d="M6 10.2l2.3 2.3L14 7.6" stroke="${c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function featureItems(copy, prefix, n, soon) {
  return Array.from({ length: n }, (_, i) => {
    const k = `${prefix}_f${i + 1}`;
    return `<li>${checkIcon(soon)}<div><strong>${esc(t(copy, `${k}_title`))}</strong><span>${esc(t(copy, k))}</span></div></li>`;
  }).join("");
}

/** One line per benefit, for the three versions of BabyRock Social. */
function tierFeatures(copy, prefix, n) {
  return Array.from({ length: n }, (_, i) => {
    const line = t(copy, `${prefix}_f${i + 1}`);
    return `<li>${checkIcon(false)}<div><span>${esc(line)}</span></div></li>`;
  })
    .filter((li) => !li.includes("<span></span>"))
    .join("");
}

function compareProducts(locale, copy, config, depth, opts = {}) {
  const socialCta = href(locale, "subscribe", depth);
  const directCta = waLink(config, t(copy, "product.direct_prefill"));
  // The versions of BabyRock Social this language writes copy for, then BabyRock Direct. The grid is
  // the same two-column layout the section already uses, so four levels read as two rows and nothing
  // else moves. The amount is the catalogue's, for the country this language speaks to.
  const country = LOCALES[locale].country;
  const tierCard = (tier, index) => {
    const price = formatEuro(catalogue.centsHt(tier.id, "month", country), locale);
    const inherits = index === 0 ? "" : `<p class="compare-tag">${esc(t(copy, `product.social_${tier.id}_inherits`))}</p>`;
    return `<article class="compare-card live" id="${tier.id}">
      <div class="compare-head">
        <img src="${asset(depth, "logos/social-icon.svg")}" alt="" width="52" height="52" decoding="async">
        <h2 class="compare-name">${esc(t(copy, `product.social_${tier.id}_name`))}</h2>
      </div>
        <p class="compare-price">${esc(price)} <small>${esc(t(copy, "product.price_unit"))}</small></p>
      <p class="compare-price-note"><strong>${esc(t(copy, `product.social_${tier.id}_trial`))}</strong></p>
      ${inherits}
      <ul class="compare-features">${tierFeatures(copy, `product.social_${tier.id}`, opts.long ? tier.featuresLong : tier.features)}</ul>
      ${
        opts.long || index === 0
          ? ""
          : `<a class="compare-more" href="${href(locale, "services", depth)}#${tier.id}">${esc(t(copy, "product.and_more"))}</a>`
      }
      <a class="btn btn-coral compare-cta" href="${subscribeHref(locale, depth, tier.id)}">${esc(t(copy, `product.social_${tier.id}_cta`))}</a>
    </article>`;
  };
  return `<div class="compare">
    ${presentedTiers(copy, config)
      .map((tier, index) => tierCard(tier, index))
      .join("\n    ")}
    <article class="compare-card soon">
      <div class="compare-head">
        <img src="${asset(depth, "logos/direct-icon.svg")}" alt="" width="52" height="52" decoding="async">
        <h2 class="compare-name">${esc(t(copy, "product.direct_name"))} <em>${esc(t(copy, "product.direct_status"))}</em></h2>
      </div>
      <p class="compare-tag">${esc(t(copy, "product.direct_tag"))}</p>
      <a class="btn btn-ghost compare-cta" href="${directCta}" target="_blank" rel="noopener">${esc(t(copy, "products.direct_cta"))}</a>
      <ul class="compare-features">${featureItems(copy, "product.direct", 4, true)}</ul>
      <p class="compare-later">${esc(t(copy, "product.direct_later"))}</p>
    </article>
  </div>`;
}

function servicesPage(locale, copy, config, depth) {
  return `
  <section class="wrap section products-page">
    <p class="kicker">${esc(t(copy, "nav.services"))}</p>
    <h1 class="products-title">${esc(t(copy, "products.headline"))}</h1>
    <div class="lead products-lead">${paras(t(copy, "products.lead"))}</div>
    ${compareProducts(locale, copy, config, depth, { long: true })}
    <p class="note">${esc(t(copy, "price.vat_note"))}</p>
  </section>
  ${tradeLinksSection(locale, copy, depth)}
  ${comparisonLinksSection(locale, copy, depth)}`;
}

/**
 * Ticket 26: like the trade and city pages, the comparison pages are landing pages nothing in the
 * navigation points at, so the services page lists them and the sitemap carries them. A language with
 * no comparison of its own publishes no block.
 */
function comparisonLinksSection(locale, copy, depth) {
  const pages = COMPARISON_PAGES.filter((row) => row.locale === locale);
  if (!pages.length) return "";
  return `<section class="wrap section">
    <h2>${esc(t(copy, "compare.more_title"))}</h2>
    <p>${esc(t(copy, "compare.more_lead"))}</p>
    <p class="cta-row">${pages
      .map((row) => `<a class="btn btn-ghost" href="${comparisonHref(locale, row.id, depth)}">${esc(row.title)}</a>`)
      .join("\n      ")}</p>
  </section>`;
}

/**
 * Ticket 25: the trade and city pages are landing pages, so nothing in the navigation points at them
 * and without this block the whole set would be orphans a crawler reaches only through the sitemap.
 * The services page is where a reader is already choosing what we do, so the list lives there, one
 * line per page, and a language with no page of its own publishes no block.
 */
function tradeLinksSection(locale, copy, depth) {
  const pages = TRADE_PAGES.filter((page) => page.locale === locale);
  if (!pages.length) return "";
  return `<section class="wrap section">
    <h2>${esc(t(copy, "trade.more_title"))}</h2>
    <p class="cta-row">${pages
      .map(
        (page) =>
          `<a class="btn btn-ghost" href="${tradeHref(locale, page, depth)}">${esc(tradeLinkLabel(locale, copy, page))}</a>`,
      )
      .join("\n      ")}</p>
  </section>`;
}

/** "Peluquerías en Sant Cugat del Vallès": the trade, the joining word and the city, from the data. */
function tradeLinkLabel(locale, copy, page) {
  return `${page.trade.names[locale]} ${t(copy, "trade.title_between")} ${page.city.names[locale]}`;
}

function tradeTitle(locale, copy, page) {
  return `${t(copy, "trade.title_before")} ${page.trade.names[locale]} ${t(copy, "trade.title_between")} ${page.city.names[locale]}`;
}

/**
 * Ticket 25, one page per trade and city. Everything specific to the pair (the names, the slug and
 * the local angle) comes from `site/content/trades.json`; the sentences around it come from the
 * language file; the money and the cadence come from the catalogue; and the quiet-week line is the
 * one the app itself publishes (`src/lib/social/evergreen.ts`). Nothing on the page is a local fact
 * nobody checked: the angle says what the trade's own week looks like in that city, with no figure,
 * no ranking and no promise, and the page's own numbers are the catalogue's.
 */
function tradePage(locale, copy, config, depth, page) {
  const country = LOCALES[locale].country;
  const city = page.city.names[locale];
  const ht = formatEuro(catalogue.centsHt("lite", "month", country), locale);
  const ttc = formatEuro(catalogue.centsTtc("lite", "month", country), locale);
  // What each level publishes a month, from `MONTHLY_POSTS_BY_TIER`. A level the catalogue states no
  // figure for says exactly that instead of borrowing a neighbour's number.
  const posts = catalogue.tiers
    .map((tierId) => {
      const monthly = catalogue.monthlyPosts[tierId];
      const line =
        monthly === null || monthly === undefined
          ? esc(t(copy, "trade.posts_none"))
          : `${esc(String(monthly))} ${esc(t(copy, "trade.posts_unit"))}`;
      return `<li>${checkIcon(false)}<div><strong>${esc(t(copy, `product.social_${tierId}_name`))}</strong><span>${line}</span></div></li>`;
    })
    .join("");
  const house = houseLineFor(HOUSE_LINES, locale, { shop: t(copy, "trade.shop_placeholder"), city });
  const levels = catalogue.tiers
    .map(
      (tierId) =>
        `<a class="btn btn-ghost" href="${href(locale, `price_${tierId}`, depth)}">${esc(t(copy, `product.social_${tierId}_name`))}</a>`,
    )
    .join("\n      ");
  return `
  <section class="wrap section products-page">
    <p class="kicker">${esc(t(copy, "nav.services"))}</p>
    <h1 class="products-title">${esc(tradeTitle(locale, copy, page))}</h1>
    <div class="lead products-lead">${paras(t(copy, "trade.lead"))}</div>
    <h2>${esc(t(copy, "trade.angle_title"))}</h2>
    <div class="prose">${paras(page.angle)}</div>
    <h2>${esc(t(copy, "trade.publishes_title"))}</h2>
    <p><strong>${esc(page.trade.publishes[locale])}</strong></p>
    ${paras(t(copy, "trade.publishes_rule"))}
    <p class="tiny">${esc(t(copy, "trade.posts_title"))}</p>
    <ul class="compare-features">${posts}</ul>
    <h2>${esc(t(copy, "trade.house_title"))}</h2>
    ${paras(t(copy, "trade.house_rule"))}
    <p class="note">${esc(house)}</p>
  </section>
  <section class="section section-alt">
    <div class="wrap">
      <h2>${esc(t(copy, "trade.price_title"))}</h2>
      <p class="trade-price">${inlineLinks(locale, t(copy, "trade.price_line"), depth)}</p>
      <p class="trade-price-ttc"><strong>${esc(ttc)} ${esc(t(copy, "price.ttc_label"))}.</strong> ${esc(
        t(copy, "price.vat_note"),
      )}</p>
      <p class="cta-row">
        <a class="btn btn-coral" href="${subscribeHref(locale, depth, "lite")}">${esc(t(copy, "product.social_lite_cta"))}</a>
        <a class="btn btn-wa" href="${auditHref(locale, depth)}">${waIcon()} ${esc(t(copy, "home.audit_cta"))}</a>
        ${levels}
      </p>
      <p>${inlineLinks(locale, t(copy, "trade.audit_line"), depth)}</p>
    </div>
  </section>`;
}

/**
 * Ticket 25, the structured data of a trade and city page: the entry level as a `Service` for the
 * city the page is about, at the catalogue's own price for the page's country. `areaServed` is a city
 * and not a country, because that is the intention the page answers.
 */
function tradePageLd(locale, copy, page) {
  const country = LOCALES[locale].country;
  const url = absTradeUrl(locale, page);
  const name = tradeTitle(locale, copy, page);
  const offer = (interval, unitText) => ({
    "@type": "Offer",
    name: `${t(copy, "product.social_lite_name")} (${interval})`,
    price: (catalogue.centsHt("lite", interval, country) / 100).toFixed(2),
    priceCurrency: "EUR",
    valueAddedTaxIncluded: false,
    availability: "https://schema.org/InStock",
    url,
    unitText,
  });
  return [
    {
      "@type": "Service",
      name,
      serviceType: name,
      description: t(copy, "trade.lead").split(/\n\s*\n/)[0],
      provider: { "@id": `${SITE}/#org` },
      areaServed: { "@type": "City", name: page.city.names[locale] },
      url,
      offers: [offer("month", "MONTH"), offer("year", "YEAR")],
    },
  ];
}

/**
 * Ticket 26, one comparison page: the claims about the other party, each one carrying that party's
 * own page and the date it was read, then what that party does better, then what we do, then the two
 * ways to start, the free audit and the trial. No figure of ours is typed here: the amount comes from
 * the catalogue through `{price:...}`, checked by `checkLevelLine` before a page is written, and the
 * competitor's amounts are the quotes its own page publishes, dated like every other claim.
 */
function comparisonPage(locale, copy, config, depth, page) {
  const country = LOCALES[locale].country;
  const claims = page.claims
    .map((claim) => {
      const sources = claim.sources
        .map(
          (source) =>
            `<a href="${esc(source.url)}" rel="noopener" target="_blank">${esc(source.label)}</a>, ${esc(
              t(copy, "compare.read_on"),
            )} ${esc(formatReadOn(source.readOn, locale))}`,
        )
        .join(" · ");
      return `<li><p>${esc(claim.text)}</p>
      <p class="tiny">${esc(t(copy, "compare.source_label"))} ${sources}.</p></li>`;
    })
    .join("\n      ");
  const better = page.better
    .map((line) => `<li>${checkIcon(false)}<div><span>${esc(line)}</span></div></li>`)
    .join("");
  const others = COMPARISON_PAGES.filter((row) => row.locale === locale && row.id !== page.id);
  const related = others.length
    ? `<h2>${esc(t(copy, "compare.related_title"))}</h2>
    <p class="cta-row">${others
      .map((row) => `<a class="btn btn-ghost" href="${comparisonHref(locale, row.id, depth)}">${esc(row.title)}</a>`)
      .join("\n      ")}</p>`
    : "";
  const levels = catalogue.tiers
    .map(
      (tierId) =>
        `<a class="btn btn-ghost" href="${href(locale, `price_${tierId}`, depth)}">${esc(t(copy, `product.social_${tierId}_name`))}</a>`,
    )
    .join("\n      ");
  const ttc = formatEuro(catalogue.centsTtc("lite", "month", country), locale);
  return `
  <section class="wrap section products-page">
    <p class="kicker">${esc(t(copy, "compare.kicker"))}</p>
    <h1 class="products-title">${esc(page.title)}</h1>
    <div class="lead products-lead">${paras(page.lead)}</div>
    <p class="note">${esc(t(copy, "compare.method_lead"))} ${esc(page.alternative)}. ${esc(t(copy, "compare.method"))}</p>
    <h2>${esc(t(copy, "compare.claims_title"))}</h2>
    <ol class="claims">${claims}</ol>
    <h2>${esc(t(copy, "compare.better_title"))}</h2>
    <ul class="compare-features">${better}</ul>
    <h2>${esc(t(copy, "compare.our_title"))}</h2>
    ${paras(t(copy, "compare.our_body"))}
    ${related}
  </section>
  <section class="section section-alt">
    <div class="wrap">
      <h2>${esc(t(copy, "compare.levels_title"))}</h2>
      <p class="cta-row">${levels}</p>
      <h2>${esc(t(copy, "compare.price_title"))}</h2>
      <p class="compare-price">${inlineLinks(locale, t(copy, "compare.price_line"), depth)}</p>
      <p class="compare-price-ttc"><strong>${esc(ttc)} ${esc(t(copy, "price.ttc_label"))}.</strong> ${esc(
        t(copy, "price.vat_note"),
      )}</p>
      <p class="cta-row">
        <a class="btn btn-coral" href="${subscribeHref(locale, depth, "lite")}">${esc(t(copy, "product.social_lite_cta"))}</a>
        <a class="btn btn-wa" href="${auditHref(locale, depth)}">${waIcon()} ${esc(t(copy, "home.audit_cta"))}</a>
      </p>
      <p>${inlineLinks(locale, t(copy, "compare.audit_line"), depth)}</p>
    </div>
  </section>`;
}

/**
 * Ticket 22, one price page per level and per country. The amount is the catalogue's for the country
 * the language speaks to, never a figure the copy carries: the copy may restate it, but only through
 * a `{price:<level>_month}` token the build fills, and `checkPricePageCopy` refuses one typed by hand.
 * The page reuses the product's own level copy, so a level that gains a surface later changes here
 * without a second description to keep in step.
 */
function pricePage(locale, copy, config, depth, tierId) {
  const country = LOCALES[locale].country;
  const tiers = presentedTiers(copy, config);
  const index = tiers.findIndex((tier) => tier.id === tierId);
  const tier = tiers[index];
  const level = `price.${tierId}`;
  const ht = formatEuro(catalogue.centsHt(tierId, "month", country), locale);
  const ttc = formatEuro(catalogue.centsTtc(tierId, "month", country), locale);
  const levels = tiers
    .map((row) => {
      const current = row.id === tierId ? ' aria-current="page"' : "";
      return `<a class="btn btn-ghost" href="${href(locale, `price_${row.id}`, depth)}"${current}>${esc(
        t(copy, `product.social_${row.id}_name`),
      )}</a>`;
    })
    .join("\n        ");
  return `
  <section class="wrap section products-page">
    <p class="kicker">${esc(t(copy, "price.kicker"))}</p>
    <h1 class="products-title">${esc(t(copy, `${level}_title`))}</h1>
    <div class="lead products-lead">${paras(t(copy, `${level}_lead`))}</div>
    <div class="compare">
      <article class="compare-card live">
        <div class="compare-head">
          <img src="${asset(depth, "logos/social-icon.svg")}" alt="" width="52" height="52" decoding="async">
          <h2 class="compare-name">${esc(t(copy, `product.social_${tierId}_name`))}</h2>
        </div>
        <p class="compare-price">${esc(ht)}<small> ${esc(t(copy, "product.price_unit"))} ${esc(
          t(copy, "price.ht_label"),
        )}</small></p>
        <p class="compare-price-note"><strong>${esc(ttc)} ${esc(t(copy, "price.ttc_label"))}.</strong> ${esc(
          t(copy, "price.vat_note"),
        )}</p>
        <p class="compare-price-note">${esc(t(copy, `home.tier_${tierId}_annual`))}</p>
        <p class="compare-price-note"><strong>${esc(t(copy, `product.social_${tierId}_trial`))}</strong></p>
        <a class="btn btn-coral compare-cta" href="${subscribeHref(locale, depth, tierId)}">${esc(
          t(copy, `product.social_${tierId}_cta`),
        )}</a>
        <a class="btn btn-wa compare-cta" href="${auditHref(locale, depth)}">${waIcon()} ${esc(
          t(copy, "home.audit_cta"),
        )}</a>
        <p class="compare-later">${esc(t(copy, "price.audit_line"))}</p>
      </article>
      <article class="compare-card live">
        <p class="compare-tag">${esc(t(copy, "price.for_title"))}</p>
        ${paras(t(copy, `${level}_for`))}
        <p class="compare-tag">${esc(t(copy, "price.change_title"))}</p>
        ${paras(t(copy, `${level}_change`))}
      </article>
    </div>
  </section>
  <section class="section section-alt">
    <div class="wrap">
      <h2>${esc(t(copy, "price.included_title"))}</h2>
      ${index === 0 ? "" : `<p class="compare-tag">${esc(t(copy, `product.social_${tierId}_inherits`))}</p>`}
      <ul class="compare-features">${tierFeatures(copy, `product.social_${tierId}`, tier.featuresLong)}</ul>
    </div>
  </section>
  <section class="wrap section">
    <h2>${esc(t(copy, "price.not_included_title"))}</h2>
    ${paras(t(copy, `${level}_not_included`))}
    <p class="note"><strong>${esc(t(copy, "home.not_included_title"))}</strong> ${esc(t(copy, "home.not_included"))}</p>
    <h2>${esc(t(copy, "price.trial_title"))}</h2>
    ${paras(t(copy, `${level}_trial`))}
    <h2>${esc(t(copy, "price.levels_title"))}</h2>
    <p class="cta-row">
        ${levels}
        <a class="btn btn-ghost" href="${href(locale, "services", depth)}">${esc(t(copy, "nav.services"))}</a>
        <a class="btn btn-coral" href="${subscribeHref(locale, depth, tierId)}">${esc(
          t(copy, `product.social_${tierId}_cta`),
        )}</a>
    </p>
  </section>`;
}

/**
 * Ticket 22, the structured data of a price page: the level as a `Service` with the month and the
 * year it is sold at, both read from the catalogue for the page's country. The site's amounts are HT,
 * so the offers say so instead of letting a crawler read a figure the card is not charged.
 */
function pricePageLd(locale, copy, tierId) {
  const country = LOCALES[locale].country;
  const name = t(copy, `product.social_${tierId}_name`);
  const url = absUrl(locale, `price_${tierId}`);
  const offer = (interval, unitText) => ({
    "@type": "Offer",
    name: `${name} (${interval})`,
    price: (catalogue.centsHt(tierId, interval, country) / 100).toFixed(2),
    priceCurrency: "EUR",
    valueAddedTaxIncluded: false,
    availability: "https://schema.org/InStock",
    url,
    unitText,
  });
  return [
    {
      "@type": "Service",
      name,
      serviceType: t(copy, pricePageKey(tierId, "title")),
      description: t(copy, pricePageKey(tierId, "lead")).split(/\n\s*\n/)[0],
      provider: { "@id": `${SITE}/#org` },
      areaServed: country,
      url,
      offers: [offer("month", "MONTH"), offer("year", "YEAR")],
    },
  ];
}

/**
 * Ticket 08, the free listing audit: the page that carries the form.
 *
 * The result is written by the endpoint, in the language of the page, and this page prints what it is
 * handed: the score, the sentences of each block and the three fixes. No sentence of the audit is
 * duplicated here, so the words a visitor reads and the words in the email come from one place. The
 * page carries the labels, the consent line and the honest failure text as `data-` attributes, which
 * is what the script reads.
 */
function auditPage(locale, copy, config, depth) {
  const label = (key) => esc(t(copy, key));
  return `
  <section class="wrap section products-page">
    <p class="kicker">${label("audit.kicker")}</p>
    <h1 class="products-title">${label("audit.title")}</h1>
    <div class="lead products-lead">${paras(t(copy, "audit.lead"))}</div>
    <form class="sim-card audit-form" data-audit
      data-loading="${label("audit.loading")}"
      data-error="${label("audit.error")}"
      data-fixes-heading="${label("audit.fixes_heading")}"
      data-parts-heading="${label("audit.parts_heading")}"
      data-emailed="${label("audit.emailed")}"
      data-not-emailed="${label("audit.not_emailed")}">
      <label for="audit-name">${label("audit.form_name")}</label>
      <input id="audit-name" name="name" required maxlength="120" autocomplete="organization" placeholder="${label("audit.form_name_ph")}">
      <label for="audit-city">${label("audit.form_city")}</label>
      <input id="audit-city" name="city" required maxlength="80" autocomplete="address-level2" placeholder="${label("audit.form_city_ph")}">
      <label for="audit-email">${label("audit.form_email")} <span class="tiny">${label("audit.form_email_hint")}</span></label>
      <input id="audit-email" name="email" type="email" maxlength="200" autocomplete="email">
      <label class="audit-consent"><input type="checkbox" name="consent"> ${label("audit.form_consent")}</label>
      <button class="btn btn-coral" type="submit">${label("audit.form_submit")}</button>
      <p class="tiny">${label("audit.form_note")} <a href="${href(locale, "privacy", depth)}">${esc(
        t(copy, "footer.privacy"),
      )}</a></p>
    </form>
    <div class="card audit-result" data-audit-result hidden aria-live="polite" style="margin-top:1.2rem"></div>
  </section>`;
}

/**
 * The audit as structured data: a service that costs nothing, in the two countries it serves. The
 * `Offer` at zero is the honest one: the audit is free and it obliges nobody.
 */
function auditPageLd(locale, copy, config) {
  return [
    {
      "@type": "Service",
      name: t(copy, "audit.title"),
      description: t(copy, "audit.lead").split(/\n\s*\n/)[0],
      provider: { "@id": `${SITE}/#org` },
      areaServed: ["ES", "FR"],
      url: absUrl(locale, "audit"),
      isAccessibleForFree: true,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "EUR",
        url: absUrl(locale, "audit"),
      },
    },
  ];
}

function subscribePage(locale, copy, config, depth) {
  const country = LOCALES[locale].country;
  const shown = presentedTiers(copy, config);
  const featured = shown.find((tier) => tier.featured) ?? shown[0];
  // Without JavaScript the button still starts the level the page presents first. With it, the
  // chosen card wins (see site.js).
  const pay = payLink(config, payPlanId(featured.id, country), locale);
  // The other door: three of the reviews the shop already has, no card and nothing to cancel. It is
  // what the trial section of the home page promises, so the page that sells has to offer it.
  const trial = payLink(config, "free_trial", locale);
  const waDigits = String(config.whatsapp || "").replace(/\D/g, "");
  return `
  <section class="wrap section">
    <h1>${esc(t(copy, "sub.headline"))}</h1>
    <div class="lead">${paras(t(copy, "sub.lead"))}</div>
    <p class="note">${esc(t(copy, "product.social_name"))}: ${esc(t(copy, "product.social_status"))}. ${esc(t(copy, "product.direct_name"))}: ${esc(t(copy, "product.direct_status"))}.</p>
    <fieldset class="price-grid plan-choices" data-plan-choices>
      <legend class="sr-only">${esc(t(copy, "sub.form_plan"))}</legend>
      ${shown
        .map(
          (tier) => `<label class="price-card plan-choice${tier.featured ? " recommended" : ""}">
        <input type="radio" name="plan" value="${payPlanId(tier.id, country)}"${tier === featured ? " checked" : ""}>
        ${tier.featured ? `<span class="badge">${esc(t(copy, "sub.recommended"))}</span>` : ""}
        <h3>${esc(t(copy, `product.social_${tier.id}_name`))}</h3>
        <p class="amount">${esc(formatEuro(catalogue.centsHt(tier.id, "month", country), locale))} <small>${esc(t(copy, "product.price_unit"))}</small></p>
        <p>${esc(t(copy, `home.tier_${tier.id}_annual`))}</p>
        <p>${esc(t(copy, `product.social_${tier.id}_trial`))}</p>
      </label>`,
        )
        .join("")}
    </fieldset>
    ${betaLine(copy)}
    <p class="cta-row" style="margin:1.25rem 0 0">
      ${pay ? `<a class="btn btn-coral" href="${esc(pay)}" data-pay-cta data-pay-base="${esc(pay)}">${esc(t(copy, "sub.cta_pay"))}</a>` : ""}
      ${trial ? `<a class="btn btn-ghost" href="${esc(trial)}">${esc(t(copy, "sub.cta_trial"))}</a>` : ""}
      <a class="btn btn-wa" href="${waLink(config, t(copy, "wa.prefill"))}" target="_blank" rel="noopener">${waIcon()} ${esc(t(copy, "sub.cta_wa"))}</a>
    </p>
    <form class="sim-card form-grid" data-interest-form data-api="${esc(config.apiUrl || "https://app.babyrock.ai")}" data-pay="${esc(pay)}" data-wa="${esc(waDigits)}" data-mail="${esc(config.email)}" data-msg-need-contact="${esc(t(copy, "sub.form_need_contact"))}" data-msg-need-email="${esc(t(copy, "sub.form_need_email"))}" data-msg-sending="${esc(t(copy, "sub.form_sending"))}" data-msg-sent="${esc(t(copy, "sub.form_sent"))}" data-msg-error="${esc(t(copy, "sub.form_error"))}" style="margin-top:1.5rem">
      <label>${esc(t(copy, "sub.form_name"))}<input name="business" data-label="${esc(t(copy, "sub.form_name"))}"></label>
      <label>${esc(t(copy, "sub.form_city"))}<input name="city" data-label="${esc(t(copy, "sub.form_city"))}"></label>
      <label>${esc(t(copy, "sub.form_listing"))}<input name="listing" data-label="${esc(t(copy, "sub.form_listing"))}"></label>
      <label>${esc(t(copy, "sub.form_email"))}<input name="email" type="email" data-label="${esc(t(copy, "sub.form_email"))}"></label>
      <label>${esc(t(copy, "sub.form_wa"))}<input name="whatsapp" data-label="${esc(t(copy, "sub.form_wa"))}"></label>
      <label>${esc(t(copy, "sub.form_question"))}<textarea name="question" rows="3" maxlength="1000" data-label="${esc(t(copy, "sub.form_question"))}"></textarea></label>
      <label>${esc(t(copy, "sub.form_revenue"))}<input name="revenue" inputmode="numeric"></label>
      <p class="form-error" data-form-error hidden></p>
      <p class="form-sent" data-form-sent hidden></p>
      <div class="cta-row">
        ${pay ? `<button class="btn btn-coral" name="channel" value="pay" type="submit">${esc(t(copy, "sub.cta_pay"))}</button>` : ""}
        <button class="btn btn-wa" name="channel" value="whatsapp" type="submit">${waIcon()} ${esc(t(copy, "sub.cta_wa"))}</button>
        <button class="btn btn-ghost" name="channel" value="email" type="submit">${esc(t(copy, "sub.cta_email"))}</button>
      </div>
      <p><a class="form-fallback" data-form-fallback hidden>${esc(t(copy, "sub.form_fallback_mail"))}</a></p>
    </form>
    ${paras(t(copy, "sub.after"))}
  </section>`;
}

function accountPage(locale, copy, config, depth) {
  const wa = waLink(config, "BAJA");
  return `
  <section class="wrap section prose">
    <h1>${esc(t(copy, "account.headline"))}</h1>
    <div class="lead">${paras(t(copy, "account.lead"))}</div>
    <h2>${esc(t(copy, "account.contacts_title"))}</h2>
    ${paras(t(copy, "account.contacts"))}
    <h2>${esc(t(copy, "account.invoices_title"))}</h2>
    ${paras(t(copy, "account.invoices"))}
    <h2>${esc(t(copy, "account.pay_title"))}</h2>
    ${paras(t(copy, "account.pay"))}
    <h2>${esc(t(copy, "account.cancel_title"))}</h2>
    ${paras(t(copy, "account.cancel"))}
    <h2>${esc(t(copy, "account.listing_title"))}</h2>
    ${paras(t(copy, "account.listing"))}
    <p><a class="btn btn-coral" href="${wa}">${esc(t(copy, "account.cta_cancel"))}</a></p>
  </section>`;
}

function legalPage(locale, page, copy) {
  const md = loadLegalMarkdown(locale, page);
  const manage =
    page === "cookies"
      ? `<p><button type="button" class="btn btn-ghost" data-cookie-open>${esc(t(copy, "cookies.manage") || t(copy, "footer.cookies"))}</button></p>`
      : "";
  if (md) {
    return `<section class="wrap section prose legal-prose">${legalBody(md)}${manage}</section>`;
  }
  const headKey = page === "legal" ? "legal.headline" : `${page}.headline`;
  const bodyKey = page === "legal" ? "legal.body" : `${page}.body`;
  return `<section class="wrap section prose"><h1>${esc(t(copy, headKey))}</h1>${paras(t(copy, bodyKey))}${manage}</section>`;
}

/**
 * What a crawler must find on every page (ticket 20): one canonical address, one alternate per
 * language plus x-default, and structured data that parses. Checked where the page is written, so a
 * template edit that drops one of them fails the build instead of shipping a page nobody can index.
 */
function checkPage(path, content, languages = Object.keys(LOCALES)) {
  const label = path.replace(`${outDir}/`, "");
  // The BETA mark belongs to the frame, not to one section: if a template edit drops it from the
  // header of any generated page, the build fails here instead of shipping an unmarked site.
  if (content.includes('<header class="site-header">') && !content.includes('class="beta-pill"')) {
    throw new Error(`page written without the BETA mark: ${label}`);
  }
  const canonical = content.match(/<link rel="canonical" href="[^"]+">/g) ?? [];
  if (canonical.length !== 1) {
    throw new Error(`${label} carries ${canonical.length} canonical links, expected exactly one`);
  }
  for (const code of languages) {
    if (!content.includes(`<link rel="alternate" hreflang="${LOCALES[code].html}" href=`)) {
      throw new Error(`${label} carries no hreflang="${LOCALES[code].html}" alternate`);
    }
  }
  if (!content.includes('<link rel="alternate" hreflang="x-default" href=')) {
    throw new Error(`${label} carries no x-default alternate`);
  }
  const blocks = content.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) ?? [];
  if (!blocks.length) throw new Error(`${label} carries no structured data`);
  for (const block of blocks) {
    const json = block
      .replace(/^<script type="application\/ld\+json">/, "")
      .replace(/<\/script>$/, "");
    try {
      JSON.parse(json);
    } catch (e) {
      throw new Error(`${label} carries structured data that does not parse: ${e.message}`);
    }
  }
}

function write(path, content, languages) {
  if (path.endsWith(".html")) checkPage(path, content, languages);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function pagePath(locale, page) {
  const slug = LOCALES[locale].slugs[page];
  return slug ? join(outDir, locale, slug, "index.html") : join(outDir, locale, "index.html");
}

/**
 * Ticket 22, before a price page is written: every language writes all four, and the copy around the
 * amount does not type an amount of its own. A missing key would publish a page with a hole where a
 * shop reads what it pays, which is the Enterprise hole of 24 September in a new place; a typed
 * amount is the drift the catalogue exists to prevent, so it is refused the same way the yearly
 * lines are (see `checkPriceLines`).
 */
function checkPricePageCopy(raw, file, locale) {
  const problems = [];
  for (const key of PRICE_PAGE_SHARED_KEYS) {
    if (t(raw, key).trim() === "") problems.push(`- ${file} has no ${key}`);
  }
  for (const tierId of catalogue.tiers) {
    const where = absUrl(locale, `price_${tierId}`).replace(SITE, "");
    for (const key of PRICE_PAGE_LEVEL_KEYS) {
      const name = pricePageKey(tierId, key);
      const text = t(raw, name);
      if (text.trim() === "") {
        problems.push(`- ${file} has no ${name}, so the ${tierId} price page would publish a hole`);
        continue;
      }
      // Stricter than the yearly lines: on the page a shop reads the price from, an amount typed by
      // hand is refused even next to a token, because a second, handwritten figure is exactly the
      // drift between the site and the invoice this catalogue exists to prevent.
      if (typesAnAmount(text)) {
        problems.push(
          `- ${file} ${name} states "${String(text).trim()}" by hand. The price on ${where} has to ` +
            `come from the catalogue: write {price:${tierId}_month} instead of the amount.`,
        );
      }
    }
  }
  if (problems.length) {
    throw new Error(`The price pages cannot be published:\n${problems.join("\n")}`);
  }
}

/** Ticket 08: every language writes the whole audit page before the form can be published. */
function checkAuditPageCopy(raw, file) {
  const missing = AUDIT_PAGE_KEYS.filter((key) => t(raw, key).trim() === "");
  if (missing.length) {
    throw new Error(
      `${file} cannot publish the audit page: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} empty, and the form would carry a hole`,
    );
  }
}

/**
 * Ticket 09, boxes one and three: every guide ends with the level that covers its subject and with
 * the free audit, and neither sentence is allowed to drift from the catalogue. All ten guides are
 * about the Google profile and its reviews, and Lite already covers the whole profile, Maps and its
 * reviews, so the block names Lite; the sentence carries the link and the amount, and this check
 * refuses a block whose link and whose amount name two different levels. A sentence that types an
 * amount by hand is refused the same way a price page is (see `checkPricePageCopy`).
 */
const GUIDE_BLOCK_KEYS = ["guides.covered", "guides.audit_line"];
/** `[label]([[page:price_lite]])`, the level link the block has to carry. */
const GUIDE_LEVEL_LINK = /\[[^\]]+\]\(\[\[page:price_([a-z]+)\]\]\)/;
/** `{price:lite_month}` or `{price_ttc:lite_month}`, the amount, which has to be the catalogue's. */
const GUIDE_LEVEL_TOKEN = /\{price(?:_ttc)?:([a-z]+)_month\}/;

/**
 * A line of copy that names a level and quotes its amount, wherever it appears: the closing block of
 * a guide (ticket 09) and the price line of a trade and city page (ticket 25). The link and the token
 * have to name the same level, and the amount has to come from the catalogue. One rule written once,
 * so the two surfaces cannot drift apart.
 */
function checkLevelLine(text, { file, key, hint }) {
  const problems = [];
  if (text.trim() === "") {
    problems.push(`- ${file} has no ${key}, so the page that carries it would publish a hole where the price is`);
    return problems;
  }
  const link = text.match(GUIDE_LEVEL_LINK);
  const token = text.match(GUIDE_LEVEL_TOKEN);
  if (!link) {
    problems.push(`- ${file} ${key} names no level price page: write [BabyRock Social Lite]([[page:price_lite]]) ${hint}`);
  } else if (!catalogue.tiers.includes(link[1])) {
    problems.push(
      `- ${file} ${key} links the "${link[1]}" level, which the catalogue does not sell. It has ${catalogue.tiers.join(", ")}.`,
    );
  }
  if (!token) {
    problems.push(
      `- ${file} ${key} quotes no monthly amount from the catalogue: write {price:${link ? link[1] : "lite"}_month} so the amount comes from the catalogue`,
    );
  } else if (link && link[1] !== token[1]) {
    problems.push(
      `- ${file} ${key} links the ${link[1]} level and quotes the ${token[1]} price. The link and the amount have to name the same level.`,
    );
  }
  if (typesAnAmount(text)) {
    problems.push(
      `- ${file} ${key} states "${String(text).trim()}" by hand. The amount has to come from the catalogue: write {price:lite_month} instead of the amount.`,
    );
  }
  return problems;
}

function checkGuideCopy(raw, file) {
  const problems = [];
  for (const key of GUIDE_BLOCK_KEYS) {
    // `guides.covered` is refused by `checkLevelLine`, which can say which level and which amount the
    // line has to carry; the other key only has to be there.
    if (key === "guides.covered") continue;
    if (t(raw, key).trim() === "") {
      problems.push(`- ${file} has no ${key}, so every guide would end without it`);
    }
  }
  const covered = t(raw, "guides.covered");
  problems.push(
    ...checkLevelLine(covered, {
      file,
      key: "guides.covered",
      hint: "so the guide ends on the level that covers its subject",
    }),
  );
  const auditLine = t(raw, "guides.audit_line");
  if (auditLine.trim() !== "" && !auditLine.includes("[[page:audit]]")) {
    problems.push(
      `- ${file} guides.audit_line does not link the free audit: write [[page:audit]] so the guide ends on it`,
    );
  }
  if (problems.length) {
    throw new Error(`The guides cannot be published:\n${problems.join("\n")}`);
  }
}

/**
 * Ticket 25, the copy the trade and city pages are built from. Every sentence a page carries is one
 * of these keys, so a language with a page and no words fails the build rather than publishing a
 * half-empty landing page; the price line and the audit line are held to the same rule as the guide
 * block, because they carry the same kind of link.
 */
const TRADE_PAGE_KEYS = [
  "trade.title_before",
  "trade.title_between",
  "trade.lead",
  "trade.angle_title",
  "trade.publishes_title",
  "trade.publishes_rule",
  "trade.posts_title",
  "trade.posts_unit",
  "trade.posts_none",
  "trade.house_title",
  "trade.house_rule",
  "trade.shop_placeholder",
  "trade.price_title",
  "trade.price_line",
  "trade.audit_line",
  "trade.more_title",
];

function checkTradePageCopy(raw, file, locales) {
  const problems = [];
  for (const key of TRADE_PAGE_KEYS) {
    // The price line is refused by `checkLevelLine`, which can say which level and which amount it
    // has to carry; the other keys only have to be there.
    if (key === "trade.price_line") continue;
    if (t(raw, key).trim() === "") {
      problems.push(`- ${file} has no ${key}, and the trade and city pages are published in ${locales.join(", ")}`);
    }
  }
  problems.push(
    ...checkLevelLine(t(raw, "trade.price_line"), {
      file,
      key: "trade.price_line",
      hint: "so the page says what the entry level costs",
    }),
  );
  const audit = t(raw, "trade.audit_line");
  if (audit.trim() !== "" && !audit.includes("[[page:audit]]")) {
    problems.push(`- ${file} trade.audit_line does not link the free audit: write [[page:audit]] so the page ends on it`);
  }
  if (problems.length) throw new Error(`The trade and city pages cannot be published:\n${problems.join("\n")}`);
}

/**
 * Ticket 26, the copy the comparison pages share, once per language. The claims, the sources and the
 * name of the other party come from the data file in the reader's own language; these keys are the
 * frame around them, so a language that publishes a comparison and has not written one of these fails
 * the build instead of publishing a page with a hole. The price line and the audit line follow the
 * same rule the guide block and the trade pages already follow.
 */
const COMPARISON_PAGE_KEYS = [
  "compare.kicker",
  "compare.method_lead",
  "compare.method",
  "compare.claims_title",
  "compare.source_label",
  "compare.read_on",
  "compare.better_title",
  "compare.our_title",
  "compare.our_body",
  "compare.levels_title",
  "compare.price_title",
  "compare.price_line",
  "compare.audit_line",
  "compare.related_title",
  "compare.more_title",
  "compare.more_lead",
];

function checkComparisonCopy(raw, file, locales) {
  const problems = [];
  for (const key of COMPARISON_PAGE_KEYS) {
    // The price line is refused by `checkLevelLine`, which can say which level and which amount the
    // line has to carry; the other keys only have to be there.
    if (key === "compare.price_line") continue;
    if (t(raw, key).trim() === "") {
      problems.push(`- ${file} has no ${key}, and the comparison pages are published in ${locales.join(", ")}`);
    }
  }
  problems.push(
    ...checkLevelLine(t(raw, "compare.price_line"), {
      file,
      key: "compare.price_line",
      hint: "so the page says what the entry level costs",
    }),
  );
  const audit = t(raw, "compare.audit_line");
  if (audit.trim() !== "" && !audit.includes("[[page:audit]]")) {
    problems.push(`- ${file} compare.audit_line does not link the free audit: write [[page:audit]] so the page ends on it`);
  }
  if (problems.length) throw new Error(`The comparison pages cannot be published:\n${problems.join("\n")}`);
}

const config = JSON.parse(readFileSync(join(contentDir, "config.json"), "utf8"));

/**
 * The grid the site states against the grid the catalogue prices, before a single page is written. A
 * disagreement has to stop the build with nothing published, not reach a customer as a price the
 * invoice will not honour.
 */
checkSiteGrid({
  tiers: config.tiers,
  catalogue,
  file: "site/content/config.json",
  pagesByCountry: pricePagesByCountry,
});

const css = readFileSync(join(srcDir, "styles.css"), "utf8");
const js = readFileSync(join(srcDir, "site.js"), "utf8");

mkdirSync(join(outDir, "css"), { recursive: true });
mkdirSync(join(outDir, "js"), { recursive: true });
writeFileSync(join(outDir, "css", "site.css"), css);
writeFileSync(join(outDir, "js", "site.js"), js);
if (existsSync(assetDir)) {
  cpSync(assetDir, join(outDir, "assets"), { recursive: true });
  for (const extra of ["portraits/rosalia-source.jpg", "portraits/ben-source.png"]) {
    const p = join(outDir, "assets", extra);
    try {
      unlinkSync(p);
    } catch {}
  }
  for (const f of ["favicon.ico", "apple-touch-icon.png"]) {
    const src = join(assetDir, f);
    if (existsSync(src)) copyFileSync(src, join(outDir, f));
  }
}
writeFileSync(join(outDir, "CNAME"), "www.babyrock.ai\n");
writeFileSync(join(outDir, ".nojekyll"), "");
writeFileSync(
  join(outDir, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`
);
const indexable = [
  "home",
  "services",
  "audit",
  "guides",
  "simulator",
  "how",
  "research",
  "about",
  "subscribe",
  "privacy",
  "terms",
  "legal",
  "cookies",
  "dpa",
  // Ticket 22: a price page is a page a shop finds in Google, so the sitemap has to carry it.
  ...catalogue.tiers.map((tier) => `price_${tier}`),
];
const sitemapUrls = Object.keys(LOCALES).flatMap((locale) => [
  ...indexable.map((page) => `  <url><loc>${absUrl(locale, page)}</loc></url>`),
  ...GUIDES.map((g) => `  <url><loc>${absGuideUrl(locale, g.id)}</loc></url>`),
  // Ticket 25: a trade and city page is a page a shop finds in Google, in the languages it exists in.
  ...TRADE_PAGES.filter((page) => page.locale === locale).map(
    (page) => `  <url><loc>${absTradeUrl(locale, page)}</loc></url>`,
  ),
  // Ticket 26: a comparison page is a page a shop finds by comparing, in the languages it exists in.
  ...COMPARISON_PAGES.filter((page) => page.locale === locale).map(
    (page) => `  <url><loc>${absComparisonUrl(locale, page.id)}</loc></url>`,
  ),
]);
writeFileSync(
  join(outDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.join("\n")}\n</urlset>\n`
);

for (const locale of Object.keys(LOCALES)) {
  const file = `site/content/${locale}.md`;
  // Checked before the amounts are filled, because a line that already carries one is the thing this
  // has to catch.
  const raw = parseMd(readFileSync(join(contentDir, `${locale}.md`), "utf8"));
  // The fourth level went missing because three copy files simply had no Enterprise keys, and
  // `presentedTiers` drops a level it cannot name: the page looked complete while it sold three.
  // Every language now has to name every level of the catalogue, so the hole fails the build.
  const unnamed = catalogue.tiers.filter((id) => t(raw, `product.social_${id}_name`).trim() === "");
  if (unnamed.length) {
    throw new Error(
      `${file} names no ${unnamed.join(", ")}: every language presents all ${catalogue.tiers.length} levels of the catalogue`
    );
  }
  // Every level the page presents carries its yearly figure, and that figure comes from the
  // catalogue: it is the number a shop compares between the cards.
  checkPriceLines(
    presentedTiers(raw, config).map((tier) => ({
      where: file,
      key: `home.tier_${tier.id}_annual`,
      page: absUrl(locale, "subscribe").replace(SITE, ""),
      text: t(raw, `home.tier_${tier.id}_annual`),
      token: `${tier.id}_year`,
    })),
  );
  checkPricePageCopy(raw, file, locale);
  checkAuditPageCopy(raw, file);
  checkGuideCopy(raw, file);
  // Ticket 25: a language only has to carry the trade page copy the day it publishes one.
  if (TRADE_LOCALES.includes(locale)) checkTradePageCopy(raw, file, TRADE_LOCALES);
  // Ticket 26: the same rule for the comparison pages.
  if (COMPARISON_LOCALES.includes(locale)) checkComparisonCopy(raw, file, COMPARISON_LOCALES);
  const copy = fillCopy(locale, file, raw);
  const pages = {
    home: { depth: 1, body: homePage(locale, copy, config, 1) },
    services: { depth: 2, body: servicesPage(locale, copy, config, 2) },
    guides: { depth: 2, body: guidesIndexPage(locale, copy, config, 2) },
    audit: { depth: 2, body: auditPage(locale, copy, config, 2) },
    simulator: { depth: 2, body: simulatorPage(locale, copy, 2) },
    how: { depth: 2, body: howPage(locale, copy, config, 2) },
    research: { depth: 2, body: researchPage(copy, config) },
    about: { depth: 2, body: aboutPage(copy, 2) },
    subscribe: { depth: 2, body: subscribePage(locale, copy, config, 2) },
    account: { depth: 2, body: accountPage(locale, copy, config, 2) },
    privacy: { depth: 2, body: legalPage(locale, "privacy", copy) },
    terms: { depth: 2, body: legalPage(locale, "terms", copy) },
    legal: { depth: 2, body: legalPage(locale, "legal", copy) },
    cookies: { depth: 2, body: legalPage(locale, "cookies", copy) },
    dpa: { depth: 2, body: legalPage(locale, "dpa", copy) },
  };
  for (const [page, meta] of Object.entries(pages)) {
    write(
      pagePath(locale, page),
      shell({
        locale,
        page,
        copy,
        config,
        depth: meta.depth,
        title: page === "services"
          ? `${t(copy, "product.social_name")} · ${t(copy, "product.direct_name")} | BabyRock`
          : page === "audit"
            ? `${t(copy, "audit.title")} | BabyRock`
            : ({ legal: "footer.legal", terms: "footer.terms", privacy: "footer.privacy", cookies: "footer.cookies", dpa: "footer.dpa" }[page]
              ? `${t(copy, { legal: "footer.legal", terms: "footer.terms", privacy: "footer.privacy", cookies: "footer.cookies", dpa: "footer.dpa" }[page])} | BabyRock`
              : t(copy, "meta.title")),
        description: page === "services"
          ? t(copy, "products.lead").split(/\n\s*\n/)[0]
          : page === "audit"
            ? t(copy, "audit.lead").split(/\n\s*\n/)[0]
            : t(copy, "meta.description"),
        body: meta.body,
        extraGraph: page === "audit" ? auditPageLd(locale, copy, config) : undefined,
      })
    );
  }
  // Ticket 22: the price pages, one per level, under the section word the market searches for. The
  // title and the description carry the amount too, and they carry the catalogue's own.
  for (const tierId of catalogue.tiers) {
    const page = `price_${tierId}`;
    write(
      pagePath(locale, page),
      shell({
        locale,
        page,
        copy,
        config,
        depth: 3,
        title: `${t(copy, pricePageKey(tierId, "title"))} | BabyRock`,
        description: t(copy, pricePageKey(tierId, "lead")).split(/\n\s*\n/)[0],
        body: pricePage(locale, copy, config, 3, tierId),
        extraGraph: pricePageLd(locale, copy, tierId),
      }),
    );
  }
  for (const g of GUIDES) {
    const gcopy = readGuide(locale, g.id);
    const slug = g.slugs[locale];
    const index = LOCALES[locale].slugs.guides;
    write(
      join(outDir, locale, index, slug, "index.html"),
      shell({
        locale,
        page: "guides",
        copy,
        config,
        depth: 3,
        title: `${gcopy.title} | BabyRock`,
        description: gcopy.dek,
        body: guideArticlePage(locale, copy, config, 3, g.id),
        langHref: (code) => guideHref(code, g.id, 3),
        canonicalUrl: absGuideUrl(locale, g.id),
        hreflangAbs: (code) => absGuideUrl(code, g.id),
        extraGraph: guideExtraLd(locale, g, gcopy),
        ogType: "article",
      })
    );
  }
  // Ticket 25: the trade and city pages, written from the data file. The page is published only in
  // the languages its own row names, and its alternates point at those and no others.
  for (const page of TRADE_PAGES.filter((row) => row.locale === locale)) {
    const languages = tradeLanguages(page);
    write(
      pagePath(locale, page.key),
      shell({
        locale,
        page: page.key,
        copy,
        config,
        depth: 2,
        title: `${tradeTitle(locale, copy, page)} | BabyRock`,
        description: t(copy, "trade.lead").split(/\n\s*\n/)[0],
        body: tradePage(locale, copy, config, 2, page),
        langHref: (code, d) => tradeHref(code, page, d),
        canonicalUrl: absTradeUrl(locale, page),
        hreflangAbs: (code) => absTradeUrl(code, page),
        extraGraph: tradePageLd(locale, copy, page),
        languages,
      }),
      languages,
    );
  }
  // Ticket 26: the comparison pages, written from the data file, one per row, with the alternates of
  // the languages that comparison is published in, and no figure of ours that the catalogue did not
  // fill. The page sits three levels down, `/es/alternativas/<slug>/`, the same depth as a price
  // page, so every relative link inside it climbs three.
  for (const page of COMPARISON_PAGES.filter((row) => row.locale === locale)) {
    const languages = comparisonLanguages(page.id);
    write(
      pagePath(locale, comparisonKey(page.id)),
      shell({
        locale,
        page: comparisonKey(page.id),
        copy,
        config,
        depth: 3,
        title: `${page.title} | BabyRock`,
        description: page.lead.split(/\n\s*\n/)[0],
        body: comparisonPage(locale, copy, config, 3, page),
        langHref: (code, d) => comparisonHref(code, page.id, d),
        canonicalUrl: absComparisonUrl(locale, page.id),
        hreflangAbs: (code) => absComparisonUrl(code, page.id),
        languages,
      }),
      languages,
    );
  }
}

/**
 * The root is the default locale's home page, served verbatim (ticket 17).
 *
 * GitHub Pages cannot answer 301/308 for `/`, so the old meta-refresh + `location.replace`
 * shell was the only "redirect" — a blank page for anyone without JS and a second, conflicting
 * signal next to `x-default`. Serving the default locale here (with its own `/es/` canonical,
 * which `shell()` writes) removes the conflict: `x-default`, the canonical and the visible page
 * all name the same URL. A true 301 needs the host (Cloudflare rule or leaving Pages); until then
 * this is the honest version.
 */
// The root is a language gate, not the Spanish page: a visitor lands on the language their browser
// asks for, and a choice they made earlier wins over the browser. Without JavaScript the links below
// still reach every language.
writeFileSync(join(outDir, "index.html"), langRedirectPage(), "utf8");

function langRedirectPage() {
  const links = Object.keys(LOCALES)
    .map((code) => `<a href="/${code}/">${LOCALES[code].name}</a>`)
    .join(" · ");
  const alternates = Object.keys(LOCALES)
    .map((code) => `<link rel="alternate" hreflang="${code}" href="${SITE}/${code}/">`)
    .join("\n");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BabyRock Social</title>
<link rel="canonical" href="${SITE}/es/">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE}/es/">
<script>
(function () {
  var supported = { es: 1, ca: 1, fr: 1, en: 1 };
  function stored() {
    try {
      var saved = localStorage.getItem("brmsocial.lang");
      return saved && supported[saved] ? saved : null;
    } catch (e) {
      return null;
    }
  }
  function fromBrowser() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || "").toLowerCase().split("-")[0];
      if (supported[code]) return code;
    }
    return null;
  }
  location.replace("/" + (stored() || fromBrowser() || "es") + "/");
})();
</script>
</head>
<body>
<p>${links}</p>
</body>
</html>
`;
}

/**
 * Ticket 20, the site-level checks, run once every page exists: the sitemap names every indexable
 * page and no private one, and the home page's own weight stays inside the mobile budget. The budget
 * counts every file the page can load, fonts included, so a heavy image added above the fold fails
 * the build the same way a broken price does.
 */
function readSitemapUrls() {
  const sitemap = readFileSync(join(outDir, "sitemap.xml"), "utf8");
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

function checkSitemap() {
  const urls = readSitemapUrls();
  for (const url of urls) {
    const rel = url.replace(`${SITE}/`, "");
    const file = rel.endsWith("/") ? join(outDir, rel, "index.html") : join(outDir, rel);
    if (!existsSync(file)) throw new Error(`the sitemap lists ${url}, but nothing was written at ${file}`);
  }
  for (const locale of Object.keys(LOCALES)) {
    for (const page of indexable) {
      if (!urls.includes(absUrl(locale, page))) {
        throw new Error(`the sitemap misses the indexable page ${absUrl(locale, page)}`);
      }
    }
    if (urls.includes(absUrl(locale, "account"))) {
      throw new Error(`the sitemap lists the private account page for ${locale}`);
    }
  }
  // Ticket 25: every generated trade and city page is indexable, so a page the build writes but the
  // sitemap forgets is a page nobody crawls.
  for (const page of TRADE_PAGES) {
    if (!urls.includes(absTradeUrl(page.locale, page))) {
      throw new Error(`the sitemap misses the trade and city page ${absTradeUrl(page.locale, page)}`);
    }
  }
  // Ticket 26: a comparison page is written to be found, so a page the sitemap forgets is one nobody
  // reads, exactly like a trade page.
  for (const page of COMPARISON_PAGES) {
    if (!urls.includes(absComparisonUrl(page.locale, page.id))) {
      throw new Error(`the sitemap misses the comparison page ${absComparisonUrl(page.locale, page.id)}`);
    }
  }
  return urls.length;
}

/**
 * Ticket 10, second box: every internal link a written page carries resolves to something the build
 * wrote.
 *
 * External links, mail links, telephone links, data URIs and in-page anchors are out of scope: this
 * check is about a page of ours promising the reader another page of ours and then 404ing. A link to
 * our own hostname counts as internal, because the canonical hostname is ours. Nothing here is a
 * crawler: it is a reader with a phone, on the pages the sitemap hands to Google.
 */
function checkInternalLinks() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".html")) files.push(path);
    }
  };
  walk(outDir);

  const problems = [];
  for (const file of files) {
    const label = file.replace(`${outDir}/`, "");
    const html = readFileSync(file, "utf8");
    for (const match of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
      const raw = match[1].trim();
      if (!raw) continue;
      if (/^(mailto:|tel:|data:|javascript:|#|\/\/)/i.test(raw)) continue;
      if (/^https?:/i.test(raw) && !raw.startsWith(SITE)) continue;
      const withoutFragment = raw.split("#")[0].split("?")[0];
      if (!withoutFragment) continue;
      const path = withoutFragment.startsWith(SITE)
        ? join(outDir, withoutFragment.slice(SITE.length))
        : withoutFragment.startsWith("/")
          ? join(outDir, withoutFragment)
          : resolve(dirname(file), withoutFragment);
      const candidates = [path, join(path, "index.html"), `${path}.html`, `${path}/index.html`];
      if (!candidates.some((candidate) => existsSync(candidate))) {
        problems.push(`${label} links to ${raw}, which the build did not write`);
      }
    }
  }
  if (problems.length) {
    const shown = problems.slice(0, 15).join("\n  ");
    const more = problems.length > 15 ? `\n  and ${problems.length - 15} more` : "";
    throw new Error(`broken internal links:\n  ${shown}${more}`);
  }
  return files.length;
}

const HOME_BUDGET_BYTES = 1_500_000;

/**
 * Ticket 22, box 4, read back from disk. The page a visitor opens carries the level's own monthly
 * amount for its country, HT and TTC, and the year it is sold at, and the other country's grid is not
 * in it. A check on the objects the renderer passed in would pass even if the renderer wrote nothing,
 * so this one reads the files.
 */
function checkPricePageAmounts() {
  const otherCountry = { ES: "FR", FR: "ES" };
  let checked = 0;
  for (const locale of Object.keys(LOCALES)) {
    const country = LOCALES[locale].country;
    for (const tierId of catalogue.tiers) {
      const where = `${locale}/${LOCALES[locale].slugs[`price_${tierId}`]}`;
      const html = readFileSync(pagePath(locale, `price_${tierId}`), "utf8");
      // The price block is the first card: the figures a visitor reads the price from. Reading them
      // there and not somewhere on the page is what makes the check able to fail: the copy repeats
      // the amount, so a page wide search would still pass with the price block empty.
      const block = html.split('<article class="compare-card live">')[1]?.split("</article>")[0] ?? "";
      const expected = [
        ["sin IVA", catalogue.centsHt(tierId, "month", country)],
        ["con IVA", catalogue.centsTtc(tierId, "month", country)],
        ["sin IVA al año", catalogue.centsHt(tierId, "year", country)],
      ];
      for (const [label, cents] of expected) {
        const amount = formatEuro(cents, locale);
        if (!block.includes(amount)) {
          throw new Error(
            `the price block of ${where} does not carry ${amount} (${label}), the amount the catalogue charges for ${tierId} in ${country}`,
          );
        }
      }
      const foreign = formatEuro(catalogue.centsHt(tierId, "month", otherCountry[country]), locale);
      if (html.includes(foreign)) {
        throw new Error(
          `the price page ${where} quotes ${foreign}, the ${otherCountry[country]} grid, and the page speaks to ${country}`,
        );
      }
      checked += 1;
    }
  }
  return checked;
}

/**
 * Ticket 25, box 4, read back from disk like the price pages are: every generated trade and city page
 * carries the entry level's own monthly amount for its country, HT and TTC, and never the other
 * country's grid. A page written from the data file is a page like any other, and this is the check
 * that says so on the file rather than on the objects the renderer happened to pass in.
 */
function checkTradePageAmounts() {
  const otherCountry = { ES: "FR", FR: "ES" };
  for (const page of TRADE_PAGES) {
    const locale = page.locale;
    const country = LOCALES[locale].country;
    const where = `${locale}/${LOCALES[locale].slugs[page.key]}`;
    const html = readFileSync(pagePath(locale, page.key), "utf8");
    const htBlock = html.split('<p class="trade-price">')[1]?.split("</p>")[0] ?? "";
    const ttcBlock = html.split('<p class="trade-price-ttc">')[1]?.split("</p>")[0] ?? "";
    for (const [block, label, cents] of [
      [htBlock, "sin IVA", catalogue.centsHt("lite", "month", country)],
      [ttcBlock, "con IVA", catalogue.centsTtc("lite", "month", country)],
    ]) {
      const amount = formatEuro(cents, locale);
      if (!block.includes(amount)) {
        throw new Error(
          `the price block of ${where} does not carry ${amount} (${label}), the amount the catalogue charges for Lite in ${country}`,
        );
      }
    }
    const foreign = formatEuro(catalogue.centsHt("lite", "month", otherCountry[country]), locale);
    if (html.includes(foreign)) {
      throw new Error(
        `the trade page ${where} quotes ${foreign}, the ${otherCountry[country]} grid, and the page speaks to ${country}`,
      );
    }
  }
  return TRADE_PAGES.length;
}

/**
 * Ticket 26, boxes two, three and four, read back from disk: every claim about the other party
 * carries that party's own page and the date it was read, on the page a visitor opens; the other
 * party is named; what it does better is stated; our own amount is the catalogue's for the country
 * the page speaks to; and the page closes on the audit and the trial and carries no form of its own,
 * because the audit form lives on the audit page. A check on the objects the renderer passed in would
 * pass even if the renderer wrote nothing, so this one reads the files.
 */
function checkComparisonSources() {
  let checked = 0;
  for (const page of COMPARISON_PAGES) {
    const locale = page.locale;
    const country = LOCALES[locale].country;
    const where = `${locale}/${LOCALES[locale].slugs[comparisonKey(page.id)]}`;
    const html = readFileSync(pagePath(locale, comparisonKey(page.id)), "utf8");
    if (html.includes("<form")) {
      throw new Error(
        `the comparison page ${where} carries a form: the page ends on the audit or the trial, and the audit form lives on its own page`,
      );
    }
    // The page sits three levels down, like a price page, so its own links climb three.
    if (!html.includes(href(locale, "audit", 3)) || !html.includes(href(locale, "subscribe", 3))) {
      throw new Error(`the comparison page ${where} does not link both the free audit and the trial, and a comparison page ends on one of the two`);
    }
    if (!html.includes(esc(page.alternative))) {
      throw new Error(`the comparison page ${where} does not name the other party ("${page.alternative}") in a line a visitor reads`);
    }
    for (const line of page.better) {
      if (!html.includes(esc(line))) {
        throw new Error(`the comparison page ${where} does not state what the other party does better ("${line}")`);
      }
    }
    for (const claim of page.claims) {
      if (!html.includes(esc(claim.text))) {
        throw new Error(`the comparison page ${where} does not carry the claim "${claim.text}"`);
      }
      for (const source of claim.sources) {
        if (!html.includes(source.url)) {
          throw new Error(
            `the comparison page ${where} does not link ${source.url}, so the claim about the other party is not traceable to that party's own page`,
          );
        }
        const date = formatReadOn(source.readOn, locale);
        if (!html.includes(date)) {
          throw new Error(`the comparison page ${where} does not carry the read date "${date}" of ${source.url}`);
        }
      }
    }
    const priceBlock = html.split('<p class="compare-price">')[1]?.split("</p>")[0] ?? "";
    const ttcBlock = html.split('<p class="compare-price-ttc">')[1]?.split("</p>")[0] ?? "";
    for (const [block, label, cents] of [
      [priceBlock, "sin IVA", catalogue.centsHt("lite", "month", country)],
      [ttcBlock, "con IVA", catalogue.centsTtc("lite", "month", country)],
    ]) {
      const amount = formatEuro(cents, locale);
      if (!block.includes(amount)) {
        throw new Error(
          `the price block of ${where} does not carry ${amount} (${label}), the amount the catalogue charges for Lite in ${country}`,
        );
      }
    }
    checked += 1;
  }
  return checked;
}

function homePageWeight() {
  const page = join(outDir, "es", "index.html");
  const html = readFileSync(page, "utf8");
  const refs = new Set();
  const add = (ref) => {
    if (!ref.startsWith("../")) return;
    const file = join(dirname(page), ref.split("?")[0]);
    if (existsSync(file) && statSync(file).isFile()) refs.add(file);
  };
 for (const m of html.matchAll(/src="([^"]+)"/g)) add(m[1]);
  // `src` is the 640 px (or 480 px portrait) candidate, the one a phone picks from the srcset. The
  // wider candidates exist for a large screen and are not part of the mobile budget.
  const css = join(outDir, "css", "site.css");
  if (existsSync(css)) {
    refs.add(css);
    const text = readFileSync(css, "utf8");
    for (const m of text.matchAll(/url\(([^)]+)\)/g)) {
      const url = m[1].replace(/["']/g, "").trim();
      if (url.startsWith("http") || url.startsWith("data:")) continue;
      const file = join(dirname(css), url.split("?")[0]);
      if (existsSync(file) && statSync(file).isFile()) refs.add(file);
    }
  }
  const js = join(outDir, "js", "site.js");
  if (existsSync(js)) refs.add(js);
  let bytes = 0;
  for (const file of refs) bytes += statSync(file).size;
  return { bytes, files: refs.size };
}

const pricePages = checkPricePageAmounts();
const tradePages = checkTradePageAmounts();
const comparisonPages = checkComparisonSources();
const sitemapCount = checkSitemap();
const checkedPages = checkInternalLinks();
const weight = homePageWeight();
if (weight.bytes > HOME_BUDGET_BYTES) {
  throw new Error(
    `the home page loads ${Math.round(weight.bytes / 1024)} KB across ${weight.files} files, over the ${Math.round(
      HOME_BUDGET_BYTES / 1024,
    )} KB mobile budget`,
  );
}

// A host that answers with a status code reads this file (Cloudflare Pages does; GitHub Pages
// ignores it). Prepared here so the redirect box is one DNS and host change, not a code change.
writeFileSync(
  join(outDir, "_redirects"),
  [
    "# The root answers the default language over real HTTP, with no script in between.",
    "/ /es/ 301",
    "# The apex serves www, so one hostname owns every canonical address.",
    "https://babyrock.ai/* https://www.babyrock.ai/:splat 301",
    "",
  ].join("\n"),
);

/*
 * The response headers the static host should send, and the second reason the site moves to Cloudflare
 * Pages: GitHub Pages sends none you can set. The app's own Caddy carries the same family of headers
 * for app.babyrock.ai; this file is the static site's half. Cloudflare Pages reads `_headers`; GitHub
 * Pages ignores it, which is why the move matters.
 */
writeFileSync(
  join(outDir, "_headers"),
  [
    "/*",
    "  Strict-Transport-Security: max-age=31536000; includeSubDomains",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: geolocation=(), microphone=(), camera=()",
    "",
    "# Fingerprinted assets and images never change under the same name.",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "/css/*",
    "  Cache-Control: public, max-age=604800",
    "/js/*",
    "  Cache-Control: public, max-age=604800",
    "",
    "# The pages themselves change on every release, so the host revalidates them.",
    "/*.html",
    "  Cache-Control: public, max-age=300, must-revalidate",
    "",
  ].join("\n"),
);

/*
 * The IndexNow key file. IndexNow is how Bing, Naver, Seznam, Yandex and Yep hear about a page the
 * moment it changes: the site hosts this file, and `scripts/indexnow-ping.ts` tells those engines which
 * URLs moved. Google does not take part in IndexNow, so this rides alongside Search Console rather
 * than replacing it. The key lives in the content file so the build and the ping script cannot drift.
 */
const indexNowKey = String(config.indexnowKey ?? "").trim();
if (!/^[a-f0-9]{8,128}$/i.test(indexNowKey)) {
  throw new Error(
    "site/content/config.json needs an indexnowKey of 8 to 128 hexadecimal characters, or the key file cannot be written.",
  );
}
writeFileSync(join(outDir, `${indexNowKey}.txt`), indexNowKey);

console.log("Built static site into docs/");
console.log(
  `  checks: canonical, hreflang and JSON-LD on every page; every internal link on all ${checkedPages} written pages resolves; ${pricePages} price pages, each carrying the catalogue's own HT and TTC amount; ${tradePages} pages by trade and city, each carrying the catalogue's own amount for its country; ${comparisonPages} comparison pages, each claim carrying the other party's own page and the day it was read; every guide ending on its level and the free audit, each kept with its sources; ${sitemapCount} sitemap urls, all written, private pages excluded; home page ${Math.round(
    weight.bytes / 1024,
  )} KB across ${weight.files} files (budget ${Math.round(HOME_BUDGET_BYTES / 1024)} KB)`,
);
