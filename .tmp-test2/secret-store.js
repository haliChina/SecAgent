/**
 * R93：工作区密钥加密仓库（Electron `safeStorage` 优先）。
 *
 * `.env` 只保留非敏感配置（URL/端口/开关），
 * 敏感值（*_KEY / *_TOKEN / *_SECRET…）写入 `secrets.vault`，
 * 用 Windows DPAPI / macOS Keychain / Linux libsecret 包装；启动时解密注入
 * `process.env`，插件/MCP 子进程仍可继承。
 *
 * 边界与已知限制：
 * - 防的是 .env 被复制/同步/备份/误提交；不防同用户恶意进程调用 DPAPI。
 * - DPAPI 绑定当前 Windows 用户/机器；换机/重装后密文解不开，需要重新输入。
 * - CLI（非 Electron）没有 safeStorage：保持旧明文模式，或由 shell 注入 env。
 */
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { SECRET_KEY_PATTERN } from "./redact.js";
const VAULT_FILE = "secrets.vault";
const VAULT_VERSION = 1;
let cipher = null;
export function configureSecretCipher(next) {
    cipher = next;
}
export function secretStoreStatus() {
    if (!cipher)
        return "legacy";
    return cipher.available ? "encrypted" : "unavailable";
}
/** 环境变量名是否属于需要加密的密钥。 */
export function isSecretEnvName(name) {
    return SECRET_KEY_PATTERN.test(name) || /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY)$/i.test(name);
}
function vaultPath(workspace) {
    return path.join(workspace, VAULT_FILE);
}
function readVault(workspace) {
    const file = vaultPath(workspace);
    if (!fs.existsSync(file))
        return { version: VAULT_VERSION, cipher: "safeStorage", updatedAt: new Date().toISOString(), entries: {} };
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed.version !== VAULT_VERSION || !parsed.entries || typeof parsed.entries !== "object")
            return { version: VAULT_VERSION, cipher: "safeStorage", updatedAt: new Date().toISOString(), entries: {} };
        return { version: VAULT_VERSION, cipher: "safeStorage", updatedAt: String(parsed.updatedAt || ""), entries: { ...parsed.entries } };
    }
    catch {
        console.warn("[secrets] secrets.vault 无法解析，按空仓库处理；原文件未修改。");
        return { version: VAULT_VERSION, cipher: "safeStorage", updatedAt: new Date().toISOString(), entries: {} };
    }
}
function writeVault(workspace, vault) {
    vault.version = VAULT_VERSION;
    vault.cipher = "safeStorage";
    vault.updatedAt = new Date().toISOString();
    const file = vaultPath(workspace);
    writeFileAtomic(file, `${JSON.stringify(vault, null, 2)}\n`);
    try {
        fs.chmodSync(file, 0o600);
    }
    catch { /* Windows / 权限不支持 */ }
}
function envPath(workspace) { return path.join(workspace, ".env"); }
/** 从 .env 移除一个键（保留注释、空行与其他配置）。 */
function removeEnvEntry(workspace, name) {
    const file = envPath(workspace);
    if (!fs.existsSync(file))
        return;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const next = lines.filter((line) => !new RegExp(`^\\s*${name}\\s*=`).test(line));
    if (next.length === lines.length)
        return;
    writeFileAtomic(file, `${next.join("\n").replace(/\n*$/, "\n")}`);
}
/**
 * 写一个密钥：
 * - cipher 可用 → 加密入 vault 并移除 .env 明文；
 * - cipher 存在但系统密钥环不可用 → 返回 "unavailable"，调用方回退明文并告警（不静默）；
 * - 无 cipher（CLI/测试）→ 返回 "legacy"，保持旧 .env 行为。
 */
export function storeSecret(workspace, name, value) {
    if (!cipher)
        return "legacy";
    if (!cipher.available)
        return "unavailable";
    const encrypted = cipher.encrypt(value);
    const vault = readVault(workspace);
    vault.entries[name] = encrypted;
    writeVault(workspace, vault);
    removeEnvEntry(workspace, name);
    process.env[name] = value;
    return "encrypted";
}
/** 启动时把 vault 解密注入 process.env；不可用/解密失败只记录，不崩溃。 */
export function loadSecrets(workspace) {
    if (!cipher || !cipher.available)
        return { loaded: 0, failed: 0 };
    const vault = readVault(workspace);
    let loaded = 0;
    let failed = 0;
    for (const [name, payload] of Object.entries(vault.entries)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof payload !== "string")
            continue;
        try {
            const value = cipher.decrypt(payload);
            if (value) {
                process.env[name] = value;
                loaded += 1;
            }
        }
        catch {
            failed += 1;
            console.warn(`[secrets] ${name} 解密失败（系统密钥环/用户可能已变化），请重新输入该密钥。`);
        }
    }
    return { loaded, failed };
}
/** 把现有 .env 明文密钥迁移进 vault；成功后才重写 .env。返回迁移条数。 */
export function migratePlaintextSecrets(workspace) {
    if (!cipher || !cipher.available)
        return 0;
    const file = envPath(workspace);
    if (!fs.existsSync(file))
        return 0;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const vault = readVault(workspace);
    const kept = [];
    let migrated = 0;
    for (const line of lines) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || !match[2] || !isSecretEnvName(match[1])) {
            kept.push(line);
            continue;
        }
        const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
        if (!value) {
            kept.push(line);
            continue;
        }
        vault.entries[match[1]] = cipher.encrypt(value);
        process.env[match[1]] = value;
        migrated += 1;
    }
    if (!migrated)
        return 0;
    writeVault(workspace, vault);
    writeFileAtomic(file, `${kept.join("\n").replace(/\n*$/, "\n")}`);
    return migrated;
}
