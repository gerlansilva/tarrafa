import { defineConfig, type Plugin } from "vite";

/**
 * Proxy usado só no modo navegador (npm run dev / preview): algumas bases (ERIC, BDTD, SciELO)
 * não liberam CORS. No app Tauri as requisições saem pelo Rust e este proxy não é usado.
 */
const ALLOWED = [
  "api.openalex.org",
  "api.crossref.org",
  "api.ies.ed.gov",
  "api.semanticscholar.org",
  "doaj.org",
  "articlemeta.scielo.org",
  "bdtd.ibict.br",
];

function searchProxy(): Plugin {
  const handler = async (req: any, res: any, next: any) => {
    if (!req.url?.startsWith("/api/proxy")) return next();
    try {
      const target = new URL(new URL(req.url, "http://x").searchParams.get("u") ?? "");
      if (!ALLOWED.includes(target.hostname)) {
        res.statusCode = 403;
        return res.end("host não permitido");
      }
      const headers: Record<string, string> = { "user-agent": "Tarrafa/0.1 (dev)" };
      if (req.headers["x-api-key"]) headers["x-api-key"] = String(req.headers["x-api-key"]);
      const r = await fetch(target, { headers });
      res.statusCode = r.status;
      res.setHeader("content-type", r.headers.get("content-type") ?? "text/plain");
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e: any) {
      res.statusCode = 502;
      res.end(String(e?.message ?? e));
    }
  };
  return {
    name: "tarrafa-proxy",
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [searchProxy()],
  server: { port: 1420, strictPort: true, host: true },
  preview: { port: 1420, host: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "safari15", outDir: "dist" },
});
