# Pages deploy helper

`deploy-pages.mjs` publishes the checked-out repository to the existing Cloudflare
Pages Direct Upload project `babyrock-site` from a Cloudflare Workers Builds
production Deploy command:

```bash
node scripts/deploy-pages.mjs --deploy
```

It does not migrate the project, create configuration, change project settings,
or touch the Worker's `wrangler.jsonc`.

## Modes

- `node scripts/deploy-pages.mjs` or `--plan`: local validation only. It copies
  `docs/` and `functions/` into a unique OS temporary directory, verifies the
  required routing files and function, prints a short manifest, then removes the
  temporary copy. It makes no network request and runs no deployment.
- `node scripts/deploy-pages.mjs --deploy`: the only remote action. It requires
  the environment gates below, then runs pinned Wrangler Pages from the
  temporary staging root.
- `--help`: usage only.

## Deploy prerequisites

Workers Builds must provide, without this helper reading any other credential
source:

- `CLOUDFLARE_API_TOKEN`: a token with `Cloudflare Pages: Edit` for the account.
- `CLOUDFLARE_ACCOUNT_ID`: the account that owns Pages project `babyrock-site`.
- `WORKERS_CI_BRANCH=main` (or `CF_PAGES_BRANCH`/`GITHUB_REF_NAME` explicitly
  set to `main`). A missing branch fails closed; any explicit non-`main` branch
  fails before staging.
- `WORKERS_CI_COMMIT_SHA` or `GITHUB_SHA`, or a checked-out git `HEAD`. The
  helper passes this SHA to Wrangler as `--commit-hash`.
- `docs/` and `functions/` must be clean relative to the checked-out commit,
  including untracked and ignored files, so the deployment metadata describes
  the exact uploaded source.

The Pages project must keep `main` as its production branch if the upload is
intended to become production. The token permission and that project setting are
not changed or inferred by this helper.

## Safety and staging

The helper copies only `docs/` and `functions/` to `$TMPDIR/babyrock-pages-deploy-*`.
It refuses a temporary root inside the repository, symlinks in the source, a
`docs/_worker.js` compiled artifact, or any `wrangler.json`, `wrangler.jsonc`, or
`wrangler.toml` in the staged tree or its ancestry. This keeps Wrangler away from
the parent Worker configuration and leaves Pages dashboard bindings intact.

The deploy command runs from that temporary root:

```text
npx --yes --loglevel=error wrangler@4.160.0 pages deploy docs \
  --project-name=babyrock-site --branch=main --commit-hash=<source SHA> \
  --commit-message="GitHub build <source SHA prefix>"
```

Wrangler 4.160.0 is pinned to the version already used for the prior Functions
compile. `npx` fetches that pinned package at deploy time; no dependency is added
to this repository. Wrangler compiles `functions/` itself, including
`functions/api/investor-interest.js`; an old compiled `_worker.js` is never
reused.

The helper does not log token or account values, does not run `wrangler login`,
does not extract credentials from other sources, and removes the staging tree on
success and failure. A successful command still requires confirmation in
Cloudflare before publication is claimed.

## Current limitation

`babyrock-site` Pages is a Direct Upload project with no Git connection. Cloudflare
does not allow it to switch later to native Git integration. This helper therefore
uses the existing Workers Builds runner as CI and uploads through the documented
Pages Direct Upload API. It cannot work until a token with Pages Edit permission
is available to that production Deploy command.
