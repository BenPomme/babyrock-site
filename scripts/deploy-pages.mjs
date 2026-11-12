#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROJECT_NAME = "babyrock-site";
const PRODUCTION_BRANCH = "main";
const WRANGLER_VERSION = "4.160.0";
const TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
const ACCOUNT_ENV = "CLOUDFLARE_ACCOUNT_ID";
const BRANCH_ENVS = ["WORKERS_CI_BRANCH", "CF_PAGES_BRANCH", "GITHUB_REF_NAME"];
const COMMIT_ENVS = ["WORKERS_CI_COMMIT_SHA", "GITHUB_SHA"];
const CONFIG_NAMES = new Set(["wrangler.json", "wrangler.jsonc", "wrangler.toml"]);
const REQUIRED_PATHS = [
  "docs/_routes.json",
  "docs/_headers",
  "docs/_redirects",
  "functions/api/investor-interest.js",
];

function help() {
  console.log(`Usage: node scripts/deploy-pages.mjs [--plan | --deploy]

No flag or --plan validates the checked-out source, copies docs/ and functions/
to a unique temporary staging directory, then removes it. It never uses the
network and never deploys.

--deploy is the only remote action. It requires:
  ${TOKEN_ENV}         token with Cloudflare Pages: Edit
  ${ACCOUNT_ENV}       account that owns Pages project ${PROJECT_NAME}
  WORKERS_CI_BRANCH    explicitly main (CF_PAGES_BRANCH/GITHUB_REF_NAME accepted)
  source commit        WORKERS_CI_COMMIT_SHA/GITHUB_SHA or checked-out git HEAD

It runs pinned Wrangler ${WRANGLER_VERSION} through npx from the temporary
staging root, targeting ${PROJECT_NAME}, branch ${PRODUCTION_BRANCH}. The
repository's wrangler.jsonc is never copied or read as deployment config.`);
}

function parseArgs(argv) {
  let plan = false;
  let deploy = false;
  let wantsHelp = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") wantsHelp = true;
    else if (arg === "--plan") plan = true;
    else if (arg === "--deploy") deploy = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (wantsHelp) return { help: true };
  if (plan && deploy) throw new Error("--plan and --deploy are mutually exclusive");
  return { help: false, mode: deploy ? "deploy" : "plan" };
}

function envValue(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function requireDeployCredentials() {
  const missing = [];
  if (!envValue(TOKEN_ENV)) missing.push(TOKEN_ENV);
  if (!envValue(ACCOUNT_ENV)) missing.push(ACCOUNT_ENV);
  if (missing.length > 0) {
    throw new Error(`deploy refused: missing required environment variable(s): ${missing.join(", ")}`);
  }
}

function readExplicitBranch() {
  const found = BRANCH_ENVS
    .map((name) => ({ name, value: envValue(name) }))
    .filter((entry) => entry.value !== "");

  for (const entry of found) {
    if (entry.value !== PRODUCTION_BRANCH) {
      throw new Error(
        `refusing production Pages upload from ${entry.name}=${entry.value}; expected ${PRODUCTION_BRANCH}`,
      );
    }
  }

  return found[0] ?? null;
}

async function gitHead() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 4096,
      timeout: 5_000,
    });
    const value = stdout.trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function resolveCommit() {
  for (const name of COMMIT_ENVS) {
    const value = envValue(name);
    if (!value) continue;
    if (!/^[0-9a-f]{40}$/i.test(value)) {
      throw new Error(`${name} is not a full 40-character commit SHA`);
    }

    const checkedOut = await gitHead();
    if (checkedOut && checkedOut !== value) {
      throw new Error(`${name} does not match the checked-out git HEAD`);
    }
    return { hash: value, source: name };
  }

  const checkedOut = await gitHead();
  return checkedOut ? { hash: checkedOut, source: "git HEAD" } : null;
}

async function assertSourceMatchesHead() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "--ignored", "--", "docs", "functions"],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024, timeout: 5_000 },
    ));
  } catch (error) {
    throw new Error(`deploy refused: cannot verify docs/functions match git HEAD: ${error.message}`);
  }
  if (stdout.trim() !== "") {
    throw new Error("deploy refused: docs/ or functions/ differ from the checked-out git HEAD");
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function assertOutsideRepository(candidate) {
  const [repository, resolved] = await Promise.all([realpath(REPO_ROOT), realpath(candidate)]);
  if (isInside(repository, resolved)) {
    throw new Error(`temporary directory ${resolved} is inside the repository; set TMPDIR outside it`);
  }
}

async function assertNoConfigAncestors(start) {
  let current = start;
  for (;;) {
    for (const name of CONFIG_NAMES) {
      try {
        await lstat(path.join(current, name));
        throw new Error(`refusing to run Wrangler with config ancestor ${path.join(current, name)}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function snapshotTree(root) {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`source path is not a real directory: ${root}`);
  }

  const files = [];
  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`symlinks are not allowed in deploy source: ${absolute}`);
      }
      if (stat.isDirectory()) {
        await walk(absolute, relative);
      } else if (stat.isFile()) {
        files.push({ path: relative, size: stat.size });
      } else {
        throw new Error(`unsupported file type in deploy source: ${absolute}`);
      }
    }
  }

  await walk(root, "");
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, bytes: files.reduce((total, file) => total + file.size, 0) };
}

function assertSameTree(expected, actual, label) {
  if (expected.files.length !== actual.files.length) {
    throw new Error(`${label} staging file count differs from source`);
  }
  for (let index = 0; index < expected.files.length; index += 1) {
    const source = expected.files[index];
    const staged = actual.files[index];
    if (source.path !== staged.path || source.size !== staged.size) {
      throw new Error(`${label} staging differs at ${source.path}`);
    }
  }
}

async function sha256(file) {
  const contents = await readFile(file);
  return createHash("sha256").update(contents).digest("hex");
}

async function stageSource() {
  const tempParent = os.tmpdir();
  await assertOutsideRepository(tempParent);

  let stagingRoot = null;
  try {
    stagingRoot = await mkdtemp(path.join(tempParent, "babyrock-pages-deploy-"));
    const stagingReal = await realpath(stagingRoot);
    await assertOutsideRepository(stagingReal);
    await assertNoConfigAncestors(stagingReal);

    const sourceDocs = path.join(REPO_ROOT, "docs");
    const sourceFunctions = path.join(REPO_ROOT, "functions");
    const stagedDocs = path.join(stagingRoot, "docs");
    const stagedFunctions = path.join(stagingRoot, "functions");

    const docsManifest = await snapshotTree(sourceDocs);
    const functionsManifest = await snapshotTree(sourceFunctions);
    if (docsManifest.files.some((file) => file.path === "_worker.js")) {
      throw new Error("docs/_worker.js exists; refusing to reuse a compiled artifact instead of compiling functions");
    }

    await cp(sourceDocs, stagedDocs, { recursive: true, preserveTimestamps: true, force: false, errorOnExist: true });
    await cp(sourceFunctions, stagedFunctions, {
      recursive: true,
      preserveTimestamps: true,
      force: false,
      errorOnExist: true,
    });

    const stagedDocsManifest = await snapshotTree(stagedDocs);
    const stagedFunctionsManifest = await snapshotTree(stagedFunctions);
    assertSameTree(docsManifest, stagedDocsManifest, "docs");
    assertSameTree(functionsManifest, stagedFunctionsManifest, "functions");

    const stagedFiles = [...stagedDocsManifest.files, ...stagedFunctionsManifest.files];
    for (const file of stagedFiles) {
      if (CONFIG_NAMES.has(path.basename(file.path))) {
        throw new Error(`refusing deployment config in staged source: ${file.path}`);
      }
    }
    for (const name of CONFIG_NAMES) {
      try {
        await lstat(path.join(stagingRoot, name));
        throw new Error(`refusing deployment config in staging root: ${name}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }

    const checks = {};
    for (const relative of REQUIRED_PATHS) {
      const absolute = path.join(stagingRoot, relative);
      const stat = await lstat(absolute).catch((error) => {
        if (error.code === "ENOENT") throw new Error(`required source file is missing: ${relative}`);
        throw error;
      });
      if (!stat.isFile() || stat.size === 0) throw new Error(`required source file is empty or invalid: ${relative}`);
      checks[relative] = { sha256: await sha256(absolute), bytes: stat.size };
    }

    let routes;
    try {
      routes = JSON.parse(await readFile(path.join(stagingRoot, "docs/_routes.json"), "utf8"));
    } catch (error) {
      throw new Error(`docs/_routes.json is not valid JSON: ${error.message}`);
    }
    if (!Array.isArray(routes.include) || !routes.include.includes("/api/investor-interest")) {
      throw new Error("docs/_routes.json must include /api/investor-interest");
    }

    return {
      root: stagingRoot,
      docsFiles: stagedDocsManifest.files.length,
      functionsFiles: stagedFunctionsManifest.files.length,
      bytes: stagedDocsManifest.bytes + stagedFunctionsManifest.bytes,
      checks,
    };
  } catch (error) {
    const cleanupError = await removeStage(stagingRoot ? { root: stagingRoot } : null);
    if (cleanupError) error.message = `${error.message}; staging cleanup failed: ${cleanupError.message}`;
    throw error;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(1)} ${unit}`;
}

function wranglerArgs(commit) {
  return [
    "--yes",
    "--loglevel=error",
    `wrangler@${WRANGLER_VERSION}`,
    "pages",
    "deploy",
    "docs",
    `--project-name=${PROJECT_NAME}`,
    `--branch=${PRODUCTION_BRANCH}`,
    `--commit-hash=${commit}`,
    `--commit-message=GitHub build ${commit.slice(0, 12)}`,
  ];
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1",
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        const error = new Error(`Wrangler Pages deploy terminated by ${signal}`);
        error.exitCode = 1;
        reject(error);
        return;
      }
      if (code === 0) return resolve();
      const error = new Error(`Wrangler Pages deploy failed with exit code ${code}`);
      error.exitCode = code || 1;
      reject(error);
    });
  });
}

function reportStage(stage) {
  console.log(`Staging: ${stage.docsFiles + stage.functionsFiles} files, ${formatBytes(stage.bytes)} in ${stage.root}`);
  console.log(`Functions source: ${stage.functionsFiles} file(s); docs/_worker.js absent, so Wrangler compiles Functions`);
  console.log(`Routing controls: _routes.json ${stage.checks["docs/_routes.json"].sha256.slice(0, 12)}, ` +
    `_headers ${stage.checks["docs/_headers"].sha256.slice(0, 12)}, ` +
    `_redirects ${stage.checks["docs/_redirects"].sha256.slice(0, 12)}`);
}

async function removeStage(stage) {
  if (!stage) return null;
  try {
    await rm(stage.root, { recursive: true, force: true });
    console.log("Staging removed.");
    return null;
  } catch (error) {
    console.error(`deploy-pages: staging cleanup failed: ${error.message}`);
    return error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
    return;
  }

  const { mode } = options;
  if (mode === "deploy") requireDeployCredentials();

  const branch = readExplicitBranch();
  if (mode === "deploy" && !branch) {
    throw new Error(
      `deploy refused: set WORKERS_CI_BRANCH=${PRODUCTION_BRANCH} (or CF_PAGES_BRANCH/GITHUB_REF_NAME)`,
    );
  }

  const commit = await resolveCommit();
  if (mode === "deploy" && !commit) {
    throw new Error("deploy refused: source commit is unavailable");
  }
  if (mode === "deploy") await assertSourceMatchesHead();

  console.log(mode === "deploy" ? "Cloudflare Pages deploy" : "Cloudflare Pages plan (local only, no network)");
  console.log(`Project: ${PROJECT_NAME}; production branch: ${PRODUCTION_BRANCH}`);
  console.log(`Branch guard: ${branch ? `${branch.value} (${branch.name})` : "not set; deploy would refuse"}`);
  console.log(`Source commit: ${commit ? `${commit.hash} (${commit.source})` : "unavailable"}`);
  if (mode === "deploy") console.log(`Credentials: ${TOKEN_ENV} and ${ACCOUNT_ENV} present`);

  let stage = null;
  let failure = null;
  try {
    stage = await stageSource();
    reportStage(stage);

    if (mode === "plan") {
      console.log("Plan complete: staging validated; no network request and no deployment performed.");
    } else {
      const args = wranglerArgs(commit.hash);
      console.log(`Running: npx ${args.join(" ")}`);
      await run("npx", args, stage.root);
      console.log("Wrangler Pages deploy command completed successfully.");
      console.log("Confirm the deployment in Cloudflare before claiming publication.");
    }
  } catch (error) {
    failure = error;
  }

  const cleanupError = await removeStage(stage);
  if (!failure && cleanupError) failure = cleanupError;
  if (failure) throw failure;
}

try {
  await main();
} catch (error) {
  console.error(`deploy-pages: ${error.message}`);
  process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
}
