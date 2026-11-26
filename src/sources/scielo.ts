import type { Source, Work } from "../types";
import { hasTerms, inYearRange, matchesLocally } from "../query";
import { enc, pool, work } from "./util";

const API = "https://articlemeta.scielo.org/api/v1";
// artigos já baixados ficam guardados entre sessões: repetir a busca numa revista é quase instantâneo
const STORE = "tarrafa:scielo-cache";
const cache = new Map<string, Work | null>();
try {
  for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(STORE) ?? "{}"))) cache.set(k, v as Work);
} catch {
  /* sem cache salvo */
}
function saveCache() {
  const ok: Record<string, Work> = {};
  for (const [k, v] of cache) if (v) ok[k] = v;
  try {
    localStorage.setItem(STORE, JSON.stringify(ok));
  } catch {
    /* armazenamento cheio: segue só com o cache da sessão */
  }
}

function pick(list: any[] | undefined, key = "_", lang?: string): string | undefined {
  if (!list?.length) return undefined;
  const byLang = lang ? list.find((x) => x.l === lang) : undefined;
  return (byLang ?? list[0])?.[key];
}

function toWork(d: any): Work {
  const a = d.article ?? {};
  const titleBlock = d.title ?? {};
  const lang = a.v40?.[0]?._;
  const abstracts = (a.v83 ?? []).map((x: any) => x.a).filter(Boolean);
  return work("SciELO", {
    title: pick(a.v12, "_", lang) ?? "(sem título)",
    authors: (a.v10 ?? []).map((x: any) => [x.s, x.n].filter(Boolean).join(", ")),
    year: Number(d.publication_year) || undefined,
    venue: pick(titleBlock.v100) ?? pick(a.v30),
    issn: [pick(titleBlock.v935), pick(titleBlock.v400)].filter(Boolean) as string[],
    doi: d.doi ?? pick(a.v237),
    url: `https://www.scielo.br/scielo.php?script=sci_arttext&pid=${d.code}`,
    oaUrl: `https://www.scielo.br/scielo.php?script=sci_pdf&pid=${d.code}`,
    abstract: abstracts.join("\n\n"),
    keywords: (a.v85 ?? []).map((x: any) => x.k).filter(Boolean),
    lang,
    type: "article",
  });
}

export const scielo: Source = {
  id: "scielo",
  name: "SciELO",
  region: "latam",
  description:
    "Varre as revistas da sua lista (por ISSN) pela API ArticleMeta e aplica os termos localmente. O SciELO não oferece busca por termos via API.",
  supportsTerms: true,
  supportsJournals: true,
  journalsOnly: true,
  async search(q, ctx) {
    if (!q.issns.length) return { works: [], queryString: "", note: "escolha uma lista de revistas para usar o SciELO" };
    const col = ctx.settings.scieloCollection || "scl";
    const ids: string[] = [];
    for (const issn of q.issns) {
      let offset = 0;
      while (!ctx.cancelled()) {
        const r = await ctx.getJson(`${API}/article/identifiers/?issn=${enc(issn)}&collection=${col}&limit=1000&offset=${offset}`);
        const objs = r.objects ?? [];
        ids.push(...objs.map((o: any) => o.code));
        offset += 1000;
        if (!objs.length || offset >= (r.meta?.total ?? 0)) break;
      }
    }
    // o código SciELO traz o ano (S0103-636X2012000100013 → 2012): descarta cedo o que está fora do período
    // a mesma revista aparece pelos dois ISSNs (impresso e eletrônico): cada artigo entra uma vez só
    const candidates = [...new Set(ids)].filter((c) => {
      const y = Number(c.slice(10, 14));
      if (!y) return true;
      return (!q.yearFrom || y >= q.yearFrom) && (!q.yearTo || y <= q.yearTo);
    });
    let done = 0;
    const docs = await pool(
      candidates,
      12,
      async (code) => {
        const k = `${col}:${code}`;
        if (!cache.has(k)) {
          try {
            const d = await ctx.getJson(`${API}/article/?code=${enc(code)}&collection=${col}&format=json`);
            cache.set(k, toWork(d));
          } catch {
            cache.set(k, null);
          }
        }
        ctx.progress(++done, candidates.length);
        return cache.get(k);
      },
      ctx.cancelled
    );
    saveCache();
    let works = docs.filter((w): w is Work => !!w).filter((w) => inYearRange(w, q) || (!q.yearFrom && !q.yearTo));
    if (hasTerms(q)) works = works.filter((w) => matchesLocally(w, q));
    return {
      works: works.slice(0, q.max),
      total: works.length,
      queryString: `ArticleMeta (${col}) ISSN ${q.issns.join(", ")}; ${candidates.length} artigos varridos; filtro local`,
    };
  },
};
