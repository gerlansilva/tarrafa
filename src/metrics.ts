import type { Work } from "./types";

export interface Metrics {
  papers: number;
  citations: number;
  years: number;
  citesPerYear: number;
  citesPerPaper: number;
  authorsPerPaper: number;
  h: number;
  g: number;
  hNorm: number;
  withDoi: number;
  withAbstract: number;
  openAccess: number;
}

/** Métricas no estilo do Publish or Perish. */
export function computeMetrics(ws: Work[], refYear = new Date().getFullYear()): Metrics {
  const cites = ws.map((w) => w.citations ?? 0).sort((a, b) => b - a);
  const total = cites.reduce((a, b) => a + b, 0);
  let h = 0;
  while (h < cites.length && cites[h] >= h + 1) h++;
  let g = 0,
    acc = 0;
  for (let i = 0; i < cites.length; i++) {
    acc += cites[i];
    if (acc >= (i + 1) ** 2) g = i + 1;
  }
  // hI,norm: citações divididas pelo nº de autores, depois o h
  const normC = ws.map((w) => (w.citations ?? 0) / Math.max(1, w.authors.length)).sort((a, b) => b - a);
  let hNorm = 0;
  while (hNorm < normC.length && normC[hNorm] >= hNorm + 1) hNorm++;
  const ys = ws.map((w) => w.year).filter((y): y is number => !!y);
  const years = ys.length ? refYear - Math.min(...ys) + 1 : 0;
  const n = ws.length || 1;
  return {
    papers: ws.length,
    citations: total,
    years,
    citesPerYear: years ? total / years : 0,
    citesPerPaper: total / n,
    authorsPerPaper: ws.reduce((a, w) => a + w.authors.length, 0) / n,
    h,
    g,
    hNorm,
    withDoi: ws.filter((w) => w.doi).length,
    withAbstract: ws.filter((w) => w.abstract).length,
    openAccess: ws.filter((w) => w.oaUrl).length,
  };
}

export function countBy<T>(ws: T[], f: (w: T) => (string | number | undefined)[] | string | number | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const w of ws) {
    const v = f(w);
    const vs = Array.isArray(v) ? v : [v];
    for (const x of vs) if (x !== undefined && x !== "") m.set(String(x), (m.get(String(x)) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
