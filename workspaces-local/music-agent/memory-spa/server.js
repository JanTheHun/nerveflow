import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "public");
const PORT = Number(process.env.PORT ?? 4320);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Resolve and sanitize path
  const urlPath = req.url.split("?")[0];
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const resolved = resolve(join(PUBLIC_DIR, safePath));

  // Path traversal protection
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(resolved) || statSync(resolved).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const mime = MIME[extname(resolved)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  createReadStream(resolved).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Music Agent SPA → http://127.0.0.1:${PORT}`);
});
