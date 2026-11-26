import {
  ArrowUpRight, BookMarked, Check, ChevronDown, CircleStop, Copy, Download, FileUp, Highlighter, LibraryBig,
  LockOpen, Plus, Search, Settings2, Table2, Rows3, X, ChartColumnBig, History, Pencil, Trash2,
} from "lucide";

type Node = [string, Record<string, string | number>][];
const SET: Record<string, Node> = {
  arrow: ArrowUpRight as Node, journals: BookMarked as Node, check: Check as Node, down: ChevronDown as Node,
  stop: CircleStop as Node, copy: Copy as Node, download: Download as Node, import: FileUp as Node,
  basket: Highlighter as Node, library: LibraryBig as Node, oa: LockOpen as Node, plus: Plus as Node,
  search: Search as Node, settings: Settings2 as Node, table: Table2 as Node, rows: Rows3 as Node, x: X as Node,
  chart: ChartColumnBig as Node, history: History as Node, edit: Pencil as Node, trash: Trash2 as Node,
};

/** Ícone Lucide como SVG em linha (herda a cor do texto). */
export function ic(name: keyof typeof SET | string, size = 16): string {
  const node = SET[name];
  if (!node) return "";
  const inner = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
