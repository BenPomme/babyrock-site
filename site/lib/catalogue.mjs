/**
 * The catalogue, read from `src/lib/skus.ts`.
 *
 * The site quotes what the invoice charges and what Rosalia says, so there is one place a price is
 * written and it is this one. The build is plain Node and the catalogue is TypeScript, so the four
 * priced literals are read out of the source instead of imported. Every read is checked: when a
 * literal is missing, empty or not a whole number of cents, the build fails and names it. A reader
 * that quietly found nothing would let the site publish any price at all, which is the failure this
 * file exists to prevent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Relative to the repository root, next to `site/`. */
export const CATALOGUE_SOURCE = join("src", "lib", "skus.ts");

function missing(where, detail) {
  return new Error(
    `site/lib/catalogue.mjs cannot read the catalogue: ${detail} in ${CATALOGUE_SOURCE}. ` +
      `The price check cannot run, so the build stops. Update ${where} and this reader together.`,
  );
}

/** The body of the first `{ ... }` after an anchor, with the braces balanced. */
function objectLiteralAfter(source, anchor) {
  const at = source.indexOf(anchor);
  if (at === -1) throw missing("site/lib/catalogue.mjs", `"${anchor}" is gone`);
  const open = source.indexOf("{", at);
  if (open === -1) throw missing("site/lib/catalogue.mjs", `"${anchor}" has no object literal after it`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw missing("site/lib/catalogue.mjs", `the object literal after "${anchor}" is not closed`);
}

/** `a: 1, b: 2` split at the commas that are not inside braces. */
function topLevelEntries(text) {
  const entries = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      entries.push(text.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(text.slice(start));
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

/** The string items of `export const NAME = ["a", "b"] as const;` */
function stringArrayAfter(source, anchor) {
  const at = source.indexOf(anchor);
  if (at === -1) throw missing("site/lib/catalogue.mjs", `"${anchor}" is gone`);
  const match = source.slice(at).match(/\[([^\]]*)\]/);
  if (!match) throw missing("site/lib/catalogue.mjs", `"${anchor}" has no array`);
  const items = match[1]
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  if (!items.length) throw missing("site/lib/catalogue.mjs", `"${anchor}" is empty`);
  return items;
}

/** `{ ES: 21, FR: 20 }` to `{ ES: 21, FR: 20 }` in numbers. */
function numberMap(text, anchor) {
  const map = {};
  for (const entry of topLevelEntries(text)) {
    const match = entry.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) throw missing("site/lib/catalogue.mjs", `"${anchor}" carries an entry it cannot read: "${entry}"`);
    map[match[1]] = Number(match[2]);
  }
  if (!Object.keys(map).length) throw missing("site/lib/catalogue.mjs", `"${anchor}" is empty`);
  return map;
}

/** `{ lite: { ES: 4876 }, ... }` to the same shape in numbers. */
function nestedNumberMap(text, anchor) {
  const map = {};
  for (const entry of topLevelEntries(text)) {
    const match = entry.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{([\s\S]*)\}$/);
    if (!match) throw missing("site/lib/catalogue.mjs", `"${anchor}" carries an entry it cannot read: "${entry}"`);
    map[match[1]] = numberMap(match[2], `${anchor}.${match[1]}`);
  }
  if (!Object.keys(map).length) throw missing("site/lib/catalogue.mjs", `"${anchor}" is empty`);
  return map;
}

/**
 * `{ lite: null, plus: 12, ... }`: a number, or `null` where the catalogue deliberately states no
 * figure (Lite sells publications without a count). Used for the monthly post counts, so the trade
 * pages read the cadence the app publishes under instead of quoting a second one.
 */
function nullableNumberMap(text, anchor) {
  const map = {};
  for (const entry of topLevelEntries(text)) {
    const match = entry.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(null|\d+)$/);
    if (!match) throw missing("site/lib/catalogue.mjs", `"${anchor}" carries an entry it cannot read: "${entry}"`);
    map[match[1]] = match[2] === "null" ? null : Number(match[2]);
  }
  if (!Object.keys(map).length) throw missing("site/lib/catalogue.mjs", `"${anchor}" is empty`);
  return map;
}

function positiveInteger(value, anchor) {
  if (!Number.isInteger(value) || value <= 0) {
    throw missing("site/lib/catalogue.mjs", `"${anchor}" is not a positive whole number of cents`);
  }
  return value;
}

/**
 * The priced catalogue: four levels, two countries, monthly and annual.
 *
 * `monthlyHt` and its siblings take a level, a country and an interval and return cents, so every
 * caller asks the catalogue for the figure instead of holding one.
 */
export function parseCatalogue(source) {
  const tiers = stringArrayAfter(source, "export const TIERS =");
  const countries = stringArrayAfter(source, "export const COUNTRIES =");
  const vatPercent = numberMap(
    objectLiteralAfter(source, "export const VAT_PERCENT_BY_COUNTRY"),
    "VAT_PERCENT_BY_COUNTRY",
  );
  const monthlyHt = nestedNumberMap(objectLiteralAfter(source, "export const MONTHLY_HT"), "MONTHLY_HT");
  const monthlyPosts = nullableNumberMap(
    objectLiteralAfter(source, "export const MONTHLY_POSTS_BY_TIER"),
    "MONTHLY_POSTS_BY_TIER",
  );
  const annualMatch = source.match(/export const ANNUAL_MONTHS\s*=\s*(\d+)/);
  if (!annualMatch) throw missing("site/lib/catalogue.mjs", "ANNUAL_MONTHS is gone");
  const annualMonths = positiveInteger(Number(annualMatch[1]), "ANNUAL_MONTHS");

  for (const tier of tiers) {
    if (!monthlyHt[tier]) throw missing("site/lib/catalogue.mjs", `MONTHLY_HT has no row for the level "${tier}"`);
    if (!(tier in monthlyPosts)) {
      throw missing("site/lib/catalogue.mjs", `MONTHLY_POSTS_BY_TIER has no row for the level "${tier}"`);
    }
    for (const country of countries) {
      positiveInteger(monthlyHt[tier][country], `MONTHLY_HT.${tier}.${country}`);
      positiveInteger(vatPercent[country], `VAT_PERCENT_BY_COUNTRY.${country}`);
    }
  }

  function centsHt(tier, interval, country) {
    const month = monthlyHt[tier]?.[country];
    if (month === undefined) throw missing("site/lib/catalogue.mjs", `the level "${tier}" has no price in ${country}`);
    if (interval === "year") return positiveInteger(month * annualMonths, `MONTHLY_HT.${tier}.${country} times ANNUAL_MONTHS`);
    if (interval !== "month") throw missing("site/lib/catalogue.mjs", `"${interval}" is not an interval`);
    return month;
  }

  return {
    tiers,
    countries,
    vatPercent,
    annualMonths,
    /** Publications a month per level, or null where the catalogue states no figure. */
    monthlyPosts,
    /** Cents HT, the source of truth. */
    centsHt,
    /** Cents TTC, the amount the card is charged. */
    centsTtc: (tier, interval, country) =>
      Math.round(centsHt(tier, interval, country) * (1 + (vatPercent[country] ?? 0) / 100)),
  };
}

export function loadCatalogue(repoRoot) {
  const path = join(repoRoot, CATALOGUE_SOURCE);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw missing("site/lib/catalogue.mjs", `the catalogue is not readable at ${path}`);
  }
  return parseCatalogue(source);
}
