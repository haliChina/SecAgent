import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureSecretCipher, isSecretEnvName, loadSecrets, migratePlaintextSecrets, secretStoreStatus, storeSecret } from "./secret-store.js";

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "secagent-secret-"));
}

function cipher() {
  return {
    available: true,
    encrypt: (value: string) => `enc:${Buffer.from(value, "utf8").toString("base64")}`,
    decrypt: (payload: string) => Buffer.from(payload.replace(/^enc:/, ""), "base64").toString("utf8")
  };
}

test("密钥识别：只匹配 Key/Token/Secret 类环境变量", () => {
  assert.equal(isSecretEnvName("OPENAI_API_KEY"), true);
  assert.equal(isSecretEnvName("SECTL_OFFICIAL_TOKEN"), true);
  assert.equal(isSecretEnvName("GOOGLE_SEARCH_KEY"), true);
  assert.equal(isSecretEnvName("GOOGLE_SEARCH_CX"), false);
  assert.equal(isSecretEnvName("SECTL_OFFICIAL_API_URL"), false);
});

test("密钥写入：加密入 vault，.env 不再保留明文", () => {
  const dir = workspace();
  try {
    fs.writeFileSync(path.join(dir, ".env"), "OPENAI_API_KEY=sk-plain\nSECTL_OFFICIAL_API_URL=https://example.test\n", "utf8");
    configureSecretCipher(cipher());
    assert.equal(secretStoreStatus(), "encrypted");
    assert.equal(storeSecret(dir, "OPENAI_API_KEY", "sk-secret"), "encrypted");
    const env = fs.readFileSync(path.join(dir, ".env"), "utf8");
    const vault = fs.readFileSync(path.join(dir, "secrets.vault"), "utf8");
    assert.equal(env.includes("sk-secret"), false);
    assert.equal(env.includes("SECTL_OFFICIAL_API_URL"), true);
    assert.equal(vault.includes("sk-secret"), false);
    delete process.env.OPENAI_API_KEY;
    assert.deepEqual(loadSecrets(dir), { loaded: 1, failed: 0 });
    assert.equal(process.env.OPENAI_API_KEY, "sk-secret");
  } finally {
    configureSecretCipher(null);
    delete process.env.OPENAI_API_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("正则元字符名字：按字面匹配移除，不误删其他行（P3 回归）", () => {
  const dir = workspace();
  try {
    /* storeSecret 是导出函数，未来调用方可能绕过 writeWorkspaceEnv 的名字校验；
       名字里的 [ ] 等元字符必须按字面处理——旧实现会抛 SyntaxError 或匹配错行。 */
    fs.writeFileSync(path.join(dir, ".env"), "OPENAI_API_KEY=sk-a\nWEIRD[0]_KEY=sk-b\n", "utf8");
    configureSecretCipher(cipher());
    assert.equal(storeSecret(dir, "WEIRD[0]_KEY", "sk-new"), "encrypted");
    const env = fs.readFileSync(path.join(dir, ".env"), "utf8");
    assert.equal(env.includes("sk-b"), false);
    assert.equal(env.includes("OPENAI_API_KEY=sk-a"), true);
    /* 非法 env 名的 vault 条目在 loadSecrets 里会被跳过（与 .env 语义一致），
       这里只验证写入侧的字面匹配与进程注入。 */
    assert.equal(process.env["WEIRD[0]_KEY"], "sk-new");
  } finally {
    configureSecretCipher(null);
    delete process.env["WEIRD[0]_KEY"];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("旧 .env 迁移：明文密钥移入 vault，保留非敏感项", () => {
  const dir = workspace();
  try {
    fs.writeFileSync(path.join(dir, ".env"), "# comment\nOPENAI_API_KEY=sk-old\nSECTL_OFFICIAL_API_URL=https://example.test\nDEEPSEEK_API_KEY=ds-old\n", "utf8");
    configureSecretCipher(cipher());
    assert.equal(migratePlaintextSecrets(dir), 2);
    const env = fs.readFileSync(path.join(dir, ".env"), "utf8");
    assert.equal(env.includes("sk-old"), false);
    assert.equal(env.includes("ds-old"), false);
    assert.equal(env.includes("SECTL_OFFICIAL_API_URL"), true);
    const vault = JSON.parse(fs.readFileSync(path.join(dir, "secrets.vault"), "utf8")) as { entries: Record<string, string> };
    assert.equal(Object.keys(vault.entries).sort().join(","), "DEEPSEEK_API_KEY,OPENAI_API_KEY");
    assert.equal(migratePlaintextSecrets(dir), 0);
  } finally {
    configureSecretCipher(null);
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("密钥环不可用：返回 unavailable，由调用方回退明文", () => {
  const dir = workspace();
  try {
    configureSecretCipher({ available: false, encrypt: () => "", decrypt: () => "" });
    assert.equal(secretStoreStatus(), "unavailable");
    assert.equal(storeSecret(dir, "OPENAI_API_KEY", "sk"), "unavailable");
    assert.equal(fs.existsSync(path.join(dir, "secrets.vault")), false);
  } finally {
    configureSecretCipher(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});