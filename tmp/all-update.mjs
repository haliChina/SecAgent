// src/update.test.ts
import assert from "node:assert/strict";
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import test from "node:test";

// src/update.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// src/marketplace.ts
var DEFAULT_MARKETPLACE_PROXY_URL = "https://ghproxy.sectl.cn";
var RELEASE_CACHE_TTL_MS = 10 * 60 * 1e3;
function marketplaceRequestUrls(directUrl) {
  if (!/^https:\/\/(?:api\.github\.com|github\.com|raw\.githubusercontent\.com)\//i.test(directUrl)) return [directUrl];
  return [`${DEFAULT_MARKETPLACE_PROXY_URL}/${directUrl}`, directUrl];
}
function parseVersion(value) {
  const match = value.trim().replace(/^v/i, "").match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return void 0;
  return { core: match[1].split(".").map(Number), pre: match[2] ? match[2].split(".") : [] };
}
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return left === right ? 0 : left.localeCompare(right, void 0, { numeric: true });
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const difference = (a.core[i] || 0) - (b.core[i] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === void 0) return -1;
    if (b.pre[i] === void 0) return 1;
    if (a.pre[i] === b.pre[i]) continue;
    const aNumber = /^\d+$/.test(a.pre[i]);
    const bNumber = /^\d+$/.test(b.pre[i]);
    if (aNumber && bNumber) return Number(a.pre[i]) > Number(b.pre[i]) ? 1 : -1;
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    return a.pre[i].localeCompare(b.pre[i]);
  }
  return 0;
}

// src/update-public-key.ts
var OFFICIAL_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/1lg46DLPB2GvMNdxKHTPDmUnUIsVDC0OlphsPYrwoQ=
-----END PUBLIC KEY-----
`;

// src/update.ts
var UPDATE_REPOSITORY = "SECTL/SecAgent";
var UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100`;
var UPDATE_METADATA_URL = `https://raw.githubusercontent.com/${UPDATE_REPOSITORY}/refs/heads/master/updates.json`;
var UPDATE_METADATA_SCHEMA_VERSION = 1;
var UpdateRequestError = class extends Error {
  constructor(message, attempts, lastStatus) {
    super(message);
    this.attempts = attempts;
    this.lastStatus = lastStatus;
    this.name = "UpdateRequestError";
  }
  attempts;
  lastStatus;
};
var UpdateMetadataSignatureError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UpdateMetadataSignatureError";
  }
};
var VERSION_PATTERN = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/;
var SHA256_PATTERN = /^[a-f0-9]{64}$/i;
var UPDATE_HEADER_TIMEOUT_MS = 12e3;
var UPDATE_BODY_IDLE_TIMEOUT_MS = 6e4;
var UPDATE_REQUEST_TIMEOUTS = { headerMs: UPDATE_HEADER_TIMEOUT_MS, bodyIdleMs: UPDATE_BODY_IDLE_TIMEOUT_MS };
function resolveRequestTimeouts(hooks) {
  return { ...UPDATE_REQUEST_TIMEOUTS, ...hooks.timeoutMs };
}
function normalizeReleaseVersion(tag) {
  return VERSION_PATTERN.exec(tag.trim())?.[1];
}
function releaseAssetName(version) {
  return `SecAgent-Setup-${version}.exe`;
}
function readPendingUpdate(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (typeof value.path !== "string" || typeof value.version !== "string" || value.channel !== "stable" && value.channel !== "preview" || typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256) || typeof value.assetName !== "string" || typeof value.downloadedAt !== "string") return void 0;
    return { path: value.path, version: value.version, channel: value.channel, sha256: value.sha256.toLowerCase(), assetName: value.assetName, downloadedAt: value.downloadedAt, ...typeof value.verifiedSha256 === "string" && SHA256_PATTERN.test(value.verifiedSha256) ? { verifiedSha256: value.verifiedSha256.toLowerCase() } : {} };
  } catch {
    return void 0;
  }
}
function writePendingUpdate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}
`, "utf8");
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temporary, filePath);
}
async function findLatestUpdate(channel, currentVersion, fetcher = fetch, hooks = {}) {
  try {
    const response2 = await requestGitHub(appendCacheBust(UPDATE_METADATA_URL), fetcher, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache", "User-Agent": "SecAgent" }
    }, "metadata", hooks);
    const metadata = verifyUpdateMetadata(await response2.text(), hooks.publicKey || OFFICIAL_UPDATE_PUBLIC_KEY);
    const entry = metadata.channels[channel];
    if (!entry) throw new Error(`\u66F4\u65B0\u6E05\u5355\u7F3A\u5C11 ${channel} \u901A\u9053`);
    const release = metadataEntryToRelease(entry, channel);
    hooks.onEvent?.({ name: "metadata.accepted", data: { channel, version: release.version, tag: release.tag } });
    return compareVersions(release.version, currentVersion) > 0 ? release : void 0;
  } catch (error) {
    if (error instanceof UpdateMetadataSignatureError) throw error;
    hooks.onEvent?.({ name: "metadata.fallback", data: { error: errorMessage(error) } });
  }
  const response = await requestGitHub(appendCacheBust(UPDATE_API_URL), fetcher, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "SecAgent" }
  }, "release-api", hooks);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("GitHub Release \u5217\u8868\u683C\u5F0F\u65E0\u6548");
  const candidates = payload.map((item) => toUpdateRelease(item, channel)).filter((item) => Boolean(item)).filter((item) => compareVersions(item.version, currentVersion) > 0).sort((left, right) => compareVersions(right.version, left.version));
  return candidates[0];
}
async function downloadUpdate(release, storageDirectory, fetcher = fetch, onProgress, hooks = {}) {
  const expectedSha = await expectedSha256(release, fetcher, hooks);
  if (!expectedSha) throw new Error("GitHub Release \u7F3A\u5C11\u6709\u6548\u7684 SHA-256 \u6821\u9A8C\u503C");
  const response = await requestGitHub(release.assetUrl, fetcher, { headers: { "User-Agent": "SecAgent" } }, "asset", hooks);
  const bytes = await readResponseBytes(response, resolveRequestTimeouts(hooks).bodyIdleMs, onProgress);
  const actualSha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) throw new Error("\u66F4\u65B0\u5B89\u88C5\u5305 SHA-256 \u6821\u9A8C\u5931\u8D25");
  fs.mkdirSync(storageDirectory, { recursive: true });
  const destination = path.join(storageDirectory, release.assetName);
  const temporary = `${destination}.${crypto.randomUUID()}.download`;
  fs.writeFileSync(temporary, bytes);
  fs.rmSync(destination, { force: true });
  fs.renameSync(temporary, destination);
  return {
    pending: {
      path: destination,
      version: release.version,
      channel: release.channel,
      sha256: actualSha,
      assetName: release.assetName,
      downloadedAt: (/* @__PURE__ */ new Date()).toISOString(),
      // The bytes were hashed in memory a moment ago; persist that verdict so
      // quit-time validation is a string compare instead of a fresh file hash.
      verifiedSha256: actualSha
    },
    bytes: bytes.length
  };
}
function verifyUpdateMetadata(value, publicKey) {
  let parsed;
  try {
    parsed = JSON.parse(value.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("SecAgent \u66F4\u65B0\u6E05\u5355\u4E0D\u662F\u6709\u6548 JSON");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== UPDATE_METADATA_SCHEMA_VERSION || parsed.product !== "SecAgent" || typeof parsed.generatedAt !== "string" || !isRecord(parsed.channels) || typeof parsed.signature !== "string") {
    throw new Error("SecAgent \u66F4\u65B0\u6E05\u5355\u683C\u5F0F\u65E0\u6548");
  }
  let signature;
  try {
    signature = Buffer.from(parsed.signature, "base64");
  } catch {
    throw new UpdateMetadataSignatureError("SecAgent \u66F4\u65B0\u6E05\u5355\u7B7E\u540D\u7F16\u7801\u65E0\u6548");
  }
  const unsigned = { schemaVersion: parsed.schemaVersion, product: parsed.product, generatedAt: parsed.generatedAt, channels: parsed.channels };
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(canonicalizeUpdateJson(unsigned), "utf8"), publicKey, signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new UpdateMetadataSignatureError("SecAgent \u66F4\u65B0\u6E05\u5355\u7B7E\u540D\u6821\u9A8C\u5931\u8D25");
  const channels = {};
  for (const channel of ["stable", "preview"]) {
    const entry = parsed.channels[channel];
    if (entry === void 0) continue;
    channels[channel] = validateMetadataEntry(entry, channel);
  }
  return { schemaVersion: UPDATE_METADATA_SCHEMA_VERSION, product: "SecAgent", generatedAt: parsed.generatedAt, channels, signature: parsed.signature };
}
function validateMetadataEntry(value, channel) {
  if (!isRecord(value) || value.channel !== channel || typeof value.version !== "string" || typeof value.tag !== "string" || typeof value.assetName !== "string" || typeof value.assetUrl !== "string" || typeof value.htmlUrl !== "string" || typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256) || !isGitHubUrl(value.assetUrl) || !isGitHubUrl(value.htmlUrl)) {
    throw new Error(`SecAgent ${channel} \u66F4\u65B0\u6E05\u5355\u5185\u5BB9\u65E0\u6548`);
  }
  const version = normalizeReleaseVersion(value.version);
  const tagVersion = normalizeReleaseVersion(value.tag);
  if (!version || !tagVersion || version !== tagVersion || value.assetName !== releaseAssetName(version)) throw new Error(`SecAgent ${channel} \u66F4\u65B0\u6E05\u5355\u7248\u672C\u4FE1\u606F\u4E0D\u4E00\u81F4`);
  if (typeof value.size !== "undefined" && (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size <= 0)) throw new Error(`SecAgent ${channel} \u66F4\u65B0\u6E05\u5355\u6587\u4EF6\u5927\u5C0F\u65E0\u6548`);
  if (typeof value.body !== "undefined" && typeof value.body !== "string") throw new Error(`SecAgent ${channel} \u66F4\u65B0\u6E05\u5355\u66F4\u65B0\u8BF4\u660E\u65E0\u6548`);
  if (typeof value.publishedAt !== "undefined" && typeof value.publishedAt !== "string") throw new Error(`SecAgent ${channel} \u66F4\u65B0\u6E05\u5355\u53D1\u5E03\u65F6\u95F4\u65E0\u6548`);
  return {
    channel,
    version,
    tag: value.tag,
    assetName: value.assetName,
    assetUrl: value.assetUrl,
    htmlUrl: value.htmlUrl,
    sha256: value.sha256.toLowerCase(),
    ...typeof value.size === "number" ? { size: value.size } : {},
    ...typeof value.body === "string" ? { body: value.body } : {},
    ...typeof value.publishedAt === "string" ? { publishedAt: value.publishedAt } : {}
  };
}
function metadataEntryToRelease(entry, channel) {
  const releaseType = releaseTypeFromVersion(entry.version);
  return {
    version: entry.version,
    tag: entry.tag,
    ...releaseType ? { releaseType } : {},
    channel,
    htmlUrl: entry.htmlUrl,
    body: entry.body || "",
    ...entry.publishedAt ? { publishedAt: entry.publishedAt } : {},
    assetName: entry.assetName,
    assetUrl: entry.assetUrl,
    sha256: entry.sha256,
    ...entry.size !== void 0 ? { size: entry.size } : {}
  };
}
async function expectedSha256(release, fetcher, hooks) {
  const digest = release.sha256 && SHA256_PATTERN.test(release.sha256) ? release.sha256.toLowerCase() : void 0;
  let sidecarDigest;
  if (release.checksumUrl) {
    const response = await requestGitHub(release.checksumUrl, fetcher, { headers: { "User-Agent": "SecAgent" } }, "checksum", hooks);
    sidecarDigest = parseChecksum(await response.text());
  }
  if (digest && sidecarDigest && digest !== sidecarDigest) throw new Error("Release SHA-256 \u6821\u9A8C\u6587\u4EF6\u4E0E\u8D44\u6E90\u6458\u8981\u4E0D\u4E00\u81F4");
  return digest || sidecarDigest;
}
function toUpdateRelease(raw, channel) {
  if (raw.draft === true || raw.prerelease !== (channel === "preview") || typeof raw.tag_name !== "string" || !Array.isArray(raw.assets)) return void 0;
  const version = normalizeReleaseVersion(raw.tag_name);
  if (!version) return void 0;
  const assetName = releaseAssetName(version);
  const assets = raw.assets;
  const asset = assets.find((item) => item.name === assetName && typeof item.browser_download_url === "string");
  if (!asset || !isGitHubUrl(asset.browser_download_url)) return void 0;
  const checksum = assets.find((item) => item.name === `${assetName}.sha256` && typeof item.browser_download_url === "string" && isGitHubUrl(item.browser_download_url));
  const digest = typeof asset.digest === "string" ? asset.digest.match(/^sha256:([a-f0-9]{64})$/i)?.[1].toLowerCase() : void 0;
  const releaseType = releaseTypeFromVersion(version);
  return {
    version,
    tag: raw.tag_name,
    ...releaseType ? { releaseType } : {},
    channel,
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : `https://github.com/${UPDATE_REPOSITORY}/releases/tag/${encodeURIComponent(raw.tag_name)}`,
    body: typeof raw.body === "string" ? raw.body : "",
    ...typeof raw.published_at === "string" ? { publishedAt: raw.published_at } : {},
    assetName,
    assetUrl: asset.browser_download_url,
    ...digest ? { sha256: digest } : {},
    ...checksum ? { checksumUrl: checksum.browser_download_url } : {},
    ...typeof asset.size === "number" ? { size: asset.size } : {}
  };
}
function releaseTypeFromVersion(version) {
  if (/-alpha(?:[0-9.-]|$)/i.test(version)) return "alpha";
  if (/-beta(?:[0-9.-]|$)/i.test(version)) return "beta";
  return void 0;
}
async function requestGitHub(url, fetcher, init, phase, hooks) {
  const attempts = [];
  let lastError;
  let lastStatus;
  for (const candidate of marketplaceRequestUrls(url)) {
    const startedAt = Date.now();
    const route = candidate.startsWith(`${DEFAULT_MARKETPLACE_PROXY_URL}/`) ? "proxy" : "direct";
    const controller = new AbortController();
    const headerTimer = setTimeout(() => controller.abort(), resolveRequestTimeouts(hooks).headerMs);
    try {
      const response = await fetcher(candidate, { ...init, signal: controller.signal });
      const attempt = {
        phase,
        route,
        url: redactUrl(candidate),
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type") || void 0,
        responseBytes: parseContentLength(response.headers.get("content-length")),
        durationMs: Date.now() - startedAt,
        ...response.ok ? {} : { error: `HTTP ${response.status}` }
      };
      attempts.push(attempt);
      hooks.onAttempt?.(attempt);
      if (response.ok) return response;
      lastStatus = response.status;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      const attempt = {
        phase,
        route,
        url: redactUrl(candidate),
        ok: false,
        durationMs: Date.now() - startedAt,
        error: errorMessage(error)
      };
      attempts.push(attempt);
      hooks.onAttempt?.(attempt);
      lastError = error;
    } finally {
      clearTimeout(headerTimer);
    }
  }
  throw new UpdateRequestError(`\u65E0\u6CD5\u8BBF\u95EE GitHub \u66F4\u65B0\u670D\u52A1\uFF1A${errorMessage(lastError)}`, attempts, lastStatus);
}
async function readResponseBytes(response, bodyIdleMs, onProgress) {
  const totalHeader = response.headers.get("content-length");
  const totalBytes = totalHeader && Number.isFinite(Number(totalHeader)) ? Number(totalHeader) : void 0;
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    onProgress?.({ downloadedBytes: bytes.length, ...totalBytes ? { totalBytes } : {} });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let downloadedBytes = 0;
  while (true) {
    let result;
    try {
      result = await raceWithTimer(reader.read(), bodyIdleMs);
    } catch (error) {
      await reader.cancel(error).catch(() => void 0);
      throw error;
    }
    if (result.done) break;
    const chunk = Buffer.from(result.value);
    chunks.push(chunk);
    downloadedBytes += chunk.length;
    onProgress?.({ downloadedBytes, ...totalBytes ? { totalBytes } : {} });
  }
  return Buffer.concat(chunks);
}
function readResponseTimeoutError() {
  return new Error(`\u66F4\u65B0\u4E0B\u8F7D\u4E2D\u65AD\uFF1A\u8FDE\u63A5\u8D85\u8FC7 ${Math.round(UPDATE_BODY_IDLE_TIMEOUT_MS / 1e3)} \u79D2\u6CA1\u6709\u4F20\u8F93\u6570\u636E`);
}
async function raceWithTimer(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(readResponseTimeoutError()), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function parseChecksum(value) {
  const line = value.split(/\r?\n/).find((item) => SHA256_PATTERN.test(item.trim().split(/\s+/)[0] || ""));
  return line?.trim().split(/\s+/)[0]?.toLowerCase();
}
function appendCacheBust(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}secagent_cache=${Date.now()}`;
}
function canonicalizeUpdateJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeUpdateJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeUpdateJson(item)}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === void 0) throw new Error("\u65E0\u6CD5\u89C4\u8303\u5316\u672A\u5B9A\u4E49 JSON \u503C");
  return serialized;
}
function parseContentLength(value) {
  if (!value) return void 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : void 0;
}
function redactUrl(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isGitHubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "github.com" || url.hostname === "api.github.com" || url.hostname === "raw.githubusercontent.com");
  } catch {
    return false;
  }
}

// src/update.test.ts
test("normalizes release versions and labels alpha/beta versions", () => {
  assert.equal(normalizeReleaseVersion("v1.2.3"), "1.2.3");
  assert.equal(normalizeReleaseVersion("1.2.3-beta.2"), "1.2.3-beta.2");
  assert.equal(normalizeReleaseVersion("release-1.2.3"), void 0);
});
test("selects the newest release from the requested channel", async () => {
  const bytes = Buffer.from("installer");
  const digest = crypto2.createHash("sha256").update(bytes).digest("hex");
  const fetcher = async (input) => {
    const url = String(input);
    if (url.includes("api.github.com")) return new Response(JSON.stringify([
      { tag_name: "v1.0.0", prerelease: false, draft: false, assets: [] },
      { tag_name: "v1.2.0-alpha.1", prerelease: true, draft: false, assets: [{ name: releaseAssetName("1.2.0-alpha.1"), browser_download_url: "https://github.com/SECTL/SecAgent/releases/download/v1.2.0-alpha.1/SecAgent-Setup-1.2.0-alpha.1.exe", digest: `sha256:${digest}` }] },
      { tag_name: "v1.3.0-beta.1", prerelease: true, draft: false, assets: [{ name: releaseAssetName("1.3.0-beta.1"), browser_download_url: "https://github.com/SECTL/SecAgent/releases/download/v1.3.0-beta.1/SecAgent-Setup-1.3.0-beta.1.exe", digest: `sha256:${digest}` }] },
      { tag_name: "v9.0.0-alpha.1", prerelease: true, draft: true, assets: [] }
    ]));
    throw new Error(`unexpected URL ${url}`);
  };
  const release = await findLatestUpdate("preview", "1.0.0", fetcher);
  assert.equal(release?.version, "1.3.0-beta.1");
  assert.equal(release?.releaseType, "beta");
  const stable = await findLatestUpdate("stable", "1.0.0", fetcher);
  assert.equal(stable, void 0);
});
test("downloads and verifies an installer with the release checksum", async () => {
  const bytes = Buffer.from("installer bytes");
  const digest = crypto2.createHash("sha256").update(bytes).digest("hex");
  const release = {
    version: "1.2.0-alpha.1",
    tag: "v1.2.0-alpha.1",
    releaseType: "alpha",
    channel: "preview",
    htmlUrl: "https://github.com/SECTL/SecAgent/releases/tag/v1.2.0-alpha.1",
    body: "notes",
    assetName: releaseAssetName("1.2.0-alpha.1"),
    assetUrl: "https://github.com/SECTL/SecAgent/releases/download/v1.2.0-alpha.1/SecAgent-Setup-1.2.0-alpha.1.exe",
    checksumUrl: "https://github.com/SECTL/SecAgent/releases/download/v1.2.0-alpha.1/SecAgent-Setup-1.2.0-alpha.1.exe.sha256",
    sha256: digest
  };
  const root = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-update-"));
  try {
    const fetcher = async (input) => {
      const url = String(input);
      if (url.endsWith(".sha256")) return new Response(`${digest}  ${release.assetName}
`);
      if (url.endsWith(".exe")) return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
      throw new Error(`unexpected URL ${url}`);
    };
    const progress = [];
    const result = await downloadUpdate(release, root, fetcher, (item) => progress.push(item.downloadedBytes));
    assert.equal(fs2.readFileSync(result.pending.path).toString(), bytes.toString());
    assert.equal(result.pending.sha256, digest);
    assert.ok(progress.length >= 1);
    const stateFile = path2.join(root, "pending.json");
    writePendingUpdate(stateFile, result.pending);
    assert.deepEqual(readPendingUpdate(stateFile), result.pending);
  } finally {
    fs2.rmSync(root, { recursive: true, force: true });
  }
});
test("allows a slow installer body to finish after the request timeout", async () => {
  const bytes = Buffer.from("slow installer bytes");
  const digest = crypto2.createHash("sha256").update(bytes).digest("hex");
  const release = {
    version: "1.2.0-alpha.2",
    tag: "v1.2.0-alpha.2",
    releaseType: "alpha",
    channel: "preview",
    htmlUrl: "https://github.com/SECTL/SecAgent/releases/tag/v1.2.0-alpha.2",
    body: "",
    assetName: releaseAssetName("1.2.0-alpha.2"),
    assetUrl: "https://github.com/SECTL/SecAgent/releases/download/v1.2.0-alpha.2/SecAgent-Setup-1.2.0-alpha.2.exe",
    sha256: digest
  };
  const root = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-update-slow-"));
  try {
    const fetcher = async (input, init) => {
      if (!String(input).endsWith(".exe")) throw new Error(`unexpected URL ${String(input)}`);
      const signal = init?.signal;
      const stream = new ReadableStream({
        start(controller) {
          const timer = setTimeout(() => {
            controller.enqueue(bytes);
            controller.close();
          }, 30);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            controller.error(signal.reason);
          }, { once: true });
        }
      });
      return new Response(stream, { headers: { "content-length": String(bytes.length) } });
    };
    const result = await downloadUpdate(release, root, fetcher, void 0, { timeoutMs: { headerMs: 10, bodyIdleMs: 500 } });
    assert.equal(fs2.readFileSync(result.pending.path).toString(), bytes.toString());
    assert.equal(result.pending.sha256, digest);
  } finally {
    fs2.rmSync(root, { recursive: true, force: true });
  }
});
test("aborts a stalled installer body within the asset timeout", async () => {
  const bytes = Buffer.from("never completed");
  const digest = crypto2.createHash("sha256").update(bytes).digest("hex");
  const release = {
    version: "1.2.0-alpha.3",
    tag: "v1.2.0-alpha.3",
    releaseType: "alpha",
    channel: "preview",
    htmlUrl: "https://github.com/SECTL/SecAgent/releases/tag/v1.2.0-alpha.3",
    body: "",
    assetName: releaseAssetName("1.2.0-alpha.3"),
    assetUrl: "https://github.com/SECTL/SecAgent/releases/download/v1.2.0-alpha.3/SecAgent-Setup-1.2.0-alpha.3.exe",
    sha256: digest
  };
  const root = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-update-stalled-"));
  try {
    const fetcher = async (_input, init) => {
      const signal = init?.signal;
      const stream = new ReadableStream({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        }
      });
      return new Response(stream, { headers: { "content-length": String(bytes.length) } });
    };
    await assert.rejects(
      downloadUpdate(release, root, fetcher, void 0, { timeoutMs: { headerMs: 10, bodyIdleMs: 20 } }),
      /没有传输数据/
    );
    assert.equal(fs2.existsSync(path2.join(root, release.assetName)), false);
  } finally {
    fs2.rmSync(root, { recursive: true, force: true });
  }
});
test("streams an installer across header-deadline chunk gaps", async () => {
  const bytes = Buffer.from("0123456789".repeat(8));
  const digest = crypto2.createHash("sha256").update(bytes).digest("hex");
  const release = {
    version: "1.2.0-alpha.4",
    tag: "v1.2.0-alpha.4",
    releaseType: "alpha",
    channel: "preview",
    htmlUrl: "https://github.com/SECTL/SecAgent/releases/tag/v1.2.0-alpha.4",
    body: "",
    assetName: releaseAssetName("1.2.0-alpha.4"),
    assetUrl: "https://github.com/SECTL/SecAgent/releases/download/v1.2.0-alpha.4/SecAgent-Setup-1.2.0-alpha.4.exe",
    sha256: digest
  };
  const root = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-update-gaps-"));
  try {
    const fetcher = async (input, init) => {
      if (!String(input).endsWith(".exe")) throw new Error(`unexpected URL ${String(input)}`);
      const signal = init?.signal;
      const stream = new ReadableStream({
        async start(controller) {
          for (const byte of bytes) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            if (signal?.aborted) {
              controller.error(new Error("aborted mid-stream"));
              return;
            }
            controller.enqueue(Uint8Array.of(byte));
          }
          controller.close();
        }
      });
      return new Response(stream, { headers: { "content-length": String(bytes.length) } });
    };
    const progress = [];
    const result = await downloadUpdate(release, root, fetcher, (item) => progress.push(item.downloadedBytes), { timeoutMs: { headerMs: 10, bodyIdleMs: 500 } });
    assert.equal(fs2.readFileSync(result.pending.path).toString(), bytes.toString());
    assert.equal(progress[progress.length - 1], bytes.length);
  } finally {
    fs2.rmSync(root, { recursive: true, force: true });
  }
});
test("falls back from the GitHub proxy to direct access", async () => {
  const calls = [];
  const fetcher = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) throw new Error("proxy unavailable");
    return new Response(JSON.stringify([{ tag_name: "v1.1.0", prerelease: false, draft: false, assets: [{ name: releaseAssetName("1.1.0"), browser_download_url: "https://github.com/SECTL/SecAgent/releases/download/v1.1.0/SecAgent-Setup-1.1.0.exe", digest: `sha256:${"a".repeat(64)}` }] }]));
  };
  const release = await findLatestUpdate("stable", "1.0.0", fetcher);
  assert.equal(release?.version, "1.1.0");
  assert.match(calls[0], /ghproxy\.sectl\.cn/);
  assert.equal(calls.some((url) => url.includes("api.github.com")), true);
});
test("prefers a signed channel metadata document over the GitHub releases API", async () => {
  const keyPair = crypto2.generateKeyPairSync("ed25519");
  const unsigned = {
    schemaVersion: 1,
    product: "SecAgent",
    generatedAt: "2026-08-27T00:00:00.000Z",
    channels: {
      preview: {
        channel: "preview",
        version: "1.2.0-alpha.1",
        tag: "v1.2.0-alpha.1",
        assetName: releaseAssetName("1.2.0-alpha.1"),
        assetUrl: "https://github.com/SECTL/SecAgent/releases/download/v1.2.0-alpha.1/SecAgent-Setup-1.2.0-alpha.1.exe",
        htmlUrl: "https://github.com/SECTL/SecAgent/releases/tag/v1.2.0-alpha.1",
        sha256: "a".repeat(64),
        size: 123
      }
    }
  };
  const metadata = {
    ...unsigned,
    signature: crypto2.sign(null, Buffer.from(canonicalizeUpdateJson(unsigned), "utf8"), keyPair.privateKey).toString("base64")
  };
  const calls = [];
  const fetcher = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("updates.json")) return new Response(JSON.stringify(metadata), { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  };
  const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const release = await findLatestUpdate("preview", "1.0.0", fetcher, { publicKey });
  assert.equal(release?.version, "1.2.0-alpha.1");
  assert.equal(calls.every((url) => url.includes("updates.json")), true);
});
test("records both update routes when the metadata and releases API are unavailable", async () => {
  const attempts = [];
  const fetcher = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(
    findLatestUpdate("stable", "1.0.0", fetcher, { onAttempt: (attempt) => attempts.push(attempt) }),
    /无法访问 GitHub 更新服务/
  );
  assert.deepEqual(attempts.map((attempt) => `${attempt.phase}:${attempt.route}:${attempt.status}`), [
    "metadata:proxy:503",
    "metadata:direct:503",
    "release-api:proxy:503",
    "release-api:direct:503"
  ]);
});
