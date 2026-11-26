import type { Query, Source } from "../types";
import { booleanExpr, hasTerms } from "../query";
import { enc, work } from "./util";

function abstractFromIndex(inv?: Record<string, number[]> | null): string | undefined {
  if (!inv) return undefined;
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(" ");
}

export function openAlexFilter(q: Query): string {
  const f: string[] = [];
  if (hasTerms(q)) {
    const expr = booleanExpr(q).replace(/,/g, " ");
    const field = q.scope === "title" ? "title.search" : q.scope === "tak" ? "title_and_abstract.search" : "default.search";
    // a OpenAlex só aceita curinga (* ou ?) no campo sem radicalização
    const wild = /[*?]/.test(expr);
    f.push(`${field}${wild ? ".exact" : ""}:${expr}`);
  }
  if (q.author.trim()) f.push(`raw_author_name.search:${q.author.trim().replace(/,/g, " ")}`);
  if (q.yearFrom || q.yearTo) f.push(`publication_year:${q.yearFrom ?? ""}-${q.yearTo ?? ""}`);
  if (q.issns.length) f.push(`primary_location.source.issn:${q.issns.join("|")}`);
  if (q.sourceCountry) f.push(`primary_location.source.country_code:${q.sourceCountry.toLowerCase()}`);
  if (q.onlyArticles) f.push("type:article");
  return f.join(",");
}

export const openalex: Source = {
  id: "openalex",
  name: "OpenAlex",
  region: "int",
  description: "Mais de 250 milhões de trabalhos; busca booleana e filtro por ISSN. Gratuito.",
  supportsTerms: true,
  supportsJournals: true,
  async search(q, ctx) {
    const filter = openAlexFilter(q);
    const select =
      "id,doi,title,publication_year,authorships,primary_location,cited_by_count,abstract_inverted_index,keywords,type,language,open_access";
    const mail =
      (ctx.settings.email ? `&mailto=${enc(ctx.settings.email)}` : "") +
      (ctx.settings.openalexKey ? `&api_key=${enc(ctx.settings.openalexKey)}` : "");
    const base = `https://api.openalex.org/works?filter=${enc(filter)}&select=${select}&per-page=200${mail}`;
    const works = [];
    // Sem chave, o OpenAlex não aceita cursor além da 1ª página: usa page= (até 10 mil) com pausa entre páginas.
    const keyed = !!ctx.settings.openalexKey;
    let cursor = "*";
    let page = 1;
    let total: number | undefined;
    let stopped = "";
    while (cursor && works.length < q.max && !ctx.cancelled()) {
      let r: any;
      try {
        r = await ctx.getJson(keyed ? `${base}&cursor=${enc(cursor)}` : `${base}&page=${page}`);
      } catch (e: any) {
        if (!works.length) throw e;
        stopped = `parou em ${works.length} de ${total}: o OpenAlex limitou a busca sem chave (${String(e?.message ?? e).slice(0, 60)})`;
        break;
      }
      total = r.meta?.count;
      for (const x of r.results ?? []) {
        const src = x.primary_location?.source;
        works.push(
          work("OpenAlex", {
            title: x.title,
            authors: (x.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
            year: x.publication_year ?? undefined,
            venue: src?.display_name,
            issn: src?.issn ?? undefined,
            doi: x.doi,
            url: x.doi ?? x.primary_location?.landing_page_url ?? x.id,
            oaUrl: x.open_access?.oa_url ?? undefined,
            abstract: abstractFromIndex(x.abstract_inverted_index),
            keywords: (x.keywords ?? []).map((k: any) => k.display_name),
            citations: x.cited_by_count,
            type: x.type,
            lang: x.language,
          })
        );
      }
      ctx.progress(works.length, total);
      if (!r.results?.length) break;
      if (keyed) cursor = r.meta?.next_cursor;
      else {
        page++;
        if ((page - 1) * 200 >= Math.min(total ?? 0, 10000)) break;
        await new Promise((res) => setTimeout(res, 1200));
      }
    }
    const note = stopped || (keyed ? undefined : "sem chave de API: cota gratuita compartilhada, até 10 mil registros (veja Configurações)");
    return { works: works.slice(0, q.max), total, queryString: `filter=${filter}`, note };
  },
};
