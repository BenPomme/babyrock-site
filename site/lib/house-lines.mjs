/**
 * The house's own lines, read from `src/lib/social/evergreen.ts`.
 *
 * Ticket 25: a trade page shows what a quiet week actually publishes, and the honest example is the
 * one the app already publishes, not a sentence written for the page. So the build reads the real
 * set instead of copying it, and the day the app changes its line the page changes with it. A reader
 * that quietly found nothing would let a marketing page print a line the product never sends, which
 * is the failure this file exists to prevent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Relative to the repository root, next to `site/`. */
export const EVERGREEN_SOURCE = join("src", "lib", "social", "evergreen.ts");

function missing(detail) {
  return new Error(
    `site/lib/house-lines.mjs cannot read the house lines: ${detail} in ${EVERGREEN_SOURCE}. ` +
      `The trade pages would print a line the product does not send, so the build stops.`,
  );
}

/** The quoted strings of `es: [ "…", "…" ],`, in the order the app carries them. */
function stringsAfter(source, anchor, lang) {
  const at = source.indexOf(anchor);
  if (at === -1) throw missing(`"${anchor}" is gone`);
  const after = source.slice(at + anchor.length);
  const end = after.indexOf("]");
  if (end === -1) throw missing(`the ${lang} list after "${anchor}" is not closed`);
  const lines = [...after.slice(0, end).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (!lines.length) throw missing(`the ${lang} list after "${anchor}" is empty`);
  return lines;
}

export function parseHouseLines(source) {
  const lines = {};
  for (const lang of ["es", "ca", "fr", "en"]) {
    lines[lang] = stringsAfter(source, `\n  ${lang}: [`, lang);
  }
  return lines;
}

/**
 * One house line in a language, with the shop's own name and its city written in. The page uses it
 * with the placeholder the copy names instead of a name, so the sentence is the product's and the
 * shop is the reader's. A line that carries no city cannot be used on a city page: it would lose the
 * one local word the page exists for, so it is refused here rather than printed.
 */
export function houseLineFor(lines, lang, { shop, city }) {
  const list = lines[lang];
  if (!list || !list.length) throw missing(`there is no ${lang} line`);
  const line = list.find((candidate) => candidate.includes("{city}"));
  if (!line) throw missing(`no ${lang} line names the city`);
  return line.replace(/\{name\}/g, shop).replace(/\{city\}/g, city);
}

export function loadHouseLines(repoRoot) {
  let source;
  try {
    source = readFileSync(join(repoRoot, EVERGREEN_SOURCE), "utf8");
  } catch {
    throw missing(`the file is not readable at ${join(repoRoot, EVERGREEN_SOURCE)}`);
  }
  return parseHouseLines(source);
}
