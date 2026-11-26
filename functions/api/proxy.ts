// Cloudflare Pages Function: repassa as buscas às bases que não liberam CORS no navegador.
// Só aceita os hosts das bases do Tarrafa.
const ALLOWED = ["api.openalex.org", "api.crossref.org", "api.ies.ed.gov", "api.semanticscholar.org", "doaj.org", "articlemeta.scielo.org", "bdtd.ibict.br"];

export const onRequestGet = async ({ request }: { request: Request }) => {
  let target: URL;
  try {
    target = new URL(new URL(request.url).searchParams.get("u") ?? "");
  } catch {
    return new Response("URL inválida", { status: 400 });
  }
  if (!ALLOWED.includes(target.hostname)) return new Response("host não permitido", { status: 403 });
  const headers: Record<string, string> = { "user-agent": "Tarrafa/0.1 (+web)" };
  const key = request.headers.get("x-api-key");
  if (key) headers["x-api-key"] = key;
  const r = await fetch(target.toString(), { headers, cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "public, max-age=3600" } });
};
