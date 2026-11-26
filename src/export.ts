import type { HistoryEntry, Work } from "./types";

const csvCell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(ws: Work[]): string {
  const cols: [string, (w: Work) => unknown][] = [
    ["Citações", (w) => w.citations],
    ["Autores", (w) => w.authors],
    ["Título", (w) => w.title],
    ["Ano", (w) => w.year],
    ["Fonte", (w) => w.venue],
    ["ISSN", (w) => w.issn],
    ["DOI", (w) => w.doi],
    ["URL", (w) => w.url],
    ["Acesso aberto", (w) => w.oaUrl],
    ["Tipo", (w) => w.type],
    ["Idioma", (w) => w.lang],
    ["Palavras-chave", (w) => w.keywords],
    ["Resumo", (w) => w.abstract],
    ["Bases", (w) => w.sources],
  ];
  const head = cols.map((c) => c[0]).join(",");
  return "\ufeff" + [head, ...ws.map((w) => cols.map((c) => csvCell(c[1](w))).join(","))].join("\n");
}

/** Planilha de triagem: uma linha por trabalho, com colunas vazias para a decisão e o motivo. */
export function toTriage(ws: Work[]): string {
  const cols: [string, (w: Work, i: number) => unknown][] = [
    ["Nº", (_w, i) => i + 1],
    ["Decisão (incluir/excluir/dúvida)", () => ""],
    ["Motivo", () => ""],
    ["Título", (w) => w.title],
    ["Autores", (w) => w.authors],
    ["Ano", (w) => w.year],
    ["Revista", (w) => w.venue],
    ["Tipo", (w) => w.type],
    ["DOI", (w) => w.doi],
    ["Link", (w) => w.oaUrl || w.url],
    ["Resumo", (w) => w.abstract],
    ["Bases", (w) => w.sources],
  ];
  const head = cols.map((c) => c[0]).join(",");
  return "\ufeff" + [head, ...ws.map((w, i) => cols.map((c) => csvCell(c[1](w, i))).join(","))].join("\n");
}

export function toRIS(ws: Work[]): string {
  return ws
    .map((w) => {
      const l: string[] = [`TY  - ${/thesis|tese|disserta/i.test(w.type ?? "") ? "THES" : "JOUR"}`];
      l.push(`TI  - ${w.title}`);
      for (const a of w.authors) l.push(`AU  - ${a}`);
      if (w.year) l.push(`PY  - ${w.year}`);
      if (w.venue) l.push(`T2  - ${w.venue}`);
      for (const i of w.issn ?? []) l.push(`SN  - ${i}`);
      if (w.doi) l.push(`DO  - ${w.doi}`);
      if (w.url) l.push(`UR  - ${w.url}`);
      if (w.abstract) l.push(`AB  - ${w.abstract.replace(/\n+/g, " ")}`);
      for (const k of w.keywords ?? []) l.push(`KW  - ${k}`);
      if (w.lang) l.push(`LA  - ${w.lang}`);
      l.push(`N1  - Bases: ${w.sources.join(", ")}; citações: ${w.citations ?? "?"}`);
      l.push("ER  - ");
      return l.join("\r\n");
    })
    .join("\r\n\r\n");
}

export function toBibTeX(ws: Work[]): string {
  const used = new Set<string>();
  const esc = (s: string) => s.replace(/[{}]/g, "");
  return ws
    .map((w) => {
      const sur = (w.authors[0] ?? "anon").split(/[ ,]/)[0].normalize("NFD").replace(/[^A-Za-z]/g, "").toLowerCase() || "anon";
      let key = `${sur}${w.year ?? ""}`;
      let i = 0;
      while (used.has(key)) key = `${sur}${w.year ?? ""}${String.fromCharCode(97 + i++)}`;
      used.add(key);
      const thesis = /tese|thesis/i.test(w.type ?? "") ? "phdthesis" : /disserta|master/i.test(w.type ?? "") ? "mastersthesis" : "article";
      const f: string[] = [`  title = {${esc(w.title)}}`];
      if (w.authors.length) f.push(`  author = {${esc(w.authors.join(" and "))}}`);
      if (w.year) f.push(`  year = {${w.year}}`);
      if (w.venue) f.push(`  ${thesis === "article" ? "journal" : "school"} = {${esc(w.venue)}}`);
      if (w.doi) f.push(`  doi = {${w.doi}}`);
      if (w.url) f.push(`  url = {${w.url}}`);
      if (w.abstract) f.push(`  abstract = {${esc(w.abstract)}}`);
      if (w.keywords?.length) f.push(`  keywords = {${esc(w.keywords.join(", "))}}`);
      return `@${thesis}{${key},\n${f.join(",\n")}\n}`;
    })
    .join("\n\n");
}

export function historyToMarkdown(h: HistoryEntry[]): string {
  const rows = h.flatMap((e) =>
    e.runs.map(
      (r) =>
        `| ${new Date(e.date).toLocaleString("pt-BR")} | ${r.source} | \`${r.queryString.replace(/\|/g, "\\|")}\` | ${r.total ?? "—"} | ${r.retrieved} |`
    )
  );
  return ["| Data | Base | Estratégia enviada | Total na base | Recuperados |", "|---|---|---|---|---|", ...rows].join("\n");
}

/** Referência aproximada no padrão ABNT (NBR 6023) para copiar e colar. Revise antes de usar. */
export function toABNT(w: Work): string {
  const fmtAuthor = (a: string) => {
    const [sur, given] = a.includes(",") ? a.split(/,\s*/, 2) : [a.split(" ").slice(-1)[0], a.split(" ").slice(0, -1).join(" ")];
    return given ? `${sur.toUpperCase()}, ${given}` : sur.toUpperCase();
  };
  const au = w.authors.length > 3 ? `${fmtAuthor(w.authors[0])} et al.` : w.authors.map(fmtAuthor).join("; ");
  const parts = [au ? `${au}.` : "", `${w.title}.`];
  if (w.venue && w.venue !== "BDTD") parts.push(`${w.venue},`);
  if (w.year) parts.push(`${w.year}.`);
  if (w.doi) parts.push(`DOI: https://doi.org/${w.doi}.`);
  else if (w.url) parts.push(`Disponível em: ${w.url}.`);
  return parts.filter(Boolean).join(" ").replace(/\.\./g, ".");
}
