import type { Source } from "../types";
import { booleanExpr, hasTerms } from "../query";
import { enc, sleep, work } from "./util";

export const semanticscholar: Source = {
  id: "s2",
  name: "Semantic Scholar",
  region: "int",
  description: "Base do Allen Institute for AI; boa cobertura de citações. Sem chave, é mais lenta (limite de 1 requisição por segundo).",
  supportsTerms: true,
  supportsJournals: false,
  async search(q, ctx) {
    if (!hasTerms(q)) return { works: [], queryString: "", note: "precisa de termos de busca" };
    const expr = booleanExpr(q, { and: " + ", or: " | ", not: " -" });
    const params = [`query=${enc(expr)}`, "fields=title,year,authors,venue,externalIds,citationCount,abstract,publicationTypes,openAccessPdf,journal,url"];
    if (q.yearFrom || q.yearTo) params.push(`year=${q.yearFrom ?? ""}-${q.yearTo ?? ""}`);
    if (q.onlyArticles) params.push("publicationTypes=JournalArticle");
    const headers: Record<string, string> = ctx.settings.s2Key ? { "x-api-key": ctx.settings.s2Key } : {};
    const works = [];
    let token = "";
    let total: number | undefined;
    do {
      const r = await ctx.getJson(
        `https://api.semanticscholar.org/graph/v1/paper/search/bulk?${params.join("&")}${token ? `&token=${enc(token)}` : ""}`,
        headers
      );
      total = r.total;
      for (const x of r.data ?? []) {
        if (q.author.trim() && !(x.authors ?? []).some((a: any) => (a.name ?? "").toLowerCase().includes(q.author.trim().toLowerCase()))) continue;
        works.push(
          work("Semantic Scholar", {
            title: x.title,
            authors: (x.authors ?? []).map((a: any) => a.name),
            year: x.year ?? undefined,
            venue: x.journal?.name || x.venue,
            doi: x.externalIds?.DOI,
            url: x.url,
            oaUrl: x.openAccessPdf?.url || undefined,
            abstract: x.abstract,
            citations: x.citationCount,
            type: (x.publicationTypes ?? []).join("; "),
          })
        );
      }
      ctx.progress(works.length, total);
      token = r.token ?? "";
      if (token && !ctx.settings.s2Key) await sleep(1100);
    } while (token && works.length < q.max && !ctx.cancelled());
    return { works: works.slice(0, q.max), total, queryString: expr };
  },
};
