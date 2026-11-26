import type { HttpResult } from "./types";

const isTauri = () => typeof (window as any).__TAURI_INTERNALS__ !== "undefined";

/** No app (Tauri) a requisição sai pelo Rust; no navegador tenta direto e, se o CORS bloquear, usa o proxy do servidor de desenvolvimento. */
export async function httpGet(url: string, headers?: Record<string, string>): Promise<HttpResult> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<HttpResult>("http_get", { url, headers });
  }
  const viaProxy = async () => {
    let r: Response;
    try {
      r = await fetch(`/api/proxy?u=${encodeURIComponent(url)}`, { headers });
    } catch {
      r = new Response("", { status: 404 });
    }
    if (r.status === 404) throw new Error("No navegador esta base é bloqueada (CORS); funciona no app Tarrafa.");
    return { status: r.status, body: await r.text() };
  };
  if (url.startsWith("http://")) return viaProxy();
  try {
    const r = await fetch(url, { headers });
    return { status: r.status, body: await r.text() };
  } catch {
    return viaProxy();
  }
}

export async function getJson<T = any>(url: string, headers?: Record<string, string>, tries = 3): Promise<T> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    const r = await httpGet(url, headers);
    if (r.status === 200) {
      try {
        return JSON.parse(r.body) as T;
      } catch {
        // resposta vazia ou cortada (comum no Crossref sob carga): espera e tenta de novo
        last = r.body.trim() ? "resposta não é JSON" : "resposta vazia";
        await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
        continue;
      }
    }
    last = `HTTP ${r.status}: ${r.body.slice(0, 200)}`;
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
      continue;
    }
    break;
  }
  throw new Error(last);
}

export async function saveFile(defaultName: string, content: string, ext: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_text", { path, content });
    return true;
  }
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

export async function httpPost(url: string, json: unknown): Promise<HttpResult> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<HttpResult>("http_post_json", { url, body: JSON.stringify(json) });
  }
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
  return { status: r.status, body: await r.text() };
}
