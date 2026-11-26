import type { Source, Work } from "../types";
import { booleanExpr, hasTerms } from "../query";
import { enc, work } from "./util";

/*
 * A API pública da BDTD (VuFind) só expõe: id, title, authors, formats, languages, subjects, urls.
 * Não traz ano nem resumo. O filtro de ano funciona no servidor, então, quando há período definido
 * (até 40 anos), fazemos uma consulta por ano e anotamos o ano em cada registro.
 */
export const bdtd: Source = {
  id: "bdtd",
  name: "BDTD (IBICT)",
  region: "br",
  description: "Biblioteca Digital Brasileira de Teses e Dissertações. A API não fornece resumo; o ano vem do filtro por período.",
  supportsTerms: true,
  supportsJournals: false,
  async search(q, ctx) {
    if (!hasTerms(q) && !q.author.trim()) return { works: [], queryString: "", note: "precisa de termos ou autor" };
    const lookfor = hasTerms(q) ? booleanExpr(q) : q.author.trim();
    const type = !hasTerms(q) ? "Author" : q.scope === "title" ? "Title" : "AllFields";
    const base = [`lookfor=${enc(lookfor)}`, `type=${type}`, "limit=100"];
    if (hasTerms(q) && q.author.trim()) base.push(`filter[]=${enc(`author:"${q.author.trim()}"`)}`);

    const years: (number | undefined)[] = [];
    if (q.yearFrom && q.yearTo && q.yearTo - q.yearFrom <= 40) {
      for (let y = q.yearTo; y >= q.yearFrom; y--) years.push(y);
    } else years.push(undefined);

    const works: Work[] = [];
    let total = 0;
    for (const y of years) {
      if (works.length >= q.max || ctx.cancelled()) break;
      const params = [...base];
      if (y) params.push(`filter[]=${enc(`publishDate:[${y} TO ${y}]`)}`);
      else if (q.yearFrom || q.yearTo) params.push(`filter[]=${enc(`publishDate:[${q.yearFrom ?? "*"} TO ${q.yearTo ?? "*"}]`)}`);
      let page = 1;
      while (works.length < q.max && !ctx.cancelled()) {
        const r = await ctx.getJson(`https://bdtd.ibict.br/vufind/api/v1/search?${params.join("&")}&page=${page}`);
        if (r.status && r.status !== "OK") throw new Error(r.statusMessage ?? "erro na BDTD");
        if (page === 1) total += r.resultCount ?? 0;
        const recs = r.records ?? [];
        for (const x of recs) {
          works.push(
            work("BDTD", {
              title: x.title,
              authors: Object.keys(x.authors?.primary ?? {}),
              year: y,
              venue: "BDTD",
              url: (x.urls ?? [])[0]?.url ?? `https://bdtd.ibict.br/vufind/Record/${x.id}`,
              keywords: (x.subjects ?? []).flat().filter((s: string) => !s.startsWith("CNPQ::")),
              type: (x.formats ?? []).join("; ").replace("masterThesis", "dissertação").replace("doctoralThesis", "tese"),
              lang: (x.languages ?? [])[0],
            })
          );
        }
        ctx.progress(works.length, total);
        if (!recs.length || page * 100 >= (r.resultCount ?? 0)) break;
        page++;
      }
    }
    return { works: works.slice(0, q.max), total, queryString: `${type}: ${lookfor}` };
  },
};
