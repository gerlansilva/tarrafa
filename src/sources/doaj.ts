import type { Source } from "../types";
import { authorParts, booleanExpr, hasTerms } from "../query";
import { enc, work } from "./util";

export const doaj: Source = {
  id: "doaj",
  name: "DOAJ",
  region: "int",
  description: "Diretório de revistas de acesso aberto; inclui muitas revistas brasileiras e latino-americanas.",
  supportsTerms: true,
  supportsJournals: true,
  async search(q, ctx) {
    const parts: string[] = [];
    let wild = false;
    if (hasTerms(q)) {
      const field = q.scope === "title" ? (t: string) => `bibjson.title:${t}` : (t: string) => t;
      // o DOAJ recusa curingas: usa o radical sem o *
      const noWild = { ...q, blocks: q.blocks.map((b) => b.map((t) => t.replace(/[*?]/g, ""))), noneTerms: q.noneTerms.map((t) => t.replace(/[*?]/g, "")) };
      wild = q.blocks.flat().concat(q.noneTerms).some((t) => /[*?]/.test(t));
      parts.push(`(${booleanExpr(noWild, { and: " AND ", or: " OR ", not: " NOT ", field })})`);
    }
    if (q.author.trim()) {
      const { surname, given } = authorParts(q.author);
      const byName = `bibjson.author.name:(${[surname, given].filter(Boolean).join(" AND ")})`;
      parts.push(q.authorOrcid ? `(bibjson.author.orcid_id:"https://orcid.org/${q.authorOrcid}" OR ${byName})` : byName);
    }
    if (q.issns.length) parts.push("(" + q.issns.map((i) => `issn:${i}`).join(" OR ") + ")");
    if (q.sourceCountry) parts.push(`bibjson.journal.country:${q.sourceCountry.toUpperCase()}`);
    if (q.yearFrom || q.yearTo) parts.push(`bibjson.year:[${q.yearFrom ?? "*"} TO ${q.yearTo ?? "*"}]`);
    const query = parts.join(" AND ");
    const works = [];
    let page = 1;
    let total: number | undefined;
    while (works.length < q.max && !ctx.cancelled()) {
      // a API do DOAJ devolve no máximo 50 por página a partir da 2ª, mesmo pedindo 100
      const r = await ctx.getJson(`https://doaj.org/api/search/articles/${enc(query)}?page=${page}&pageSize=50`);
      total = r.total;
      const res = r.results ?? [];
      for (const x of res) {
        const b = x.bibjson ?? {};
        const ids = b.identifier ?? [];
        works.push(
          work("DOAJ", {
            title: b.title,
            authors: (b.author ?? []).map((a: any) => a.name),
            year: b.year ? Number(b.year) : undefined,
            venue: b.journal?.title,
            issn: b.journal?.issns,
            doi: ids.find((i: any) => (i.type ?? "").toLowerCase() === "doi")?.id,
            url: (b.link ?? [])[0]?.url,
            oaUrl: (b.link ?? []).find((l: any) => l.type === "fulltext")?.url,
            abstract: b.abstract,
            keywords: b.keywords,
            lang: (b.journal?.language ?? [])[0],
            type: "article",
          })
        );
      }
      ctx.progress(works.length, total);
      if (!res.length || page * 50 >= (total ?? 0)) break;
      page++;
    }
    return { works: works.slice(0, q.max), total, queryString: query, note: wild ? "o DOAJ não aceita *; buscou o radical sem ele" : undefined };
  },
};
