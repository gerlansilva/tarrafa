import type { Source } from "../types";
import { hasTerms, matchesLocally } from "../query";
import { enc, work } from "./util";

export const crossref: Source = {
  id: "crossref",
  name: "Crossref",
  region: "int",
  description: "Todos os trabalhos com DOI; ótimo para listar revistas por ISSN. Não entende E/OU: o Tarrafa faz uma consulta por combinação e confere aqui.",
  supportsTerms: true,
  supportsJournals: true,
  async search(q, ctx) {
    const params: string[] = [];
    if (q.author.trim()) params.push(`query.author=${enc(q.author.trim())}`);
    const f: string[] = [];
    if (q.yearFrom) f.push(`from-pub-date:${q.yearFrom}`);
    if (q.yearTo) f.push(`until-pub-date:${q.yearTo}`);
    for (const i of q.issns) f.push(`issn:${i}`);
    if (q.onlyArticles) f.push("type:journal-article");
    if (f.length) params.push(`filter=${enc(f.join(","))}`);
    if (ctx.settings.email) params.push(`mailto=${enc(ctx.settings.email)}`);
    params.push("select=DOI,title,author,issued,container-title,ISSN,is-referenced-by-count,abstract,subject,type,URL");
    // o Crossref não entende E/OU e mistura idiomas mal: faz uma consulta por combinação
    // (um termo de cada conceito) e confere a combinação completa aqui
    const clean = (t: string) => t.replace(/[*?"]/g, "").trim();
    let combos: string[][] = [[]];
    for (const b of q.blocks.filter((b) => b.length)) combos = combos.flatMap((c) => b.map((t) => [...c, clean(t)]));
    combos = combos.slice(0, 12);
    const check = hasTerms(q);
    const seen = new Set<string>();
    const works = [];
    let scanned = 0;
    let total: number | undefined;
    for (const c of check ? combos : [[]]) {
      if (works.length >= q.max || ctx.cancelled()) break;
      const qp = c.length ? `&query.bibliographic=${enc(c.join(" "))}` : "";
      const per = check ? 200 : Math.min(500, q.max);
      // com termos, pagina por offset: o cursor do Crossref desliga a ordenação por relevância
      let cursor = "*";
      let pages = 0;
      while (cursor && works.length < q.max && !ctx.cancelled() && (check ? pages < 2 : true)) {
        const paging = check ? `&offset=${pages * per}` : `&cursor=${enc(cursor)}`;
        const r = await ctx.getJson(`https://api.crossref.org/works?${params.join("&")}${qp}&rows=${per}${paging}`);
        const m = r.message ?? {};
        if (!check) total = m["total-results"];
        const items = m.items ?? [];
        scanned += items.length;
        pages++;
        for (const x of items) {
          if (seen.has(x.DOI)) continue;
          seen.add(x.DOI);
          const w = work("Crossref", {
            title: (x.title ?? [])[0],
            authors: (x.author ?? []).map((a: any) => [a.family, a.given].filter(Boolean).join(", ") || a.name).filter(Boolean),
            year: x.issued?.["date-parts"]?.[0]?.[0] ?? undefined,
            venue: (x["container-title"] ?? [])[0],
            issn: x.ISSN,
            doi: x.DOI,
            url: x.URL,
            abstract: x.abstract,
            keywords: x.subject,
            citations: x["is-referenced-by-count"],
            type: x.type,
          });
          if (!check || matchesLocally(w, q)) works.push(w);
        }
        ctx.progress(works.length, check ? undefined : total);
        cursor = items.length ? (check ? "offset" : m["next-cursor"]) : "";
      }
    }
    const note = check ? `${combos.length} consultas; E/OU conferidos aqui (${works.length} de ${scanned} analisados)` : undefined;
    return { note, works: works.slice(0, q.max), total: check ? works.length : total, queryString: (check ? combos.map((c) => c.join(" ")).join(" | ") + " · " : "") + params.filter((p) => !p.startsWith("select") && !p.startsWith("mailto")).map(decodeURIComponent).join("&") };
  },
};
