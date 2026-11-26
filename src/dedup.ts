import type { Work } from "./types";
import { normalize } from "./query";

export function titleKey(t: string): string {
  return normalize(t).replace(/[^a-z0-9]+/g, "").slice(0, 120);
}

/** Junta registros iguais vindos de bases diferentes (DOI; senão título + ano ±1). */
export function dedupe(all: Work[]): Work[] {
  const byDoi = new Map<string, Work>();
  const byTitle = new Map<string, Work>();
  const out: Work[] = [];

  const merge = (a: Work, b: Work) => {
    for (const s of b.sources) if (!a.sources.includes(s)) a.sources.push(s);
    a.citations = Math.max(a.citations ?? 0, b.citations ?? 0) || a.citations || b.citations;
    a.doi ??= b.doi;
    a.year ??= b.year;
    a.venue ??= b.venue;
    a.oaUrl ??= b.oaUrl;
    a.lang ??= b.lang;
    a.rank = Math.min(a.rank ?? 1e9, b.rank ?? 1e9);
    if ((b.abstract?.length ?? 0) > (a.abstract?.length ?? 0)) a.abstract = b.abstract;
    if (!a.authors.length) a.authors = b.authors;
    if (!a.keywords?.length) a.keywords = b.keywords;
    if (!a.issn?.length) a.issn = b.issn;
    if (a.doi && !byDoi.has(a.doi)) byDoi.set(a.doi, a);
  };

  for (const w0 of all) {
    const w: Work = { ...w0, sources: [...w0.sources], authors: [...w0.authors] };
    const tk = titleKey(w.title);
    const hit =
      (w.doi && byDoi.get(w.doi)) ||
      (tk.length > 15 &&
        [w.year, (w.year ?? 0) - 1, (w.year ?? 0) + 1].map((y) => byTitle.get(`${tk}|${y ?? ""}`)).find(Boolean));
    if (hit) {
      merge(hit, w);
      continue;
    }
    w.key = w.doi ?? `${tk}|${w.year ?? ""}`;
    out.push(w);
    if (w.doi) byDoi.set(w.doi, w);
    if (tk.length > 15) byTitle.set(`${tk}|${w.year ?? ""}`, w);
  }
  return out;
}
