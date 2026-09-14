# babyrock-site — the published www.babyrock.ai

This repository holds **only** the public marketing site: the generator in `site/`,
its output in `docs/` (what GitHub Pages serves), and the legal pages in `legal/`.

The factory — admin, operator, inbox, WhatsApp webhook, Stripe, Rosalía — lives in a
separate **private** repository. Nothing from the factory belongs here.

## Publish

Edit copy in `site/content/{es,ca,fr,en}.md`, then rebuild from the repository root:

```bash
node site/build.mjs          # writes docs/
git add -A && git commit -m "copy: ..." && git push
```

GitHub Pages serves `docs/` on `main`. Custom domain `www.babyrock.ai` (see `docs/CNAME`).

## Not published

`docs/adr/`, `docs/agents/` and `docs/design/` are deliberately absent — they are internal
notes and were publicly reachable while they sat in the Pages root.
