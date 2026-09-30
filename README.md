# babyrock-site: the published www.babyrock.ai

This repository holds **only** the published public site: the built output in `docs/` (what Cloudflare
Pages serves, and the record on GitHub), the legal pages it ships, and the `wrangler.jsonc` the host
reads. `docs/CNAME` still names `www.babyrock.ai`.

The factory (admin, operator, inbox, WhatsApp webhook, Stripe, Rosalía) and the site generator both
live in the private repository. Nothing from the factory belongs here, and nothing is built here:
`docs/` is written by the factory's `scripts/publish-site-switch.sh`, which prepares the switch,
commits it into this repository and uploads it to Cloudflare Pages.

## Publish

From the factory checkout:

```bash
SITE_SIGNUP_MODE=waitlist CLOUDFLARE_API_TOKEN=... ./scripts/publish-site-switch.sh
```

The upload needs a Cloudflare API token with `Cloudflare Pages: Edit`; the push alone changes the
record, not the site, because the Pages project has no Git source.

## Not published

`docs/adr/`, `docs/agents/` and `docs/design/` are internal notes and are deliberately absent. A
publish on 29 September 2026 carried them here by mistake; the switch excludes them again since
30 September 2026, and its `--delete` takes them back out.

## History

The generator that used to live in `site/` was a stale copy of the old site builder, held still at the
22 September version. It was removed on 30 September 2026: its README instructions would have rebuilt
the old design over the published one. The old generator itself still lives in the factory
(`site/build.mjs`), where the switch uses it as the floor for the pages the new site has not ported.
