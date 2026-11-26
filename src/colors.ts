// Cores de identificação: cada base, tipo e idioma tem a sua, e cada conceito da busca também.

const SRC: Record<string, string> = {
  OpenAlex: "#2e9bea",
  ERIC: "#13307a",
  Crossref: "#4f6d9a",
  "Semantic Scholar": "#168a96",
  DOAJ: "#2f8a68",
  SciELO: "#5866d6",
  "BDTD (IBICT)": "#7a5fc7",
  BDTD: "#7a5fc7",
};
const TYPE: Record<string, string> = {
  "Artigo de revista": "#2e9bea",
  "Artigo de evento": "#168a96",
  Tese: "#7a5fc7",
  "Dissertação": "#5866d6",
  "Tese/dissertação": "#6f63cf",
  "Capítulo de livro": "#2f8a68",
  Livro: "#2f8a68",
  Preprint: "#d97100",
  "Relatório": "#4f6d9a",
  Dados: "#4f6d9a",
  Outro: "#8c99b3",
};
const LANG: Record<string, string> = {
  "Português": "#2f8a68",
  "Inglês": "#2e9bea",
  Espanhol: "#168a96",
  "Francês": "#7a5fc7",
};
const SPARE = ["#2e9bea", "#168a96", "#5866d6", "#2f8a68", "#4f6d9a", "#7a5fc7", "#13307a", "#3a9fb8"];

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
export const srcColor = (name: string) => SRC[name] ?? SPARE[hash(name) % SPARE.length];
export const typeColor = (t: string) => TYPE[t] ?? "#868e96";
export const langColor = (l: string) => LANG[l] ?? SPARE[hash(l) % SPARE.length];
export const kwColor = (k: string) => SPARE[hash(k.toLowerCase()) % SPARE.length];

/** Mistura a cor com branco (a = parte da cor, 0–1). */
export function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * a + 255 * (1 - a)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
/** Escurece a cor (a = parte da cor, 0–1, resto preto). */
export function shade(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * a));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
/** Estilo em linha de uma etiqueta colorida (fundo claro, texto escuro, borda média). */
export const tagStyle = (hex: string) => `--tg:${hex};--tg-bg:${tint(hex, 0.12)};--tg-bd:${tint(hex, 0.32)};--tg-ink:${shade(hex, 0.72)}`;

/** Cinco cores para os conceitos da busca (mesma ordem das classes .c0–.c4 no CSS). */
export const CONCEPTS = ["#2b2bef", "#f2b705", "#1e9e55", "#e5457d", "#8a4fff"];
