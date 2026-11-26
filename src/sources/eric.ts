import type { Source } from "../types";
import { booleanExpr, hasTerms } from "../query";
import { enc, work } from "./util";

export const eric: Source = {
  id: "eric",
  name: "ERIC",
  region: "int",
  description: "Base do Institute of Education Sciences (EUA): 1,6 milhão de registros em Educação, com descritores do tesauro.",
  supportsTerms: true,
  supportsJournals: true,
  async search(q, ctx) {
    const parts: string[] = [];
    if (hasTerms(q)) {
      const expr =
        q.scope === "title"
          ? booleanExpr(q, { and: " AND ", or: " OR ", not: " NOT ", field: (t) => `title:${t}` })
          : booleanExpr(q);
      parts.push(`(${expr})`);
    }
    if (q.author.trim()) parts.push(`author:"${q.author.trim()}"`);
    if (q.issns.length) parts.push("(" + q.issns.flatMap((i) => [`issn:"ISSN-${i}"`, `issn:"EISSN-${i}"`]).join(" OR ") + ")");
    if (q.yearFrom || q.yearTo) parts.push(`publicationdateyear:[${q.yearFrom ?? "*"} TO ${q.yearTo ?? "*"}]`);
    if (q.onlyArticles) parts.push(`publicationtype:"Journal Articles"`);
    const search = parts.join(" AND ");
    const fields = "id,title,author,description,subject,publicationtype,publicationdateyear,issn,source,url,peerreviewed,language";
    const rows = 200;
    const works = [];
    let start = 0;
    let total: number | undefined;
    while (works.length < q.max && !ctx.cancelled()) {
      const r = await ctx.getJson(
        `https://api.ies.ed.gov/eric/?search=${enc(search)}&format=json&rows=${rows}&start=${start}&fields=${fields}`
      );
      const resp = r.response ?? {};
      total = resp.numFound;
      const docs = resp.docs ?? [];
      for (const x of docs) {
        works.push(
          work("ERIC", {
            title: x.title,
            authors: x.author ?? [],
            year: x.publicationdateyear,
            venue: x.source,
            issn: (x.issn ?? []).map((s: string) => s.replace(/^E?ISSN-/, "")),
            url: x.url && /^https?:/.test(x.url) && x.url.includes("doi.org") ? x.url : `https://eric.ed.gov/?id=${x.id}`,
            doi: x.url,
            oaUrl: String(x.id).startsWith("ED") ? `https://files.eric.ed.gov/fulltext/${x.id}.pdf` : undefined,
            abstract: x.description,
            keywords: x.subject,
            type: (x.publicationtype ?? []).join("; "),
            lang: (x.language ?? [])[0],
          })
        );
      }
      ctx.progress(works.length, total);
      start += rows;
      if (!docs.length || start >= (total ?? 0)) break;
    }
    return { works: works.slice(0, q.max), total, queryString: search };
  },
};
