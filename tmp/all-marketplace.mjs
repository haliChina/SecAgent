// src/marketplace.test.ts
import assert from "node:assert/strict";
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import test from "node:test";

// src/marketplace.ts
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var OFFICIAL_MARKETPLACE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVDhccL78MVtRDCXjUXiYRwdXhnCJDCAvyDsQduJdC8s=
-----END PUBLIC KEY-----`;
var DEFAULT_MARKETPLACE_INDEX_URL = "https://raw.githubusercontent.com/SECTL/secagent-plugin-marketplace/refs/heads/main/index.json";
var DEFAULT_MARKETPLACE_PROXY_URL = "https://ghproxy.sectl.cn";
var HOST_API_VERSION = 1;
var RELEASE_CACHE_TTL_MS = 10 * 60 * 1e3;
var MarketplaceClient = class {
  constructor(indexUrl = process.env.SECAGENT_PLUGIN_MARKET_URL || DEFAULT_MARKETPLACE_INDEX_URL, publicKey2 = OFFICIAL_MARKETPLACE_PUBLIC_KEY, fetcher = fetch) {
    this.indexUrl = indexUrl;
    this.publicKey = publicKey2;
    this.fetcher = fetcher;
  }
  indexUrl;
  publicKey;
  fetcher;
  releaseCache = /* @__PURE__ */ new Map();
  releaseRequests = /* @__PURE__ */ new Map();
  updateOperation = Promise.resolve();
  async list() {
    const index = await this.fetchVerifiedIndex();
    const metadata = await Promise.all(index.plugins.map(async (reference) => ({
      reference,
      plugin: await this.fetchPluginMetadata(reference)
    })));
    const compatible = metadata.filter(({ plugin }) => isCompatibleMetadata(plugin));
    return Promise.all(compatible.map(async ({ reference, plugin }) => {
      const base = {
        id: plugin.id,
        format: plugin.format,
        name: plugin.name,
        description: plugin.description,
        repository: plugin.repository,
        icon: plugin.icon,
        readme: await resolveMarketplaceReadme(plugin.readme, this.fetcher)
      };
      try {
        const latest = reference.latest ? validateMarketplaceVersion(reference.latest) : await this.resolveRelease(plugin);
        return latest ? { ...base, latest } : { ...base, releaseError: "\u6682\u65E0\u53EF\u7528 Release" };
      } catch (error) {
        return { ...base, releaseError: error instanceof Error ? error.message : String(error) };
      }
    }));
  }
  async install(manager, version) {
    if (!isAllowedMarketUrl(version.assetUrl) || !/^[a-fA-F0-9]{64}$/.test(version.sha256)) {
      throw new Error("\u5E02\u573A\u63D2\u4EF6\u8D44\u4EA7\u4FE1\u606F\u65E0\u6548");
    }
    const bytes = await downloadMarketplaceAsset(version.assetUrl, version.sha256, this.fetcher);
    const temporary = path.join(os.tmpdir(), `secagent-plugin-${crypto.randomUUID()}.zip`);
    try {
      fs.writeFileSync(temporary, bytes);
      await manager.install(temporary);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  /**
   * Lightweight update check for the background poll: reads only the signed
   * index (one request) instead of the full catalog, keeping a 10-minute
   * cadence friendly to the shared proxy. References without embedded release
   * data (older indexes) are skipped; the market tab still resolves those via
   * {@link list}.
   */
  async checkUpdates(installed) {
    const index = await this.fetchVerifiedIndex();
    const candidates = [];
    for (const entry of installed) {
      const reference = index.plugins.find((candidate) => candidate.id === entry.id);
      if (!reference?.latest) continue;
      let latest;
      try {
        latest = validateMarketplaceVersion(reference.latest);
      } catch {
        continue;
      }
      if (!isCompatibleVersion(latest) || compareVersions(latest.version, entry.version) <= 0) continue;
      candidates.push({ id: entry.id, from: entry.version, to: latest.version, version: latest });
    }
    return candidates;
  }
  /** Hot-swaps every installed plugin that lags behind the signed index. */
  async installUpdates(manager) {
    return this.runUpdateOperation(async () => {
      const candidates = await this.checkUpdates(manager.list());
      const updates = [];
      const errors = [];
      for (const candidate of candidates) {
        try {
          await this.install(manager, candidate.version);
          updates.push({ id: candidate.id, from: candidate.from, to: candidate.to });
        } catch (error) {
          errors.push({ id: candidate.id, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { updates, errors };
    });
  }
  /**
   * Single-plugin variant for the manual "check for updates" action. Returns
   * {@link updated} false when the plugin already matches the signed index.
   */
  async updatePlugin(manager, id) {
    return this.runUpdateOperation(async () => {
      const installed = manager.list().find((plugin) => plugin.id === id);
      if (!installed) throw new Error(`\u672A\u5B89\u88C5\u63D2\u4EF6\uFF1A${id}`);
      const candidate = (await this.checkUpdates([installed])).find((item) => item.id === id);
      if (!candidate) return { id, from: installed.version, to: installed.version, updated: false };
      await this.install(manager, candidate.version);
      return { id, from: candidate.from, to: candidate.to, updated: true };
    });
  }
  /** Serializes update rounds so a slow download cannot overlap the next poll. */
  runUpdateOperation(operation) {
    const result = this.updateOperation.then(() => operation());
    this.updateOperation = result.then(() => void 0, () => void 0);
    return result;
  }
  async fetchVerifiedIndex() {
    if (!this.indexUrl) throw new Error("\u672A\u914D\u7F6E\u63D2\u4EF6\u5E02\u573A\u5730\u5740\uFF0C\u8BF7\u8BBE\u7F6E SECAGENT_PLUGIN_MARKET_URL");
    if (!isAllowedMarketUrl(this.indexUrl)) throw new Error("\u63D2\u4EF6\u5E02\u573A\u5FC5\u987B\u4F7F\u7528 HTTPS \u5730\u5740\uFF1B\u672C\u5730\u6D4B\u8BD5\u4EC5\u5141\u8BB8\u56DE\u73AF\u5730\u5740");
    const index = await fetchMarketplaceIndex(this.indexUrl, this.fetcher);
    this.verifyIndex(index);
    return index;
  }
  async fetchPluginMetadata(reference) {
    const pluginUrl = resolvePluginPath(this.indexUrl, reference.path);
    const bytes = await fetchMarketplaceBytes(pluginUrl, this.fetcher, 12e3, void 0, reference.sha256);
    const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualSha256.toLowerCase() !== reference.sha256.toLowerCase()) {
      throw new Error(`\u63D2\u4EF6\u7D22\u5F15\u6587\u4EF6\u6821\u9A8C\u5931\u8D25\uFF1A${reference.id}`);
    }
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch {
      throw new Error(`\u63D2\u4EF6\u7D22\u5F15\u6587\u4EF6\u4E0D\u662F\u6709\u6548 JSON\uFF1A${reference.id}`);
    }
    if (!isMarketplacePluginMetadata(value) || value.id !== reference.id) {
      throw new Error(`\u63D2\u4EF6\u7D22\u5F15\u6587\u4EF6\u683C\u5F0F\u65E0\u6548\uFF1A${reference.id}`);
    }
    return value;
  }
  async resolveRelease(plugin) {
    const spec = plugin.release;
    const key = `${spec.provider}:${spec.owner}/${spec.repo}:${spec.assetName}:${spec.includePrerelease === true}`;
    const cached = this.releaseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.error) throw new Error(cached.error);
      return cached.result;
    }
    const inFlight = this.releaseRequests.get(key);
    if (inFlight) {
      const result2 = await inFlight;
      if (result2.error) throw new Error(result2.error);
      return result2.result;
    }
    const request = this.loadRelease(plugin).then((result2) => {
      this.releaseCache.set(key, { ...result2, expiresAt: Date.now() + RELEASE_CACHE_TTL_MS });
      return result2;
    }).finally(() => this.releaseRequests.delete(key));
    this.releaseRequests.set(key, request);
    const result = await request;
    if (result.error) throw new Error(result.error);
    return result.result;
  }
  async loadRelease(plugin) {
    try {
      if (plugin.release.provider !== "github") throw new Error("\u4E0D\u652F\u6301\u7684 Release \u63D0\u4F9B\u65B9");
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(plugin.release.owner)}/${encodeURIComponent(plugin.release.repo)}/releases/latest`;
      const response = await fetchMarketplaceResource(apiUrl, this.fetcher, 12e3, {
        Accept: "application/vnd.github+json",
        "User-Agent": "SecAgent"
      });
      const release = await response.json();
      if (release.draft === true || release.prerelease === true && plugin.release.includePrerelease !== true) {
        throw new Error("\u6700\u65B0 Release \u662F draft \u6216 prerelease");
      }
      const rawTag = typeof release.tag_name === "string" ? release.tag_name : "";
      const version = normalizeReleaseVersion(rawTag);
      if (!version || version.pre.length && plugin.release.includePrerelease !== true) {
        throw new Error("\u6700\u65B0 Release tag \u4E0D\u662F\u53EF\u7528\u7684 SemVer");
      }
      const assets = Array.isArray(release.assets) ? release.assets.filter(isGithubReleaseAsset) : [];
      const asset = findReleaseAsset(assets, plugin.release.assetName, version.value, rawTag);
      if (!asset) throw new Error(`Release \u7F3A\u5C11\u5339\u914D\u8D44\u4EA7\uFF1A${plugin.release.assetName}`);
      const assetUrl = typeof asset.browser_download_url === "string" ? asset.browser_download_url : "";
      if (!isAllowedMarketUrl(assetUrl)) throw new Error("Release \u8D44\u4EA7\u5730\u5740\u65E0\u6548");
      const sha2562 = await resolveReleaseSha256(asset, assets, this.fetcher);
      return {
        expiresAt: 0,
        result: {
          version: version.value,
          minHostApiVersion: plugin.minHostApiVersion,
          assetUrl,
          sha256: sha2562,
          permissions: plugin.permissions,
          platforms: plugin.platforms
        }
      };
    } catch (error) {
      return { expiresAt: 0, result: void 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
  verifyIndex(index) {
    if (!this.publicKey || this.publicKey.startsWith("REPLACE_WITH_")) {
      throw new Error("\u672A\u914D\u7F6E\u63D2\u4EF6\u5E02\u573A\u516C\u94A5");
    }
    if (!index.signature) throw new Error("\u5E02\u573A\u7D22\u5F15\u7F3A\u5C11\u7B7E\u540D");
    const unsigned = { schemaVersion: index.schemaVersion, generatedAt: index.generatedAt, plugins: index.plugins };
    let signature;
    try {
      signature = Buffer.from(index.signature, "base64");
    } catch {
      throw new Error("\u5E02\u573A\u7D22\u5F15\u7B7E\u540D\u7F16\u7801\u65E0\u6548");
    }
    const valid = crypto.verify(null, Buffer.from(canonicalizeMarketplaceJson(unsigned), "utf8"), this.publicKey, signature);
    if (!valid) throw new Error("\u5E02\u573A\u7D22\u5F15\u7B7E\u540D\u6821\u9A8C\u5931\u8D25");
  }
};
function canonicalizeMarketplaceJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeMarketplaceJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeMarketplaceJson(item)}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === void 0) throw new Error("\u65E0\u6CD5\u89C4\u8303\u5316\u672A\u5B9A\u4E49 JSON \u503C");
  return serialized;
}
function marketplaceRequestUrls(directUrl) {
  if (!/^https:\/\/(?:api\.github\.com|github\.com|raw\.githubusercontent\.com)\//i.test(directUrl)) return [directUrl];
  return [`${DEFAULT_MARKETPLACE_PROXY_URL}/${directUrl}`, directUrl];
}
function addCacheBust(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}secagent_cache=${Date.now()}`;
}
async function fetchMarketplaceIndex(url, fetcher) {
  const bytes = await fetchMarketplaceBytes(url, fetcher, 12e3, { "Cache-Control": "no-cache" });
  let index;
  try {
    index = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("\u63D2\u4EF6\u5E02\u573A\u7D22\u5F15\u4E0D\u662F\u6709\u6548 JSON");
  }
  if (!isMarketplaceIndex(index)) {
    if (isRecord(index) && index.schemaVersion === 1) throw new Error("\u4E0D\u652F\u6301\u63D2\u4EF6\u5E02\u573A\u7D22\u5F15\u7248\u672C 1\uFF0C\u8BF7\u4F7F\u7528 schemaVersion 2");
    if (isRecord(index) && index.schemaVersion === 2 && !index.signature) throw new Error("\u5E02\u573A\u7D22\u5F15\u7F3A\u5C11\u7B7E\u540D");
    throw new Error("\u63D2\u4EF6\u5E02\u573A\u7D22\u5F15\u683C\u5F0F\u65E0\u6548");
  }
  return index;
}
async function fetchMarketplaceResource(url, fetcher, timeoutMs, headers) {
  let lastError;
  for (const candidate of marketplaceRequestUrls(url)) {
    try {
      const response = await fetcher(candidate, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`\u65E0\u6CD5\u8BF7\u6C42 ${url}\uFF1A${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
async function fetchMarketplaceBytes(url, fetcher, timeoutMs, headers, expectedSha256) {
  let lastError;
  for (const candidate of marketplaceRequestUrls(url).map(addCacheBust)) {
    try {
      const response = await fetcher(candidate, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!expectedSha256 || crypto.createHash("sha256").update(bytes).digest("hex").toLowerCase() === expectedSha256.toLowerCase()) return bytes;
      lastError = new Error("SHA-256 \u6821\u9A8C\u5931\u8D25");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`\u65E0\u6CD5\u8BF7\u6C42 ${url}\uFF1A${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
async function downloadMarketplaceAsset(url, expectedSha256, fetcher) {
  return fetchMarketplaceBytes(url, fetcher, 6e4, void 0, expectedSha256);
}
function resolvePluginPath(indexUrl, pluginPath) {
  if (!pluginPath || pluginPath.startsWith("/") || pluginPath.includes("://") || pluginPath.split("/").includes("..")) {
    throw new Error(`\u63D2\u4EF6\u7D22\u5F15\u8DEF\u5F84\u65E0\u6548\uFF1A${pluginPath}`);
  }
  const url = new URL(pluginPath, indexUrl).toString();
  if (!isAllowedMarketUrl(url)) throw new Error(`\u63D2\u4EF6\u7D22\u5F15\u5730\u5740\u65E0\u6548\uFF1A${pluginPath}`);
  return url;
}
function findReleaseAsset(assets, template, version, rawTag) {
  if (!template.includes("{version}")) return void 0;
  const names = /* @__PURE__ */ new Set([template.replace("{version}", version), template.replace("{version}", rawTag)]);
  return assets.find((asset) => typeof asset.name === "string" && names.has(asset.name));
}
async function resolveReleaseSha256(asset, assets, fetcher) {
  const digest = parseSha256(asset.digest);
  if (digest) return digest;
  const assetName = typeof asset.name === "string" ? asset.name : "";
  const sidecar = assets.find((candidate) => candidate.name === `${assetName}.sha256`);
  const sidecarUrl = sidecar && typeof sidecar.browser_download_url === "string" ? sidecar.browser_download_url : void 0;
  if (!sidecarUrl || !isAllowedMarketUrl(sidecarUrl)) throw new Error("Release \u8D44\u4EA7\u7F3A\u5C11 GitHub digest \u6216 .sha256 sidecar");
  const response = await fetchMarketplaceResource(sidecarUrl, fetcher, 12e3);
  const match = (await response.text()).match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) throw new Error(".sha256 sidecar \u5185\u5BB9\u65E0\u6548");
  return match[0].toLowerCase();
}
function normalizeReleaseVersion(tag) {
  const value = tag.trim().replace(/^v/i, "");
  const parsed = parseVersion(value);
  return parsed ? { value, pre: parsed.pre } : void 0;
}
function isCompatibleMetadata(plugin) {
  return plugin.minHostApiVersion <= HOST_API_VERSION && plugin.platforms.includes(process.platform);
}
function isCompatibleVersion(version) {
  return version.minHostApiVersion <= HOST_API_VERSION && version.platforms.includes(process.platform);
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
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isMarketplaceIndex(value) {
  if (!isRecord(value) || value.schemaVersion !== 2 || typeof value.generatedAt !== "string" || typeof value.signature !== "string" || !Array.isArray(value.plugins)) return false;
  return value.plugins.every((plugin) => isRecord(plugin) && typeof plugin.id === "string" && typeof plugin.path === "string" && typeof plugin.sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(plugin.sha256) && (plugin.latest === void 0 || isMarketplaceVersion(plugin.latest)));
}
function isMarketplaceVersion(value) {
  return isRecord(value) && typeof value.version === "string" && typeof value.minHostApiVersion === "number" && typeof value.assetUrl === "string" && isAllowedMarketUrl(value.assetUrl) && typeof value.sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(value.sha256) && Array.isArray(value.permissions) && value.permissions.every((permission) => typeof permission === "string") && Array.isArray(value.platforms) && value.platforms.every((platform) => typeof platform === "string");
}
function validateMarketplaceVersion(value) {
  if (!isMarketplaceVersion(value)) throw new Error("\u5E02\u573A\u7D22\u5F15\u4E2D\u7684 Release \u6570\u636E\u65E0\u6548");
  return value;
}
function isMarketplacePluginMetadata(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.description !== "string" || typeof value.repository !== "string" || typeof value.minHostApiVersion !== "number" || !Array.isArray(value.permissions) || !value.permissions.every((permission) => typeof permission === "string") || !Array.isArray(value.platforms) || !value.platforms.every((platform) => typeof platform === "string") || !isRecord(value.release)) return false;
  const release = value.release;
  return release.provider === "github" && typeof release.owner === "string" && /^[A-Za-z0-9_.-]+$/.test(release.owner) && typeof release.repo === "string" && /^[A-Za-z0-9_.-]+$/.test(release.repo) && typeof release.assetName === "string" && release.assetName.includes("{version}") && (release.includePrerelease === void 0 || typeof release.includePrerelease === "boolean");
}
function isGithubReleaseAsset(value) {
  return isRecord(value) && typeof value.name === "string" && typeof value.browser_download_url === "string";
}
function parseSha256(value) {
  if (typeof value !== "string") return void 0;
  const match = value.match(/^sha256:([a-fA-F0-9]{64})$/i);
  return match?.[1].toLowerCase();
}
async function resolveMarketplaceReadme(value, fetcher) {
  if (!value || !/^https:\/\//i.test(value) || !isAllowedMarketUrl(value)) return value;
  try {
    const response = await fetchMarketplaceResource(value, fetcher, 12e3);
    const readme = await response.text();
    return readme.length <= 1024 * 1024 ? readme : void 0;
  } catch {
    return void 0;
  }
}
function isAllowedMarketUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

// src/marketplace.test.ts
var keyPair = crypto2.generateKeyPairSync("ed25519");
var publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
test("marketplace versions compare numerically and respect prereleases", () => {
  assert.equal(compareVersions("1.0.10", "1.0.2") > 0, true);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1") > 0, true);
  assert.equal(compareVersions("2.0.0", "1.9.99") > 0, true);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
});
test("marketplace uses the proxy before the direct GitHub URL", () => {
  assert.deepEqual(marketplaceRequestUrls(DEFAULT_MARKETPLACE_INDEX_URL), [
    `${DEFAULT_MARKETPLACE_PROXY_URL}/${DEFAULT_MARKETPLACE_INDEX_URL}`,
    DEFAULT_MARKETPLACE_INDEX_URL
  ]);
  const githubApiUrl = "https://api.github.com/repos/SECTL/ClassIsland-SecAgent-Plugin/releases/latest";
  assert.deepEqual(marketplaceRequestUrls(githubApiUrl), [
    `${DEFAULT_MARKETPLACE_PROXY_URL}/${githubApiUrl}`,
    githubApiUrl
  ]);
  assert.deepEqual(marketplaceRequestUrls("https://example.com/index.json"), ["https://example.com/index.json"]);
});
test("marketplace verifies a signed v2 index, resolves latest Release and merges concurrent requests", async () => {
  const archive = Buffer.from("plugin zip bytes");
  const fixture = createFixture({
    release: {
      tag_name: "v1.2.3",
      draft: false,
      prerelease: false,
      assets: [{ name: "example-1.2.3.zip", browser_download_url: "https://github.com/example/example/releases/download/v1.2.3/example-1.2.3.zip", digest: `sha256:${sha256(archive)}` }]
    }
  });
  let releaseRequests = 0;
  const calls = [];
  const fetcher = createFetcher(fixture, (url) => {
    calls.push(url);
    if (url.includes("/releases/latest")) releaseRequests += 1;
  });
  const client = new MarketplaceClient("http://127.0.0.1/index.json", publicKey, fetcher);
  const [first, second] = await Promise.all([client.list(), client.list()]);
  assert.equal(first[0].latest?.version, "1.2.3");
  assert.equal(first[0].latest?.sha256, sha256(archive));
  assert.equal(second[0].latest?.assetUrl.endsWith("example-1.2.3.zip"), true);
  assert.equal(releaseRequests, 1);
  assert.equal(calls.some((url) => url.includes("plugins/example.json")), true);
});
test("marketplace uses resolved Release metadata from the signed index without GitHub API", async () => {
  const fixture = createFixture();
  const resolved = {
    version: "1.0.0",
    minHostApiVersion: 1,
    assetUrl: "https://github.com/example/example/releases/download/v1.0.0/example-1.0.0.zip",
    sha256: sha256(fixture.archive),
    permissions: ["agent.tools"],
    platforms: [process.platform]
  };
  const unsigned = {
    schemaVersion: fixture.index.schemaVersion,
    generatedAt: fixture.index.generatedAt,
    plugins: fixture.index.plugins.map((reference) => ({ ...reference, latest: resolved }))
  };
  let releaseApiCalled = false;
  const signedIndex = signIndex(unsigned);
  const fetcher = createFetcher({ ...fixture, index: signedIndex }, (url) => {
    if (url.includes("/releases/latest")) releaseApiCalled = true;
  });
  const [plugin] = await new MarketplaceClient("http://127.0.0.1/index.json", publicKey, fetcher).list();
  assert.equal(plugin.latest?.version, "1.0.0");
  assert.equal(plugin.latest?.sha256, resolved.sha256);
  assert.equal(releaseApiCalled, false);
});
test("marketplace falls back to a .sha256 sidecar when GitHub has no digest", async () => {
  const archive = Buffer.from("sidecar plugin zip");
  const fixture = createFixture({
    release: {
      tag_name: "2.0.0",
      draft: false,
      prerelease: false,
      assets: [
        { name: "example-2.0.0.zip", browser_download_url: "https://github.com/example/example/releases/download/2.0.0/example-2.0.0.zip" },
        { name: "example-2.0.0.zip.sha256", browser_download_url: "https://github.com/example/example/releases/download/2.0.0/example-2.0.0.zip.sha256" }
      ]
    },
    archive,
    sidecar: `${sha256(archive)}  example-2.0.0.zip
`
  });
  const [plugin] = await new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher(fixture)).list();
  assert.equal(plugin.latest?.version, "2.0.0");
  assert.equal(plugin.latest?.sha256, sha256(archive));
});
test("draft, prerelease and missing asset releases leave plugin metadata available but unavailable", async () => {
  const fixture = createFixture({
    release: {
      tag_name: "v3.0.0-beta.1",
      draft: false,
      prerelease: true,
      assets: []
    }
  });
  const [plugin] = await new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher(fixture)).list();
  assert.equal(plugin.name, "Example");
  assert.equal(plugin.latest, void 0);
  assert.match(plugin.releaseError || "", /draft|prerelease/);
});
test("marketplace rejects missing and invalid signatures and rejects schema v1", async () => {
  const fixture = createFixture();
  const fetcher = createFetcher(fixture);
  const missingSignature = { ...fixture.index, signature: "" };
  await assert.rejects(
    new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher({ ...fixture, index: missingSignature })).list(),
    /缺少签名/
  );
  const otherPair = crypto2.generateKeyPairSync("ed25519");
  await assert.rejects(
    new MarketplaceClient("http://127.0.0.1/index.json", otherPair.publicKey.export({ type: "spki", format: "pem" }).toString(), fetcher).list(),
    /签名校验失败/
  );
  await assert.rejects(
    new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher({ ...fixture, index: { schemaVersion: 1, generatedAt: fixture.index.generatedAt, plugins: [] } })).list(),
    /索引版本 1/
  );
});
test("marketplace rejects a plugin metadata SHA-256 mismatch", async () => {
  const fixture = createFixture();
  const tamperedIndex = {
    ...fixture.index,
    plugins: fixture.index.plugins.map((reference) => ({ ...reference, sha256: "0".repeat(64) }))
  };
  const signedIndex = signIndex({ schemaVersion: 2, generatedAt: tamperedIndex.generatedAt, plugins: tamperedIndex.plugins });
  await assert.rejects(
    new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher({ ...fixture, index: signedIndex })).list(),
    /校验失败/
  );
});
test("installUpdates hot-installs a newer version using only the signed index", async () => {
  const archive = Buffer.from("update zip bytes");
  const fixture = fixtureWithLatest(createFixture({ archive }), latestVersion("2.0.0", sha256(archive)));
  const calls = [];
  let installedPath = "";
  const manager = {
    list: () => [{ id: "example", name: "Example", version: "1.0.0" }],
    install: async (filePath) => {
      installedPath = filePath;
      assert.equal(fs2.readFileSync(filePath).toString(), archive.toString());
    }
  };
  const result = await new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher(fixture, (url) => calls.push(url))).installUpdates(manager);
  assert.deepEqual(result, { updates: [{ id: "example", from: "1.0.0", to: "2.0.0" }], errors: [] });
  assert.equal(fs2.existsSync(installedPath), false);
  assert.equal(calls.filter((url) => url.includes("index.json")).length, 1);
  assert.equal(calls.some((url) => url.includes("plugins/example.json") || url.includes("/releases/latest")), false);
});
test("installUpdates skips plugins already on the latest version", async () => {
  const fixture = fixtureWithLatest(createFixture(), latestVersion("1.0.0", sha256(Buffer.from("plugin zip bytes"))));
  let installCount = 0;
  const manager = {
    list: () => [{ id: "example", name: "Example", version: "1.0.0" }],
    install: async () => {
      installCount += 1;
    }
  };
  const result = await new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher(fixture)).installUpdates(manager);
  assert.deepEqual(result, { updates: [], errors: [] });
  assert.equal(installCount, 0);
});
test("installUpdates records per-plugin failures instead of aborting the round", async () => {
  const fixture = fixtureWithLatest(createFixture(), latestVersion("2.0.0", "2".repeat(64)));
  const manager = {
    list: () => [{ id: "example", name: "Example", version: "1.0.0" }],
    install: async () => {
    }
  };
  const fetcher = async (input) => {
    const url = String(input);
    if (url.includes("index.json")) return new Response(JSON.stringify(fixture.index), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const result = await new MarketplaceClient("http://127.0.0.1/index.json", publicKey, fetcher).installUpdates(manager);
  assert.deepEqual(result.updates, []);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, "example");
  assert.match(result.errors[0].error, /无法请求/);
});
test("installUpdates serializes concurrent rounds so downloads never overlap", async () => {
  const archive = Buffer.from("queued zip bytes");
  const fixture = fixtureWithLatest(createFixture({ archive }), latestVersion("2.0.0", sha256(archive)));
  let indexFetches = 0;
  let pendingIndex;
  const fetcher = async (input) => {
    const url = String(input);
    if (url.includes("index.json")) {
      indexFetches += 1;
      if (indexFetches === 1) return new Promise((resolve) => {
        pendingIndex = resolve;
      });
      return new Response(JSON.stringify(fixture.index), { status: 200 });
    }
    if (url.includes("/releases/download/")) return new Response(new Uint8Array(fixture.archive), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const manager = {
    list: () => [{ id: "example", name: "Example", version: "1.0.0" }],
    install: async () => {
    }
  };
  const client = new MarketplaceClient("http://127.0.0.1/index.json", publicKey, fetcher);
  const first = client.installUpdates(manager);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(indexFetches, 1);
  const second = client.installUpdates(manager);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(indexFetches, 1);
  pendingIndex?.(new Response(JSON.stringify(fixture.index), { status: 200 }));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.updates.length, 1);
  assert.equal(secondResult.updates.length, 1);
  assert.equal(indexFetches, 2);
});
test("updatePlugin hot-installs a newer version and reports already-latest plugins", async () => {
  const archive = Buffer.from("manual update zip");
  const fixture = fixtureWithLatest(createFixture({ archive }), latestVersion("1.5.0", sha256(archive)));
  let installCount = 0;
  const outdated = {
    list: () => [{ id: "example", name: "Example", version: "1.0.0" }],
    install: async (filePath) => {
      installCount += 1;
      assert.equal(fs2.readFileSync(filePath).toString(), archive.toString());
    }
  };
  const current = {
    list: () => [{ id: "example", name: "Example", version: "1.5.0" }],
    install: async () => {
      installCount += 1;
    }
  };
  const client = new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher(fixture));
  assert.deepEqual(await client.updatePlugin(outdated, "example"), { id: "example", from: "1.0.0", to: "1.5.0", updated: true });
  assert.deepEqual(await client.updatePlugin(current, "example"), { id: "example", from: "1.5.0", to: "1.5.0", updated: false });
  assert.equal(installCount, 1);
  await assert.rejects(client.updatePlugin(outdated, "missing"), /未安装/);
});
test("checkUpdates skips incompatible, not-newer and indexless entries", async () => {
  const archive = Buffer.from("plugin zip bytes");
  const indexless = createFixture({ archive });
  const incompatible = fixtureWithLatest(indexless, latestVersion("2.0.0", sha256(archive), ["other-platform"]));
  const notNewer = fixtureWithLatest(indexless, latestVersion("1.0.0", sha256(archive)));
  const installed = [{ id: "example", version: "1.0.0" }];
  const createClient = (fixture) => new MarketplaceClient("http://127.0.0.1/index.json", publicKey, createFetcher(fixture));
  assert.deepEqual(await createClient(indexless).checkUpdates(installed), []);
  assert.deepEqual(await createClient(incompatible).checkUpdates(installed), []);
  assert.deepEqual(await createClient(notNewer).checkUpdates(installed), []);
});
function createFixture(options = {}) {
  const metadata = {
    schemaVersion: 1,
    id: "example",
    name: "Example",
    description: "Example plugin",
    repository: "https://github.com/example/example",
    minHostApiVersion: 1,
    permissions: ["agent.tools"],
    platforms: [process.platform],
    release: {
      provider: "github",
      owner: "example",
      repo: "example",
      assetName: "example-{version}.zip",
      includePrerelease: false
    }
  };
  const metadataBytes = Buffer.from(JSON.stringify(metadata));
  const unsigned = {
    schemaVersion: 2,
    generatedAt: "2026-08-27T00:00:00.000Z",
    plugins: [{ id: "example", path: "plugins/example.json", sha256: sha256(metadataBytes) }]
  };
  return {
    index: signIndex(unsigned),
    metadataBytes,
    archive: options.archive || Buffer.from("plugin zip bytes"),
    sidecar: options.sidecar,
    release: options.release || {
      tag_name: "v1.0.0",
      draft: false,
      prerelease: false,
      assets: [{ name: "example-1.0.0.zip", browser_download_url: "https://github.com/example/example/releases/download/v1.0.0/example-1.0.0.zip", digest: "sha256:" + "1".repeat(64) }]
    }
  };
}
function signIndex(unsigned) {
  return {
    ...unsigned,
    signature: crypto2.sign(null, Buffer.from(canonicalizeMarketplaceJson(unsigned), "utf8"), keyPair.privateKey).toString("base64")
  };
}
function fixtureWithLatest(fixture, latest) {
  const unsigned = {
    schemaVersion: fixture.index.schemaVersion,
    generatedAt: fixture.index.generatedAt,
    plugins: fixture.index.plugins.map((reference) => ({ ...reference, latest }))
  };
  return { ...fixture, index: signIndex(unsigned) };
}
function latestVersion(version, archiveSha256, platforms = [process.platform]) {
  return {
    version,
    minHostApiVersion: 1,
    assetUrl: `https://github.com/example/example/releases/download/v${version}/example-${version}.zip`,
    sha256: archiveSha256,
    permissions: ["agent.tools"],
    platforms
  };
}
function createFetcher(fixture, onRequest) {
  return async (input) => {
    const url = String(input);
    onRequest?.(url);
    if (url.includes("index.json")) return new Response(JSON.stringify(fixture.index), { status: 200 });
    if (url.includes("plugins/example.json")) return new Response(new Uint8Array(fixture.metadataBytes), { status: 200 });
    if (url.includes("/releases/latest")) return new Response(JSON.stringify(fixture.release), { status: 200 });
    if (url.includes(".sha256")) return new Response(fixture.sidecar || "", { status: 200 });
    if (url.includes("/releases/download/")) return new Response(new Uint8Array(fixture.archive), { status: 200 });
    return new Response("not found", { status: 404 });
  };
}
function sha256(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
