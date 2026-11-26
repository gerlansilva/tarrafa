import type { Work } from "../types";

export function cleanDoi(d?: string | null): string | undefined {
  if (!d) return undefined;
  const m = d.trim().match(/10\.\d{4,9}\/\S+/i);
  return m ? m[0].replace(/[.,;]+$/, "").toLowerCase() : undefined;
}

export function stripTags(s?: string | null): string | undefined {
  if (!s) return undefined;
  const t = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return t || undefined;
}

export function toYear(v: unknown): number | undefined {
  const m = String(v ?? "").match(/(1[5-9]\d\d|20\d\d)/);
  return m ? Number(m[1]) : undefined;
}

export function work(source: string, w: Omit<Work, "key" | "sources">): Work {
  return {
    ...w,
    title: stripTags(w.title) ?? "(sem título)",
    abstract: stripTags(w.abstract),
    doi: cleanDoi(w.doi),
    key: "",
    sources: [source],
  };
}

export function enc(s: string): string {
  return encodeURIComponent(s);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Executa tarefas com concorrência limitada. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>, stop: () => boolean): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && !stop()) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}
