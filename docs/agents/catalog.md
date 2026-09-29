# Catalogue

Single source of euro amounts for Rosalia, `/pay`, and outreach.

- Prices: `src/lib/skus.ts`. Four tiers (lite, plus, pro, enterprise), two country grids, monthly and
  annual. The HT is the source of truth and the number the visitor reads: Spain 49 / 99 / 149 / 199,
  France 69 / 139 / 199 / 259, with the VAT added at the checkout (21 percent ES, 20 percent FR). The
  annual is ten months for twelve. The retired review-only ladder still resolves as plan aliases so an
  old Stripe subscription keeps billing what it was sold, never as a second price list.
- Speech: `src/lib/catalog.ts` `quoteFor()`.
- Trial: one rule, `TRIAL_DAYS` in `src/lib/skus.ts` (15 days), once per client, the card at entry,
  the first charge automatic at day 15. It is the same length whatever door the shop came through, so
  the local offers below read the constant rather than carrying a number of their own.
- Local offers: `src/lib/offers.ts`.
  - `santcugat_trial` — Sant Cugat city. New reviews during the trial. After first paid invoice: 50 newest unanswered.
  - `referred_trial` — BabyHunters referred shop. Does not stack with inbound or Sant Cugat.
  - `inbound_trial` — Rosalía inbound only (WhatsApp or email reply). Not on the public `/pay`
    page. New reviews during the trial; 50 newest unanswered after first charge.
- Founding cohort: `src/lib/founding-cohort.ts`. 30 percent off for 12 months for a shop on the
  tester track, applied as a Stripe coupon at the checkout (`scripts/stripe-founding-coupon.ts`
  creates it; `STRIPE_COUPON_FOUNDING` names it).

To add a SKU, change a price, or toggle live / coming soon: one SKU row plus this file, then `quoteFor` / `/pay` / Stripe.

Do not put a second euro amount in WhatsApp copy.
