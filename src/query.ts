import type { Query, Work } from "./types";

/** Divide o texto de um campo em termos (um por linha ou separados por ";"). */
export function splitTerms(text: string): string[] {
  return text
    .split(/[\n;]+/)
    .map((t) => t.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

export function quote(t: string): string {
  return /\s/.test(t) && !t.endsWith("*") ? `"${t}"` : t;
}

export interface BoolOpts {
  and: string;
  or: string;
  not: string;
  quoteFn?: (t: string) => string;
  field?: (t: string) => string;
}

/** Monta a expressão booleana: (A1 OR A2) AND (B1 OR B2) NOT C. */
export function booleanExpr(q: Query, o: BoolOpts = { and: " AND ", or: " OR ", not: " NOT " }): string {
  const qf = o.quoteFn ?? quote;
  const f = o.field ?? ((t: string) => t);
  const blocks = q.blocks.filter((b) => b.length);
  const parts = blocks.map((b) => (b.length === 1 ? f(qf(b[0])) : "(" + b.map((t) => f(qf(t))).join(o.or) + ")"));
  // um único bloco não precisa de parênteses (algumas APIs rejeitam expressão que começa com "(")
  let expr = blocks.length === 1 ? blocks[0].map((t) => f(qf(t))).join(o.or) : parts.join(o.and);
  for (const t of q.noneTerms) expr += o.not + f(qf(t));
  return expr.trim();
}

/** Todas as palavras (sem operadores), para bases que só aceitam texto livre. */
export function plainTerms(q: Query): string {
  return q.blocks.flat().join(" ");
}

export function hasTerms(q: Query): boolean {
  return q.blocks.some((b) => b.length);
}

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function termRegex(t: string): RegExp {
  const n = normalize(t).replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const body = n.endsWith("*") ? n.slice(0, -1).replace(/\*/g, "\\w*") + "\\w*" : n.replace(/\*/g, "\\w*");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}(?=$|[^\\p{L}\\p{N}])`, "u");
}

function haystack(w: Work, scope: Query["scope"]): string {
  const parts = [w.title];
  if (scope !== "title") parts.push(w.abstract ?? "", (w.keywords ?? []).join(" "));
  if (scope === "all") parts.push(w.venue ?? "");
  return normalize(parts.join(" \n "));
}

/** Aplica a lógica booleana localmente — usado no SciELO e quando o usuário pede filtragem local. */
export function matchesLocally(w: Work, q: Query): boolean {
  const h = haystack(w, q.scope);
  for (const b of q.blocks) if (b.length && !b.some((t) => termRegex(t).test(h))) return false;
  if (q.noneTerms.some((t) => termRegex(t).test(h))) return false;
  return true;
}

export function inYearRange(w: Work, q: Query): boolean {
  if (w.year == null) return q.yearFrom == null && q.yearTo == null;
  if (q.yearFrom != null && w.year < q.yearFrom) return false;
  if (q.yearTo != null && w.year > q.yearTo) return false;
  return true;
}

/** Termos para destacar na interface. */
export function highlightTerms(q: Query): RegExp | null {
  const ts = q.blocks.flat().filter(Boolean);
  if (!ts.length) return null;
  const alts = ts.map((t) =>
    t.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "\\w*")
  );
  return new RegExp(`(${alts.join("|")})`, "giu");
}

export function cleanIssn(s: string): string {
  const d = s.toUpperCase().replace(/[^0-9X]/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : s.trim();
}
