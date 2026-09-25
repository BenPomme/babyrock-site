/**
 * Every price the site publishes comes from the catalogue.
 *
 * Two rules, and the build fails when either is broken:
 *
 * 1. The content file states the grid once (`site/content/config.json`, four levels, both
 *    countries). The build reads the same four levels from `src/lib/skus.ts` and refuses to write a
 *    page when a figure there disagrees, naming the page and both amounts.
 * 2. Copy that needs an amount writes a token, `{price:plus_month}` or `{price_ttc:plus_year}`,
 *    which the build fills from the catalogue for the country the page speaks to. A price line that
 *    types its own amount is refused: that is exactly how the site and the invoice drift apart.
 */

/** `{price:level_interval}` is HT, `{price_ttc:level_interval}` is what the card is charged. */
const TOKEN = /\{(price|price_ttc):([a-z]+)_(month|year)\}/g;
/** `{vat:ES}` is the country's rate, so a legal page never types 21 or 20 by hand. */
const VAT_TOKEN = /\{vat:([A-Z]{2})\}/g;
const TOKEN_SHAPE = /\{(?:price|price_ttc):[a-z]+_(?:month|year)\}|\{vat:[A-Z]{2}\}/g;
/** An amount written into the copy: `9,99 €`, `99.90 €`, `€99`. */
const TYPED_AMOUNT = /\d[\d.\s]*(?:[.,]\d{1,2})?\s*€|€\s*\d/;

/** Cents to the site's own spelling of a euro amount: 48,76 € in es, ca and fr, 48.76 € in en. */
export function formatEuro(cents, locale = "es") {
  const digits = typeof cents === "number" ? cents : Number(cents);
  const amount = (digits / 100).toFixed(2).replace(".", locale === "en" ? "." : ",");
  return `${amount} €`;
}

/** True when the copy states an amount itself instead of asking the catalogue for one. */
export function typesAnAmount(text) {
  return TYPED_AMOUNT.test(String(text ?? ""));
}

export function priceTokens(text) {
  return String(text ?? "").match(TOKEN) ?? [];
}

/** Removes the tokens the build fills, so the leftover-placeholder check can step over them. */
export function stripPriceTokens(text) {
  return String(text ?? "").replace(new RegExp(TOKEN_SHAPE.source, "g"), "");
}

/**
 * Fills every price token in a block of copy for one page.
 *
 * A token the catalogue cannot answer fails the build and names the level it asked for, because a
 * page publishing `{price:...}` literally would be worse than a build that stops.
 */
export function fillPrices(text, { catalogue, country, locale, where }) {
  return String(text ?? "")
    .replace(VAT_TOKEN, (token, code) => {
      const rate = catalogue.vatPercent?.[code];
      if (typeof rate !== "number") {
        throw new Error(
          `${where} asks for ${token}: the catalogue has no VAT rate for "${code}". ` +
            `It has ${catalogue.countries.join(", ")}.`,
        );
      }
      return `${rate} %`;
    })
    .replace(TOKEN, (token, kind, tier, interval) => {
      if (!catalogue.tiers.includes(tier)) {
        throw new Error(
          `${where} asks for ${token}: the catalogue has no level "${tier}". ` +
            `It has ${catalogue.tiers.join(", ")}.`,
        );
      }
      const cents =
        kind === "price_ttc"
          ? catalogue.centsTtc(tier, interval, country)
          : catalogue.centsHt(tier, interval, country);
      return formatEuro(cents, locale);
    });
}

function euros(cents) {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function publishedOn(pagesByCountry, country) {
  const pages = pagesByCountry[country] ?? [];
  return pages.length ? ` Published on ${pages.join(", ")}.` : "";
}

/** The amount the content file states, in cents, or undefined when it states nothing readable. */
function declaredCents(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

/**
 * The site grid against the catalogue, run before anything is written.
 *
 * `tiers` is `site/content/config.json`'s grid: one row per level, `prices.ES` and `prices.FR`, each
 * with `monthHt` and `monthTtc`. This is the check that makes `node site/build.mjs` refuse to
 * publish a price the catalogue does not agree with.
 */
export function checkSiteGrid({ tiers, catalogue, file = "site/content/config.json", pagesByCountry = {} }) {
  const problems = [];
  const rows = Array.isArray(tiers) ? tiers : [];
  for (const tier of catalogue.tiers) {
    const row = rows.find((candidate) => candidate.id === tier);
    const label = row?.name || tier;
    if (!row) {
      problems.push(
        `- the site grid in ${file} has no row for the ${label} level, which the catalogue sells.` +
          publishedOn(pagesByCountry, catalogue.countries[0]),
      );
      continue;
    }
    const prices = row.prices ?? {};
    for (const country of catalogue.countries) {
      const declared = prices[country];
      const pages = publishedOn(pagesByCountry, country);
      if (!declared) {
        problems.push(
          `- the site grid in ${file} states no price for ${label} in ${country}, which the catalogue sells.${pages}`,
        );
        continue;
      }
      for (const [field, expected] of [
        ["monthHt", catalogue.centsHt(tier, "month", country)],
        ["monthTtc", catalogue.centsTtc(tier, "month", country)],
      ]) {
        const stated = declaredCents(declared[field]);
        if (stated === undefined) {
          problems.push(`- the site grid in ${file} states no ${field} for ${label} in ${country}.${pages}`);
          continue;
        }
        if (stated !== expected) {
          const unit = field === "monthHt" ? "HT" : "TTC";
          problems.push(
            `- ${label} in ${country}: the site states ${euros(stated)} ${unit}, the catalogue says ` +
              `${euros(expected)} ${unit} (${file}, ${tier}.prices.${country}.${field}).${pages}`,
          );
        }
      }
    }
  }
  if (problems.length) {
    throw new Error(`The site prices and the catalogue disagree:\n${problems.join("\n")}`);
  }
}

/**
 * A price line has to ask the catalogue for the amount, never type one.
 *
 * `lines` are the content keys the build renders as a price: the yearly figure under each level card
 * today, and whatever the rebuild adds. A line that is missing, or that carries a typed amount, stops
 * the build with the page it would have appeared on.
 */
export function checkPriceLines(lines) {
  const problems = [];
  for (const { where, key, page, text, token } of lines) {
    if (text === undefined || String(text).trim() === "") {
      problems.push(
        `- ${where} has no ${key}, so the card on ${page} would publish an empty price line. ` +
          `Write it with {price:${token}} so the amount comes from the catalogue.`,
      );
      continue;
    }
    if (typesAnAmount(text) && priceTokens(text).length === 0) {
      problems.push(
        `- ${where} ${key} states "${String(text).trim()}" by hand. A price on ${page} has to come ` +
          `from the catalogue: write {price:${token}} instead of the amount.`,
      );
    }
  }
  if (problems.length) {
    throw new Error(`The site states a price instead of reading one:\n${problems.join("\n")}`);
  }
}
