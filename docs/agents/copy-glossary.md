# Copy glossary, English to Spanish, Catalan and French

29 September 2026. English is the reference (`docs/agents/copy.md`). This file is the table a
translation must obey: the words that are fixed, the words that are banned, and the numbers that
cannot drift. It is filled from decisions Ben made, not from preference, and the native localization
skill (`~/.codex/skills/native-localization-translator`) reads it as the glossary.

## The words that do not translate

| English | Spanish (ES) | Catalan (CA) | French (FR) | Note |
| --- | --- | --- | --- | --- |
| BabyRock | BabyRock | BabyRock | BabyRock | Never translated, never accented |
| Rosalía | Rosalía | Rosalía | Rosalía | The accent stays in copy; code and URLs say Rosalia |
| Lite, Plus, Pro, Enterprise | the same | the same | the same | Tier names, never translated |
| Google, Instagram, Facebook, WhatsApp, Meta, Stripe, Metricool | the same | the same | the same | Brands keep their own spelling |
| BabyRock, your social presence, handled. | the same | the same | the same | The tagline, in English in every language |

## The words that must translate, and how

| English | Spanish (ES) | Catalan (CA) | French (FR) |
| --- | --- | --- | --- |
| plan (a subscription level: free plan, paid plan, the four plans) | plan | pla | formule |
| the free plan | el plan Gratis | el pla Gratuït | la formule Gratuite |
| the paid plans | los planes de pago | els plans de pagament | les formules payantes |
| performance dashboard | panel de rendimiento | tauler de rendiment | tableau de performance |
| review | reseña | ressenya | avis |
| comment | comentario | comentari | commentaire |
| private messages | mensajes privados | missatges privats | messages privés |
| Google post | publicación de Google | publicació de Google | publication Google |
| small edits (website) | pequeños cambios | petits canvis | petites modifications |
| holiday hours | horario de festivos | horari de festius | horaires des jours fériés |
| opening hours | horario | horari | horaires |
| waitlist | lista de espera | llista d'espera | liste d'attente |

## The words that are banned

- **"level"** in customer copy, in any language: English says **plan** (free plan, paid plan, the four
  plans), Spanish **plan**, Catalan **pla**, French **formule**. Ben, 28 September 2026.
- **"tier"** in customer copy, in English, since 29 September 2026: Ben replaced the expressions
  "Free Tier" and "Paid Tier" with "Free Plan" and "Paid Plan" across the site, so the customer word is
  plan everywhere. "tier" survives as the internal domain word in the code, the database and the
  tickets, and never reaches a shop.
- **"nivel"**, **"nivell"**, **"niveau"** for the products. They describe a ladder, not a plan.
- **em dashes and en dashes**, in every language, in every surface. Use a comma, a full stop, a colon
  or brackets.
- **"apply"** as the English funnel word: it is **Start free** and **Join the waitlist** now.
- **promises we cannot keep**: followers, reach, ranking, a number of new customers, a discount we
  did not authorise. The fences are in `src/lib/rosalia/knowledge-content.ts`.

## The numbers that cannot drift

- Prices are **before VAT** in the catalogue and on the site, and the VAT is added at the checkout:
  Spain **49 / 99 / 149 / 199**, France **69 / 139 / 199 / 259** a month. Paying a year is ten
  months in one payment.
- The trial on a paid tier is **15 days**, once per client.
- **Free answers are unlimited**; the only watch is internal, at 500 answers a month.
- Private messages start at **Plus**, **500 a month**, higher on Pro, custom on Enterprise, and
  nobody on the team reads them.
- Google posts are unlimited from **Pro**; small edits to the website are unlimited from **Plus**.
- The founding cohort price is **30 percent off for 12 months**, then list price.
- The free tier asks for a **working WhatsApp number, an email, and manager access** on Google or on
  Instagram and Facebook. No card until Instagram and Facebook are connected.

## The sentences Ben wrote himself

The Home page and the pricing page carry his own words (`.scratch/copy-approvals.md`, "Fourth
round"). A translation of those lines is a translation of approved English; it is never a rewrite of
the promise. Where his English has a grammar fix, the fix is English-side only: the translation
follows the meaning, not the slip.
