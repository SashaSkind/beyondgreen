import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const root = new URL("../../ui/", import.meta.url);
const files: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/demo.json": ["demo.json", "application/json"],
  "/fonts/source-sans-3.ttf": ["fonts/source-sans-3.ttf", "font/ttf"],
  "/fonts/OFL.txt": ["fonts/OFL.txt", "text/plain"],
};

// No directory browsing, uploads, shell commands, credentials, or model calls.
export function createViewerServer() {
  return createServer(async (request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    try {
      if (path === "/model.js") {
        const source = await readFile(new URL("model.ts", import.meta.url), "utf8");
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.end(request.method === "HEAD" ? undefined : stripTypeScriptTypes(source));
      } else if (Object.hasOwn(files, path)) {
        const [file, type] = files[path];
        const content = await readFile(new URL(file, root));
        response.setHeader("Content-Type", type);
        response.end(request.method === "HEAD" ? undefined : content);
      } else response.writeHead(404).end("Not found");
    } catch { response.writeHead(500).end("Viewer asset unavailable. Restart npm run ui from the project checkout."); }
  });
}
