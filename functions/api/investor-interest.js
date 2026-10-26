const FROM_ADDRESS = "rosalia@babyrock.ai";
const TO_ADDRESS = "contact@babyrock.ai";
const SUBJECT = "BabyRock friends and angels round enquiry";

const MAX_BODY_BYTES = 8 * 1024;
const MIN_FORM_AGE_MS = 2_000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1_000;
const PROVIDER_TIMEOUT_MS = 8_000;

const IP_WINDOW_MS = 10 * 60 * 1_000;
const IP_LIMIT = 3;
const EMAIL_WINDOW_MS = 60 * 60 * 1_000;
const EMAIL_LIMIT = 3;

const TOKEN_TTL_MS = 50 * 60 * 1_000;
const ACCOUNT_TTL_MS = 30 * 60 * 1_000;
const PENDING_TTL_SECONDS = 10 * 60;
const ACCEPTED_TTL_SECONDS = 24 * 60 * 60;
const MIN_CACHE_TTL_SECONDS = 60;

const CACHE_KEY_PREFIX = "https://investor-interest.cache.invalid/v1";
const GENERIC_ERROR = Object.freeze({ ok: false, error: "request_failed" });

let tokenCache = null;
let tokenInFlight = null;
let accountCache = null;
let accountInFlight = null;
const requestLocks = new Map();

class InputError extends Error {}
class PayloadTooLargeError extends Error {}
class ProviderError extends Error {
  constructor(status = 0) {
    super("provider request failed");
    this.status = status;
  }
}

export function __resetInvestorInterestStateForTests() {
  tokenCache = null;
  tokenInFlight = null;
  accountCache = null;
  accountInFlight = null;
  requestLocks.clear();
}

function jsonResponse(status, body, extraHeaders = {}) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (value !== undefined && value !== null) headers.set(name, String(value));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function genericError(status, extraHeaders = {}) {
  return jsonResponse(status, GENERIC_ERROR, extraHeaders);
}

function isSameOriginRequest(requestUrl, origin) {
  if (!origin || origin === "null") return false;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.origin !== origin || parsed.origin !== requestUrl.origin) return false;

  const host = parsed.hostname.toLowerCase();
  if (host === "www.babyrock.ai") return parsed.protocol === "https:";
  if (host === "babyrock-site.pages.dev" || host.endsWith(".babyrock-site.pages.dev")) {
    return parsed.protocol === "https:";
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }
  return false;
}

async function readBodyWithinLimit(request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) throw new InputError();
    if (parsedLength > MAX_BODY_BYTES) throw new PayloadTooLargeError();
  }

  if (!request.body) throw new InputError();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function hasLineBreakOrControl(value) {
  return /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value);
}

function validateSubmission(value, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError();

  if (value.website !== undefined && value.website !== null) {
    if (typeof value.website !== "string") throw new InputError();
    if (value.website.trim() !== "") throw new InputError();
  }

  if (typeof value.name !== "string") throw new InputError();
  const name = value.name.trim();
  if (name.length < 1 || name.length > 120 || hasLineBreakOrControl(name)) throw new InputError();

  if (typeof value.email !== "string") throw new InputError();
  const email = value.email.trim();
  if (email.length < 3 || email.length > 254 || hasLineBreakOrControl(email)) throw new InputError();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new InputError();

  let phone = "";
  if (value.phone !== undefined && value.phone !== null) {
    if (typeof value.phone !== "string") throw new InputError();
    phone = value.phone.trim();
    if (phone.length > 40 || hasLineBreakOrControl(phone)) throw new InputError();
    if (phone !== "" && !/^[+()0-9.\- ]+$/u.test(phone)) throw new InputError();
    const digits = phone.replace(/\D/g, "");
    if (phone !== "" && (digits.length < 5 || digits.length > 20)) throw new InputError();
  }

  if (!Number.isSafeInteger(value.startedAt) || value.startedAt <= 0) throw new InputError();
  const age = now - value.startedAt;
  if (age < MIN_FORM_AGE_MS || age > MAX_FORM_AGE_MS) throw new InputError();

  if (typeof value.requestId !== "string") throw new InputError();
  const requestId = value.requestId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestId)) {
    throw new InputError();
  }

  return { name, email, phone, requestId, startedAt: value.startedAt };
}

function isJsonContentType(contentType) {
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json";
}

function normalizedBase(value, fallback) {
  const base = typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  return base.replace(/\/+$/u, "");
}

function validHttpsBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function readConfig(env) {
  if (!env || env.INVESTOR_INTEREST_FROM !== FROM_ADDRESS) return null;

  const clientId = typeof env.ZOHO_CLIENT_ID === "string" ? env.ZOHO_CLIENT_ID : "";
  const clientSecret = typeof env.ZOHO_CLIENT_SECRET === "string" ? env.ZOHO_CLIENT_SECRET : "";
  const refreshToken = typeof env.ZOHO_REFRESH_TOKEN === "string" ? env.ZOHO_REFRESH_TOKEN : "";
  if (clientId.trim() === "" || clientSecret.trim() === "" || refreshToken.trim() === "") return null;

  const accountsBase = normalizedBase(env.ZOHO_ACCOUNTS_API, "https://accounts.zoho.eu");
  const mailBase = normalizedBase(env.ZOHO_MAIL_API, "https://mail.zoho.eu");
  if (!validHttpsBase(accountsBase) || !validHttpsBase(mailBase)) return null;

  return { clientId, clientSecret, refreshToken, accountsBase, mailBase, from: FROM_ADDRESS };
}

function injectedFetch(env) {
  const candidate = env && env.INVESTOR_INTEREST_FETCH;
  if (typeof candidate === "function") return candidate;
  return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
}

function cacheBinding(env) {
  const candidate = env && env.INVESTOR_INTEREST_CACHE;
  if (candidate && typeof candidate.match === "function" && typeof candidate.put === "function") {
    return candidate;
  }
  const nativeCache = globalThis.caches && globalThis.caches.default;
  if (nativeCache && typeof nativeCache.match === "function" && typeof nativeCache.put === "function") {
    return nativeCache;
  }
  return null;
}

function hashSalt(env) {
  return env && typeof env.INVESTOR_INTEREST_HASH_SALT === "string"
    ? env.INVESTOR_INTEREST_HASH_SALT
    : "";
}

async function sha256Hex(purpose, value, salt) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) throw new Error("crypto unavailable");
  const material = `${salt}\u0000${purpose}\u0000${value}`;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cacheKey(type, hash, suffix = "") {
  return `${CACHE_KEY_PREFIX}/${type}/${hash}${suffix}`;
}

async function cacheReadText(cache, key) {
  const response = await cache.match(new Request(key, { method: "GET" }));
  if (!response) return null;
  return response.text();
}

async function cacheWrite(cache, key, value, ttlSeconds) {
  const ttl = Math.max(MIN_CACHE_TTL_SECONDS, Math.ceil(ttlSeconds));
  await cache.put(
    new Request(key, { method: "GET" }),
    new Response(value, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": `public, max-age=${ttl}`,
      },
    }),
  );
}

function payloadFingerprintInput(input, source) {
  return JSON.stringify([
    1,
    input.name,
    input.email.toLowerCase(),
    input.phone,
    input.startedAt,
    source,
  ]);
}

function dedupStatus(text) {
  if (text === null) return null;
  const separator = text.indexOf(":");
  if (separator !== 1) return { state: "unknown", fingerprint: "" };
  return { state: text.slice(0, separator), fingerprint: text.slice(separator + 1) };
}

function retryAfterForWindow(now, windowMs) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1_000));
}

async function consumeWindow(cache, type, subjectHash, now, windowMs, limit) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = cacheKey(type, subjectHash, `/${windowStart}`);
  const existing = await cacheReadText(cache, key);
  let count = 0;
  if (existing !== null) {
    if (!/^\d+$/u.test(existing)) throw new Error("invalid cache counter");
    count = Number(existing);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid cache counter");
  }

  const retryAfter = retryAfterForWindow(now, windowMs);
  if (count >= limit) return { allowed: false, retryAfter };

  const ttl = Math.max(MIN_CACHE_TTL_SECONDS, retryAfter);
  await cacheWrite(cache, key, String(count + 1), ttl);
  return { allowed: true, retryAfter: 0 };
}

async function withRequestLock(key, work) {
  const previous = requestLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  requestLocks.set(key, tail);

  await previous;
  try {
    return await work();
  } finally {
    release();
    if (requestLocks.get(key) === tail) requestLocks.delete(key);
  }
}

async function fetchWithTimeout(fetchImpl, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readProviderJson(response) {
  let text;
  try {
    text = await response.text();
  } catch {
    throw new ProviderError(response.status);
  }
  if (text.length > 1_048_576) throw new ProviderError(response.status);

  let json;
  try {
    json = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new ProviderError(response.status);
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new ProviderError(response.status);
  }
  if (!response.ok) throw new ProviderError(response.status);
  return json;
}

function providerStatusCode(response, json) {
  const code = json && json.status && Number(json.status.code);
  return Number.isFinite(code) ? code : response.status;
}

async function refreshAccessToken(config, fetchImpl) {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${config.accountsBase}/oauth/v2/token`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
      }),
    },
  );
  const json = await readProviderJson(response);
  const accessToken = typeof json.access_token === "string" ? json.access_token.trim() : "";
  if (providerStatusCode(response, json) !== 200 || accessToken === "") {
    throw new ProviderError(providerStatusCode(response, json));
  }
  return accessToken;
}

async function accessToken(config, fetchImpl) {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.value;
  if (!tokenInFlight) {
    tokenInFlight = refreshAccessToken(config, fetchImpl)
      .then((value) => {
        tokenCache = { value, expiresAt: Date.now() + TOKEN_TTL_MS };
        return value;
      })
      .finally(() => {
        tokenInFlight = null;
      });
  }
  return tokenInFlight;
}

function forgetSession() {
  tokenCache = null;
  accountCache = null;
  tokenInFlight = null;
  accountInFlight = null;
}

function accountRows(json) {
  if (Array.isArray(json.data)) return json.data;
  if (json.data && typeof json.data === "object") return [json.data];
  return [];
}

async function discoverAccount(config, token, fetchImpl) {
  const response = await fetchWithTimeout(fetchImpl, `${config.mailBase}/api/accounts`, {
    method: "GET",
    headers: {
      authorization: `Zoho-oauthtoken ${token}`,
      accept: "application/json",
    },
  });
  const json = await readProviderJson(response);
  if (providerStatusCode(response, json) !== 200) {
    throw new ProviderError(providerStatusCode(response, json));
  }

  for (const row of accountRows(json)) {
    if (!row || typeof row !== "object") continue;
    const accountId = typeof row.accountId === "string" ? row.accountId.trim() : String(row.accountId || "").trim();
    const mailbox =
      typeof row.mailboxAddress === "string"
        ? row.mailboxAddress
        : typeof row.primaryEmailAddress === "string"
          ? row.primaryEmailAddress
          : typeof row.emailAddress === "string"
            ? row.emailAddress
            : "";
    if (accountId !== "" && mailbox.trim().toLowerCase() === config.from.toLowerCase()) {
      return accountId;
    }
  }
  throw new ProviderError(0);
}

async function accountIdFor(config, token, fetchImpl) {
  const now = Date.now();
  if (accountCache && accountCache.expiresAt > now) return accountCache.value;
  if (!accountInFlight) {
    accountInFlight = discoverAccount(config, token, fetchImpl)
      .then((value) => {
        accountCache = { value, expiresAt: Date.now() + ACCOUNT_TTL_MS };
        return value;
      })
      .finally(() => {
        accountInFlight = null;
      });
  }
  return accountInFlight;
}

async function postMessage(config, token, accountId, content, fetchImpl) {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${config.mailBase}/api/accounts/${encodeURIComponent(accountId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fromAddress: FROM_ADDRESS,
        toAddress: TO_ADDRESS,
        subject: SUBJECT,
        content,
        mailFormat: "plaintext",
      }),
    },
  );
  const json = await readProviderJson(response);
  const code = providerStatusCode(response, json);
  if (code !== 200) throw new ProviderError(code);

  const data = Array.isArray(json.data) ? json.data[0] : json.data;
  const record = data && typeof data === "object" ? data : {};
  const messageId =
    typeof record.messageId === "string"
      ? record.messageId.trim()
      : typeof record.mailId === "string"
        ? record.mailId.trim()
        : typeof json.messageId === "string"
          ? json.messageId.trim()
          : typeof json.mailId === "string"
            ? json.mailId.trim()
            : "";

  if (messageId === "") throw new ProviderError(0);
  return messageId;
}

async function sendWithZoho(config, content, fetchImpl) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await accessToken(config, fetchImpl);
    try {
      const accountId = await accountIdFor(config, token, fetchImpl);
      return await postMessage(config, token, accountId, content, fetchImpl);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 401 && attempt === 0) {
        forgetSession();
        continue;
      }
      throw error;
    }
  }
  throw new ProviderError(401);
}

function emailBody(input, source, receivedAt) {
  const lines = [
    "New BabyRock investor interest enquiry",
    "",
    `Name: ${input.name}`,
    `Email: ${input.email}`,
  ];
  if (input.phone !== "") lines.push(`Phone: ${input.phone}`);
  lines.push(`Source: ${source}`, `Received at: ${receivedAt}`, `Request ID: ${input.requestId}`);
  return lines.join("\n");
}

function clientIp(request) {
  const connectingIp = request.headers.get("cf-connecting-ip");
  if (connectingIp && connectingIp.trim() !== "") return connectingIp.trim().toLowerCase();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",", 1)[0].trim();
    if (first !== "") return first.toLowerCase();
  }
  return "unknown";
}

async function handlePost(request, env) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!isSameOriginRequest(requestUrl, origin)) return genericError(403);
  if (requestUrl.pathname !== "/api/investor-interest" && requestUrl.pathname !== "/api/investor-interest/") {
    return genericError(404);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) return genericError(415);

  const config = readConfig(env);
  const fetchImpl = injectedFetch(env);
  const cache = cacheBinding(env);
  if (!config || !fetchImpl || !cache) return genericError(503);

  let raw;
  try {
    raw = await readBodyWithinLimit(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return genericError(413);
    return genericError(400);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return genericError(400);
  }

  let input;
  const now = Date.now();
  try {
    input = validateSubmission(parsed, now);
  } catch {
    return genericError(400);
  }

  const salt = hashSalt(env);
  const requestHash = await sha256Hex("request", input.requestId, salt);
  const payloadHash = await sha256Hex(
    "payload",
    payloadFingerprintInput(input, requestUrl.host.toLowerCase()),
    salt,
  );
  const dedupKey = cacheKey("request", requestHash);

  return withRequestLock(`request:${requestHash}`, async () => {
    const existing = dedupStatus(await cacheReadText(cache, dedupKey));
    if (existing) {
      if (existing.fingerprint !== payloadHash) return genericError(409);
      if (existing.state === "a") return jsonResponse(200, { ok: true });
      return genericError(503, { "retry-after": 60 });
    }

    const ipHash = await sha256Hex("ip", clientIp(request), salt);
    const emailHash = await sha256Hex("email", input.email.toLowerCase(), salt);

    const ipWindow = await consumeWindow(cache, "ip", ipHash, now, IP_WINDOW_MS, IP_LIMIT);
    if (!ipWindow.allowed) return genericError(429, { "retry-after": ipWindow.retryAfter });

    const emailWindow = await consumeWindow(cache, "email", emailHash, now, EMAIL_WINDOW_MS, EMAIL_LIMIT);
    if (!emailWindow.allowed) return genericError(429, { "retry-after": emailWindow.retryAfter });

    await cacheWrite(cache, dedupKey, `p:${payloadHash}`, PENDING_TTL_SECONDS);

    const receivedAt = new Date(now).toISOString();
    const content = emailBody(input, requestUrl.host.toLowerCase(), receivedAt);

    try {
      await sendWithZoho(config, content, fetchImpl);
    } catch {
      try {
        await cacheWrite(cache, dedupKey, `p:${payloadHash}`, PENDING_TTL_SECONDS);
      } catch {
        // The pending entry was already written before the provider call. Do not replay here.
      }
      return genericError(503, { "retry-after": 60 });
    }

    try {
      await cacheWrite(cache, dedupKey, `a:${payloadHash}`, ACCEPTED_TTL_SECONDS);
    } catch {
      // Zoho accepted the message. Keep the pre-send pending entry so a retry is not resent.
    }
    return jsonResponse(200, { ok: true });
  });
}

export async function onRequest(context) {
  const request = context && context.request;
  if (!request || request.method !== "POST") return genericError(405, { allow: "POST" });

  try {
    return await handlePost(request, context.env);
  } catch {
    return genericError(503);
  }
}
