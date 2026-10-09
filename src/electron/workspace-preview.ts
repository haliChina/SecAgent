/**
 * 工作区文件预览窗（B2 自 main.ts 拆出，纯搬家）。
 *
 * workspace:preview-file 通道：.html/.htm 起临时 127.0.0.1 静态服务
 * （路径白名单限工作区根内，防目录逃逸）；.svg 直接 loadFile；
 * 其余文本文件转义后走 data: URL。
 */
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { DEFAULT_WORKSPACE } from "../paths.js";

function workspaceFilePath(relativePath: string): string {
  return path.join(DEFAULT_WORKSPACE, relativePath);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function openWorkspaceFilePreview(relativePath: string): Promise<{ ok: true }> {
  const filePath = workspaceFilePath(relativePath);
  const extension = path.extname(filePath).toLowerCase();
  const previewWindow = new BrowserWindow({ width: 1080, height: 820, minWidth: 640, minHeight: 480, title: path.basename(filePath), backgroundColor: "#fff", autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  previewWindow.on("page-title-updated", (event) => event.preventDefault());
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    if (extension === ".html" || extension === ".htm") {
      const root = path.resolve(DEFAULT_WORKSPACE);
      server = createServer((request, response) => {
        try {
          const requested = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
          const target = path.resolve(root, `.${requested}`);
          if (target !== root && !target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404); response.end("Not found"); return; }
          const mimeByExtension: Record<string, string> = { ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2" };
          const mime = mimeByExtension[path.extname(target).toLowerCase()] || "application/octet-stream";
          response.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` }); fs.createReadStream(target).pipe(response);
        } catch { response.writeHead(400); response.end("Bad request"); }
      });
      await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("无法启动本地预览服务器");
      const urlPath = "/" + path.relative(root, filePath).split(path.sep).map(encodeURIComponent).join("/");
      await previewWindow.loadURL(`http://127.0.0.1:${address.port}${urlPath}`);
    } else if (extension === ".svg") {
      await previewWindow.loadFile(filePath);
    } else {
      const markdown = escapeHtml(fs.readFileSync(filePath, "utf8"));
      await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><head><meta charset="utf-8"><style>body{font:15px/1.7 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#222}pre{white-space:pre-wrap}</style></head><body><pre>${markdown}</pre></body></html>`)}`);
    }
    previewWindow.setTitle(path.basename(filePath));
    if (!previewWindow.isDestroyed()) previewWindow.show();
    previewWindow.on("closed", () => server?.close());
    return { ok: true };
  } catch (error) {
    server?.close();
    if (!previewWindow.isDestroyed()) previewWindow.close();
    throw error;
  }
}
