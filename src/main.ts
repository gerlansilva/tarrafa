import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";
import { ic } from "./icons";
import { CONCEPTS, kwColor, langColor, srcColor, tagStyle, typeColor } from "./colors";
import type { Journal, HistoryEntry, JournalList, Query, Scope, SearchContext, Settings, Work } from "./types";
import { SOURCES, sourceById } from "./sources";
import { booleanExpr, cleanIssn, hasTerms, highlightTerms, inYearRange, matchesLocally, authorMatches, authorParts, orcidOf } from "./query";
import { getJson, httpGet, httpPost, saveFile } from "./http";
import { dedupe } from "./dedup";
import { computeMetrics, countBy } from "./metrics";
import { historyToMarkdown, toABNT, toBibTeX, toCSV, toRIS, toTriage } from "./export";
import { parseBibTeX, parseRIS } from "./importers";
import { store } from "./store";

// =============================================================== estado
type View = "search" | "results" | "metrics" | "history";
type Status = { state: "run" | "ok" | "err" | "skip"; done: number; total?: number; msg?: string };
type SortKey = "relevance" | "citations" | "newest" | "oldest" | "title";

const S = {
  view: "search" as View,
  settings: store.settings() as Settings,
  lists: store.lists() as JournalList[],
  history: store.history() as HistoryEntry[],
  form: {
    blocks: [[]] as string[][],
    /** ligação entre o grupo i e o i+1 */
    ops: [] as Op[],
    none: [] as string[],
    scope: "tak" as Scope,
    author: "",
    yearFrom: "",
    yearTo: "",
    listId: "",
    country: "",
    onlyArticles: false,
    localFilter: false,
    showAdvanced: false,
    showPreview: false,
  },
  raw: [] as Work[],
  works: [] as Work[],
  lastQuery: null as Query | null,
  status: {} as Record<string, Status>,
  running: false,
  cancel: false,
  f: { text: "", y1: 0, y2: 0, venue: "", source: "", type: "", lang: "", kw: "", author: "", concept: -1, allConcepts: false, onlyOA: false, onlyMulti: false, onlyAbstract: false },
  sort: "relevance" as SortKey,
  layout: "cards" as "cards" | "table",
  basket: new Set<string>(),
  active: null as string | null,
  shown: 60,
  venuesAll: false,
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number, d = 0) => n.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d });
const LOGO = "/logo.svg";

function toast(msg: string) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// =============================================================== moldura
document.querySelector("#app")!.innerHTML = `
<div class="app">
  <header class="top">
    <div class="brand"><img src="${LOGO}" alt="">Tarrafa</div>
    <nav class="nav" id="nav"></nav>
    <span class="spacer"></span>
    <button class="tool-btn" id="btnLists" title="Listas de revistas">${ic("journals")}Revistas</button>
    <button class="tool-btn" id="btnSettings" title="Configurações">${ic("settings")}<span class="sr">Configurações</span></button>
  </header>
  <div class="view" id="view"></div>
</div>
<div id="basketSlot"></div>`;

function renderNav() {
  const tabs: [View, string, string, string?][] = [
    ["search", "Busca", "search"],
    ["results", "Resultados", "rows", S.works.length ? fmt(S.works.length) : undefined],
    ["metrics", "Métricas", "chart"],
    ["history", "Histórico", "history"],
  ];
  $("#nav").innerHTML = tabs
    .map(([v, l, i, b]) => `<button data-v="${v}" class="${S.view === v ? "on" : ""}" ${S.view === v ? `aria-current="page"` : ""}>${ic(i)}${l}${b ? `<span class="badge">${b}</span>` : ""}</button>`)
    .join("");
  $$("#nav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.v as View)));
}

function go(v: View) {
  S.view = v;
  render();
}

function render() {
  renderNav();
  ({ search: renderSearch, results: renderResults, metrics: renderMetrics, history: renderHistory })[S.view]();
  renderBasket();
  setupClamps();
}

/** Textos longos (expressão de busca) ficam recolhidos com um botão "Mostrar tudo"; o estado aberto sobrevive aos re-renders. */
const openClamps = new Set<string>();
function setupClamps() {
  document.querySelectorAll<HTMLElement>("[data-clamp]").forEach((el) => {
    const id = el.dataset.clamp!;
    el.nextElementSibling?.classList.contains("clamp-btn") && el.nextElementSibling.remove();
    el.classList.add("clamp");
    el.classList.toggle("open", openClamps.has(id));
    const tall = el.scrollHeight > (parseFloat(getComputedStyle(el).getPropertyValue("--clamp")) || 120) + 8;
    el.classList.toggle("cut", tall && !openClamps.has(id));
    if (!tall) return;
    const b = document.createElement("button");
    b.className = "link-btn clamp-btn";
    b.setAttribute("aria-expanded", String(openClamps.has(id)));
    b.textContent = openClamps.has(id) ? "Mostrar menos" : "Mostrar tudo";
    b.onclick = () => { openClamps.has(id) ? openClamps.delete(id) : openClamps.add(id); setupClamps(); };
    el.after(b);
  });
}

// =============================================================== consulta
type Op = "and" | "or" | "not";
const opOf = (i: number): Op => S.form.ops[i - 1] ?? "and";

/** Converte os grupos + operadores escolhidos na consulta canônica: grupos ligados por OU viram um só conceito; NÃO vira exclusão. */
function compileBlocks(): { blocks: string[][]; none: string[] } {
  const f = S.form;
  const blocks: string[][] = [];
  const none = [...f.none];
  f.blocks.forEach((b, i) => {
    const terms = b.filter(Boolean);
    if (!terms.length) return;
    const op = i ? opOf(i) : "and";
    if (op === "not") none.push(...terms);
    else if (op === "or" && blocks.length) blocks[blocks.length - 1].push(...terms);
    else blocks.push([...terms]);
  });
  return { blocks, none };
}

function currentQuery(): Query {
  const f = S.form;
  const list = S.lists.find((l) => l.id === f.listId);
  const c = compileBlocks();
  return {
    blocks: c.blocks,
    noneTerms: c.none,
    scope: f.scope,
    author: f.author.trim(),
    yearFrom: f.yearFrom ? Number(f.yearFrom) : undefined,
    yearTo: f.yearTo ? Number(f.yearTo) : undefined,
    issns: list ? [...new Set(list.journals.flatMap((j) => [j.issn, ...(j.alt ?? [])].map(cleanIssn)))] : [],
    journalListName: list?.name,
    sourceCountry: f.country || undefined,
    onlyArticles: f.onlyArticles,
    max: S.settings.maxPerSource,
    localFilter: f.localFilter,
  };
}

function validate(q: Query): string | null {
  if (!hasTerms(q) && !q.author && !q.issns.length) return "Escreva pelo menos um termo, um autor ou escolha uma lista de revistas.";
  if (q.yearFrom && q.yearTo && q.yearFrom > q.yearTo) return "O ano inicial é maior que o final.";
  if (!S.settings.enabledSources.length) return "Escolha pelo menos uma base.";
  return null;
}

function describeQuery(q: Query): string {
  const t = (q.blocks ?? []).map((b) => b.join(" ou ")).join("; e ");
  const yr = q.yearFrom && q.yearTo ? `${q.yearFrom} a ${q.yearTo}` : q.yearFrom ? `desde ${q.yearFrom}` : q.yearTo ? `até ${q.yearTo}` : "";
  return [t || "Sem termos", q.author && `autor ${q.author}`, q.journalListName && `revistas: ${q.journalListName}`, q.sourceCountry && `país: ${q.sourceCountry}`, yr].filter(Boolean).join(", ");
}

/** A busca em português corrido, para conferir sem ler a expressão booleana. */
function plainSentence(q: Query): string {
  const orc = orcidOf(q.author);
  const autor = q.authorLabel ? ` de <b>${esc(q.authorLabel)}</b> (ORCID ${esc(q.authorOrcid ?? "")})` : orc ? ` do autor com ORCID <b>${esc(orc)}</b>` : q.author ? ` de <b>${esc(q.author)}</b>` : "";
  if (!hasTerms(q)) return q.author ? `Trabalhos${autor}, sobre qualquer assunto.` : `<span class="hint">Digite as primeiras palavras para ver a busca montada aqui.</span>`;
  const grp = (b: string[], i: number) => b.map((t) => `<mark class="c${i % 5}">${esc(t)}</mark>`).join(" ou ");
  const parts = q.blocks.map((b, i) => (b.length > 1 ? `de ${grp(b, i)}` : `de ${grp(b, i)}`));
  let txt = `Trabalhos${autor} que falam ${parts.join(", <b>e também</b> ")}`;
  if (q.noneTerms.length) txt += `, <b>sem</b> ${q.noneTerms.map((t) => `<mark class="neg">${esc(t)}</mark>`).join(" nem ")}`;
  const where = { title: "no título", tak: "no título, resumo ou palavras-chave", all: "em qualquer parte do registro" }[q.scope];
  const pais = q.sourceCountry ? `, em revistas do país ${esc(COUNTRIES.find(([c]) => c === q.sourceCountry)?.[1] ?? q.sourceCountry)}` : "";
  return `${txt} ${where}${pais}.`;
}

/** A expressão booleana com cada grupo na sua cor. */
function exprHtml(q: Query): string {
  const qt = (t: string) => esc(/\s/.test(t) && !t.endsWith("*") ? `"${t}"` : t);
  const g = q.blocks.map((b, i) => {
    const inner = b.map((t) => `<span class="ex c${i % 5}">${qt(t)}</span>`).join(` <i>OR</i> `);
    return b.length > 1 && q.blocks.length > 1 ? `(${inner})` : inner;
  });
  let out = g.join(` <i>AND</i> `);
  for (const t of q.noneTerms) out += ` <i>NOT</i> <span class="ex neg">${qt(t)}</span>`;
  return out;
}

// =============================================================== tela: buscar
const COUNTRIES: [string, string][] = [
  ["", "Qualquer país"], ["BR", "Brasil"], ["PT", "Portugal"], ["AR", "Argentina"], ["CL", "Chile"], ["CO", "Colômbia"],
  ["MX", "México"], ["ES", "Espanha"], ["US", "Estados Unidos"], ["GB", "Reino Unido"],
];

function renderSearch() {
  queueMicrotask(setupClamps);
  const f = S.form;
  const q = currentQuery();
  const groups: [string, string[]][] = [
    ["Internacionais", ["int"]],
    ["Brasil e América Latina", ["br", "latam"]],
  ];
  const needsList = (id: string) => sourceById(id)?.journalsOnly && !f.listId;
  const noJournal = (id: string) => !sourceById(id)?.supportsJournals && !!f.listId;
  const BLURB: Record<string, string> = {
    openalex: "250 milhões de trabalhos, com citações",
    eric: "Educação, com descritores do tesauro",
    crossref: "Tudo o que tem DOI",
    semanticscholar: "Citações; lenta sem chave",
    doaj: "Revistas de acesso aberto",
    scielo: "Percorre as revistas de uma lista",
    bdtd: "Teses e dissertações brasileiras",
  };
  const usable = S.settings.enabledSources.filter((id) => sourceById(id) && !needsList(id) && !noJournal(id));
  const blockHtml = (terms: string[], i: number, none = false) => `
    <div class="block ${none || (i && opOf(i) === "not") ? "none" : `c${i % 5}`}" data-b="${none ? "none" : i}">
      <label class="btag" for="in-${none ? "none" : i}"><i class="dot"></i>${none ? "Sem estes termos" : i && opOf(i) === "not" ? "Excluir" : `Grupo ${i + 1}`}</label>
      <div class="chips">
        ${terms.map((t, j) => `${j ? `<span class="or">ou</span>` : ""}<span class="chip-term">${esc(t)}<button data-rmt="${j}" aria-label="Remover ${esc(t)}">${ic("x", 13)}</button></span>`).join("")}
        <input id="in-${none ? "none" : i}" data-in="${none ? "none" : i}" autocomplete="off" placeholder="${
          none ? "termo a excluir" : terms.length ? "outro sinônimo ou tradução" : i === 0 ? "ex.: educação estatística" : "ex.: formação de professores"
        }">
      </div>
      ${!none && f.blocks.length > 1 ? `<button class="rm" data-rmb="${i}" title="Remover conceito ${i + 1}">${ic("trash", 15)}</button>` : `<span></span>`}
    </div>`;
  $("#view").innerHTML = `
  <div class="home"><div class="search-grid">
    <section class="strategy" aria-labelledby="hSearch">
      <p class="eyebrow">1 · Estratégia</p><h1 id="hSearch" class="boxed">Uma busca, <span>várias bases</span></h1>
      <p class="lede">Digite as palavras e tecle Enter depois de cada uma. Palavras do mesmo grupo valem como alternativas (sinônimos, traduções). Entre os grupos, escolha <b>E</b>, <b>OU</b> ou <b>NÃO</b>; o Tarrafa monta a expressão por você.</p>
      <div class="blocks">
        ${f.blocks
          .map(
            (b, i) =>
              (i
                ? `<div class="opsel" role="radiogroup" aria-label="Ligação entre o grupo ${i} e o ${i + 1}">${(["and", "or", "not"] as Op[])
                    .map((o) => `<button role="radio" data-op="${i}" data-v="${o}" class="${o} ${opOf(i) === o ? "on" : ""}" aria-checked="${opOf(i) === o}">${{ and: "E", or: "OU", not: "NÃO" }[o]}</button>`)
                    .join("")}<span class="opsel-hint">${{ and: "precisa ter os dois grupos", or: "basta um dos grupos", not: "exclui o grupo de baixo" }[opOf(i)]}</span></div>`
                : "") + blockHtml(b, i)
          )
          .join("")}
        ${f.none.length || f.showAdvanced ? `<div class="and not" aria-hidden="true">mas não</div>` + blockHtml(f.none, 0, true) : ""}
      </div>
      <div class="composer-actions">
        <button class="link-btn" id="addBlock">${ic("plus", 15)}Adicionar grupo</button>
        <button class="link-btn" id="advToggle">${f.showAdvanced ? "Menos opções" : "Excluir termos, escolher campos"}</button>
      </div>
      <div class="author-row"><label for="author">${ic("user", 15)}Autor</label><input class="inp" id="author" value="${esc(f.author)}" placeholder="opcional — Borba, Rute  ou  ORCID 0000-0002-5098-4461"></div>
      <div class="howto" aria-live="polite">
        <div class="howto-h"><b>Como a busca fica</b>${hasTerms(q) ? `<button class="link-btn" id="copyExpr">${ic("copy", 14)}Copiar a expressão</button>` : ""}</div>
        <p class="howto-p" data-clamp="sentence">${plainSentence(q)}</p>
        ${hasTerms(q) ? `<pre class="preview" data-clamp="expr">${exprHtml(q)}</pre>` : ""}
      </div>
      ${
        f.showAdvanced
          ? `<div class="opts adv">
        <div class="opt-row"><span class="lbl">Procurar em</span><div class="seg" id="scope" role="group">${(["title", "tak", "all"] as Scope[])
          .map((s) => `<button data-s="${s}" class="${f.scope === s ? "on" : ""}" aria-pressed="${f.scope === s}">${{ title: "Título", tak: "Título, resumo e palavras-chave", all: "Registro inteiro" }[s]}</button>`)
          .join("")}</div></div>
        <div class="opt-row"><span class="lbl"></span><label class="check"><input type="checkbox" id="local" ${f.localFilter ? "checked" : ""}> Conferir a combinação de termos também aqui, depois da busca (útil em bases sem E/OU, como a BDTD)</label></div>
      </div>`
          : ""
      }
      <div class="go-row">
        <button class="go" id="go" ${S.running || !usable.length ? "disabled" : ""}>${ic("search", 18)}${S.running ? "Buscando…" : `Buscar em ${usable.length} ${usable.length === 1 ? "base" : "bases"}`}</button>
        <button class="ghost" id="import" title="Arquivo RIS ou BibTeX exportado do Google Acadêmico, Portal CAPES, Scopus…">${ic("import")}Importar RIS ou BibTeX</button>
        <input type="file" id="file" accept=".ris,.bib,.txt" multiple hidden>
        <span class="kbd">ou <kbd>⌘</kbd><kbd>Enter</kbd></span>
      </div>
      ${
        S.history.length
          ? `<h2 class="sub-h">Buscas anteriores</h2><ul class="recent-list">${S.history
              .slice(0, 6)
              .map((h) => `<li><button class="recent-card" data-h="${h.id}"><span class="rq">${esc(describeQuery(h.query))}</span><span class="rn">${fmt(h.unique)}</span><time>${new Date(h.date).toLocaleDateString("pt-BR")}</time></button></li>`)
              .join("")}</ul>`
          : ""
      }
    </section>

    <aside class="side">
      <section class="panel" aria-labelledby="hBases"><h2 id="hBases"><i class="num">2</i>Bases</h2>
        ${groups
          .map(
            ([g, regs]) => `<h3 class="src-group">${g}</h3><ul class="src-list">${SOURCES.filter((s) => regs.includes(s.region))
              .map((s) => {
                const on = S.settings.enabledSources.includes(s.id);
                const why = needsList(s.id) ? "Escolha uma lista de revistas para usar" : noJournal(s.id) ? "Não filtra por revista; fica de fora" : BLURB[s.id] ?? "";
                return `<li><button class="src ${on ? "on" : ""} ${on && (needsList(s.id) || noJournal(s.id)) ? "warn" : ""}" data-src="${s.id}" role="switch" aria-checked="${on}" title="${esc(s.description)}">
                  <span class="box" style="${on ? `background:${srcColor(s.name)};border-color:${srcColor(s.name)}` : ""}">${on ? ic("check", 13) : ""}</span><span class="nm">${esc(s.name)}</span><span class="bl">${esc(why)}</span></button></li>`;
              })
              .join("")}</ul>`
          )
          .join("")}
        ${SOURCES.some((s) => S.settings.enabledSources.includes(s.id) && needsList(s.id)) ? `<div class="need-list">${ic("journals", 15)}<span>O SciELO só busca dentro de uma lista de revistas.</span><button class="link-btn" id="pickList">Escolher revistas</button></div>` : ""}
      </section>
      <section class="panel" aria-labelledby="hFilt"><h2 id="hFilt"><i class="num">3</i>Limites</h2>
        <div class="opts">
          <div class="opt-row"><label class="lbl" for="yFrom">Anos</label><input class="inp yr" id="yFrom" type="number" placeholder="desde" value="${esc(f.yearFrom)}"><span class="dash">a</span><input class="inp yr" id="yTo" type="number" placeholder="até" value="${esc(f.yearTo)}" aria-label="Até o ano"></div>
          <div class="opt-row"><label class="lbl" for="list">Revistas</label><select class="inp" id="list"><option value="">Qualquer revista</option>${S.lists
            .map((l) => `<option value="${l.id}" ${f.listId === l.id ? "selected" : ""}>${esc(l.name)} (${l.journals.length})</option>`)
            .join("")}</select><button class="ghost icon" id="editLists" title="Editar listas de revistas">${ic("edit", 15)}<span class="sr">Editar listas</span></button></div>
          <div class="opt-row"><label class="lbl" for="country">País da revista</label><select class="inp" id="country">${COUNTRIES.map(([c, n]) => `<option value="${c}" ${f.country === c ? "selected" : ""}>${n}</option>`).join("")}</select></div>
          ${f.country ? `<p class="opt-hint">Filtra no OpenAlex e no DOAJ. As outras bases ignoram o país. Revistas sem país cadastrado no OpenAlex ficam de fora.</p>` : ""}
          <div class="opt-row"><span class="lbl">Tipos</span><div class="seg" role="radiogroup" aria-label="Tipos de trabalho"><button role="radio" aria-checked="${!f.onlyArticles}" class="${f.onlyArticles ? "" : "on"}" data-art="0">Todos</button><button role="radio" aria-checked="${f.onlyArticles}" class="${f.onlyArticles ? "on" : ""}" data-art="1">Só artigos de revista</button></div></div>
          <p class="opt-hint">${f.onlyArticles ? "Teses, dissertações e artigos de evento ficam de fora (a BDTD continua trazendo teses)." : "Inclui teses, dissertações, artigos de evento e livros. Filtre depois pela etiqueta de tipo."}</p>
        </div>
      </section>
    </aside>
  </div></div>`;
  // termos
  const addTerm = (where: string, raw: string) => {
    const terms = raw.split(/[;\n]+/).map((t) => t.trim().replace(/^"|"$/g, "")).filter(Boolean);
    if (!terms.length) return false;
    const arr = where === "none" ? f.none : f.blocks[Number(where)];
    for (const t of terms) if (!arr.includes(t)) arr.push(t);
    return true;
  };
  $$<HTMLInputElement>("[data-in]").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === ";") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (addTerm(inp.dataset.in!, inp.value)) refocus(inp.dataset.in!);
      } else if (e.key === "Backspace" && !inp.value) {
        const arr = inp.dataset.in === "none" ? f.none : f.blocks[Number(inp.dataset.in)];
        if (arr.length) {
          arr.pop();
          refocus(inp.dataset.in!);
        }
      }
    });
    inp.addEventListener("blur", () => {
      if (inp.value.trim() && addTerm(inp.dataset.in!, inp.value)) renderSearch();
    });
    inp.addEventListener("paste", (e) => {
      const txt = e.clipboardData?.getData("text") ?? "";
      if (/[;\n]/.test(txt)) {
        e.preventDefault();
        addTerm(inp.dataset.in!, txt);
        refocus(inp.dataset.in!);
      }
    });
  });
  $$("[data-rmt]").forEach((b) =>
    b.addEventListener("click", () => {
      const where = b.closest<HTMLElement>(".block")!.dataset.b!;
      (where === "none" ? f.none : f.blocks[Number(where)]).splice(Number(b.dataset.rmt), 1);
      refocus(where);
    })
  );
  $$("[data-rmb]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = Number(b.dataset.rmb);
      f.blocks.splice(k, 1);
      f.ops.splice(Math.max(0, k - 1), 1);
      renderSearch();
    })
  );
  $("#addBlock").addEventListener("click", () => {
    f.blocks.push([]);
    f.ops[f.blocks.length - 2] = "and";
    refocus(String(f.blocks.length - 1));
  });
  $("#advToggle").addEventListener("click", () => ((f.showAdvanced = !f.showAdvanced), renderSearch()));
  $$("[data-op]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.op);
      while (f.ops.length < i) f.ops.push("and");
      f.ops[i - 1] = b.dataset.v as Op;
      renderSearch();
    })
  );
  $("#copyExpr")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(booleanExpr(currentQuery()));
    toast("Expressão copiada.");
  });
  $("#scope")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (b) (f.scope = b.dataset.s as Scope), renderSearch();
  });
  $("#author")?.addEventListener("input", (e) => (f.author = (e.target as HTMLInputElement).value));
  $("#local")?.addEventListener("change", (e) => (f.localFilter = (e.target as HTMLInputElement).checked));
  $("#yFrom").addEventListener("input", (e) => (f.yearFrom = (e.target as HTMLInputElement).value));
  $("#yTo").addEventListener("input", (e) => (f.yearTo = (e.target as HTMLInputElement).value));
  $("#pickList")?.addEventListener("click", () => (S.lists.length ? ($("#list") as HTMLSelectElement).focus() : $("#editLists").click()));
  $("#country")?.addEventListener("change", (e) => ((f.country = (e.target as HTMLSelectElement).value), renderSearch()));
  $("#list").addEventListener("change", (e) => ((f.listId = (e.target as HTMLSelectElement).value), renderSearch()));
  document.querySelectorAll<HTMLElement>("[data-art]").forEach((b) => b.addEventListener("click", () => ((f.onlyArticles = b.dataset.art === "1"), renderSearch())));
  $("#editLists").addEventListener("click", () => openLists(f.listId));
  $$("[data-src]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.src!;
      const set = new Set(S.settings.enabledSources);
      set.has(id) ? set.delete(id) : set.add(id);
      S.settings.enabledSources = SOURCES.map((s) => s.id).filter((x) => set.has(x));
      store.saveSettings(S.settings);
      renderSearch();
    })
  );
  $("#go").addEventListener("click", runSearch);
  $("#import").addEventListener("click", () => $<HTMLInputElement>("#file").click());
  $("#file").addEventListener("change", importFiles);
  $$("[data-h]").forEach((b) => b.addEventListener("click", () => loadHistory(b.dataset.h!)));
}

function refocus(where: string) {
  renderSearch();
  $<HTMLInputElement>(`[data-in="${where}"]`)?.focus();
}

// =============================================================== busca
async function runSearch() {
  // termos digitados mas ainda não confirmados com Enter
  $$<HTMLInputElement>("[data-in]").forEach((inp) => {
    const v = inp.value.trim();
    if (v) (inp.dataset.in === "none" ? S.form.none : S.form.blocks[Number(inp.dataset.in)]).push(v);
  });
  const q = currentQuery();
  const err = validate(q);
  if (err) return toast(err);
  const orcid = orcidOf(q.author);
  if (orcid) {
    try {
      const a = await getJson(`https://api.openalex.org/authors/orcid:${orcid}?select=display_name`);
      const { surname, given } = authorParts(a.display_name);
      const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
      Object.assign(q, { authorOrcid: orcid, authorLabel: a.display_name, author: `${cap(surname)}, ${cap(given)}` });
    } catch {
      return toast(`Não achei o ORCID ${orcid} no OpenAlex. Confira o número ou escreva o nome do autor.`);
    }
  }
  const ids = S.settings.enabledSources.filter((id) => sourceById(id));
  Object.assign(S, { running: true, cancel: false, raw: [], works: [], active: null, lastQuery: q, shown: 60, sort: "relevance" as SortKey });
  S.basket.clear();
  resetFacets();
  S.status = Object.fromEntries(ids.map((id) => [id, { state: "run", done: 0 } as Status]));
  go("results");

  const entry: HistoryEntry = { id: String(Date.now()), date: new Date().toISOString(), query: q, runs: [], unique: 0 };
  let tick = 0;
  const refresh = () => {
    if (tick) return;
    tick = window.setTimeout(() => {
      tick = 0;
      S.works = dedupe(S.raw);
      if (S.view === "results") renderResults();
      renderNav();
    }, 300);
  };

  await Promise.all(
    ids.map(async (id) => {
      const src = sourceById(id)!;
      const st = S.status[id];
      if (src.journalsOnly && !q.issns.length) return void Object.assign(st, { state: "skip", msg: "precisa de lista de revistas" });
      if (!src.supportsJournals && q.issns.length) return void Object.assign(st, { state: "skip", msg: "não filtra por revista" });
      const ctx: SearchContext = {
        get: httpGet,
        getJson,
        progress: (done, total) => {
          st.done = done;
          st.total = total;
          renderNets();
        },
        cancelled: () => S.cancel,
        settings: S.settings,
      };
      try {
        const r = await src.search(q, ctx);
        let ws = r.works.filter((w) => w.year == null || inYearRange(w, q));
        if (q.localFilter && hasTerms(q)) ws = ws.filter((w) => matchesLocally(w, q));
        const fetched = ws.length;
        if (q.author.trim() && !(q.authorOrcid && id === "openalex")) ws = ws.filter((w) => authorMatches(w, q.author));
        const authorNote = q.author.trim() && fetched > ws.length ? `${fmt(fetched - ws.length)} de outros autores com nome parecido foram descartados` : "";
        if (authorNote) r.note = r.note ? `${r.note}; ${authorNote}` : authorNote;
        ws.forEach((w, i) => (w.rank = i));
        S.raw.push(...ws);
        Object.assign(st, { state: r.note && !ws.length && !r.total ? "skip" : "ok", done: ws.length, total: r.total, msg: r.note });
        entry.runs.push({ source: src.name, queryString: r.queryString, retrieved: ws.length, total: r.total, note: r.note });
      } catch (e: any) {
        Object.assign(st, { state: "err", msg: String(e?.message ?? e).slice(0, 180) });
        entry.runs.push({ source: src.name, queryString: "", retrieved: 0, error: st.msg });
      }
      refresh();
    })
  );
  S.works = dedupe(S.raw);
  S.running = false;
  entry.unique = S.works.length;
  S.history.unshift(entry);
  store.saveHistory(S.history);
  render();
  if (S.cancel) toast("Busca interrompida. Os resultados que já chegaram foram mantidos.");
}

function loadHistory(id: string) {
  const h = S.history.find((x) => x.id === id);
  if (!h) return;
  const q = h.query as Query & { allTerms?: string[]; anyTerms?: string[] };
  const blocks = q.blocks ?? [...(q.allTerms ?? []).map((t) => [t]), ...(q.anyTerms?.length ? [q.anyTerms] : [])];
  Object.assign(S.form, {
    blocks: blocks.length ? blocks.map((b) => [...b]) : [[]],
    ops: [],
    none: [...q.noneTerms],
    scope: q.scope,
    author: q.authorOrcid ?? q.author,
    yearFrom: q.yearFrom ? String(q.yearFrom) : "",
    yearTo: q.yearTo ? String(q.yearTo) : "",
    listId: S.lists.find((l) => l.name === q.journalListName)?.id ?? "",
    country: q.sourceCountry ?? "",
    onlyArticles: q.onlyArticles,
    localFilter: q.localFilter,
  });
  go("search");
  toast("Busca reaberta. Ajuste e busque de novo.");
}

async function importFiles(e: Event) {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  let n = 0;
  for (const file of files) {
    const text = await file.text();
    const label = file.name.replace(/\.[^.]+$/, "");
    const ws = /^TY  -/m.test(text) ? parseRIS(text, label) : parseBibTeX(text, label);
    ws.forEach((w, i) => (w.rank = i));
    S.raw.push(...ws);
    n += ws.length;
  }
  S.works = dedupe(S.raw);
  (e.target as HTMLInputElement).value = "";
  toast(`${fmt(n)} registros importados e juntados aos resultados.`);
  go("results");
}

// =============================================================== tela: resultados
function resetFacets() {
  S.f = { text: "", y1: 0, y2: 0, venue: "", source: "", type: "", lang: "", kw: "", author: "", concept: -1, allConcepts: false, onlyOA: false, onlyMulti: false, onlyAbstract: false };
  S.venuesAll = false;
}

/** Tipo do trabalho em português, a partir dos vocabulários (diferentes) de cada base. A ordem das regras importa. */
function typeLabel(w: Work): string {
  const t = (w.type ?? "").toLowerCase();
  if (!t) return w.sources.includes("BDTD") ? "Tese/dissertação" : "";
  if (/doctoral|doutorado|\btese\b|phd/.test(t)) return "Tese";
  if (/master|mestrado|disserta(ç|c)(ã|a)o\b/.test(t)) return "Dissertação";
  if (/dissertation|thesis|theses/.test(t)) return "Tese/dissertação";
  if (/journal articles/.test(t)) return "Artigo de revista"; // ERIC marca artigo + outros rótulos
  if (/proceed|conference|meeting|congress|symposium/.test(t)) return "Artigo de evento";
  if (/preprint|posted-content/.test(t)) return "Preprint";
  if (/chapter/.test(t)) return "Capítulo de livro";
  if (/book/.test(t)) return "Livro";
  if (/article|journal|review|letter|editorial|erratum/.test(t)) return "Artigo de revista";
  if (/report/.test(t)) return "Relatório";
  if (/dataset/.test(t)) return "Dados";
  return "Outro";
}
const langLabel = (l?: string) => (l ? ({ pt: "Português", por: "Português", en: "Inglês", eng: "Inglês", English: "Inglês", es: "Espanhol", spa: "Espanhol", Spanish: "Espanhol", Portuguese: "Português", fr: "Francês" } as Record<string, string>)[l] ?? l : "");

function applyFacets(ws: Work[], skip?: keyof typeof S.f | "year"): Work[] {
  const f = S.f;
  const t = f.text.toLowerCase();
  const kw = f.kw.toLowerCase();
  const nb = S.lastQuery?.blocks.length ?? 0;
  return ws.filter(
    (w) =>
      (skip === "year" || !f.y1 || (w.year != null && w.year >= f.y1 && w.year <= (f.y2 || f.y1))) &&
      (skip === "venue" || !f.venue || w.venue === f.venue) &&
      (skip === "source" || !f.source || w.sources.includes(f.source)) &&
      (skip === "type" || !f.type || typeLabel(w) === f.type) &&
      (skip === "lang" || !f.lang || langLabel(w.lang) === f.lang) &&
      (skip === "kw" || !kw || (w.keywords ?? []).some((k) => k.toLowerCase() === kw)) &&
      (!f.author || w.authors.includes(f.author)) &&
      (skip === "concept" || f.concept < 0 || hitsOf(w).includes(f.concept)) &&
      (!f.allConcepts || hitsOf(w).length === nb) &&
      (!f.onlyOA || w.oaUrl) &&
      (!f.onlyMulti || w.sources.length > 1) &&
      (!f.onlyAbstract || w.abstract) &&
      (!t || `${w.title} ${w.authors.join(" ")} ${w.venue ?? ""} ${(w.keywords ?? []).join(" ")} ${w.abstract ?? ""}`.toLowerCase().includes(t))
  );
}

function sorted(ws: Work[]): Work[] {
  const by: Record<SortKey, (a: Work, b: Work) => number> = {
    relevance: (a, b) => b.sources.length - a.sources.length || (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.citations ?? 0) - (a.citations ?? 0),
    citations: (a, b) => (b.citations ?? -1) - (a.citations ?? -1),
    newest: (a, b) => (b.year ?? 0) - (a.year ?? 0),
    oldest: (a, b) => (a.year ?? 9999) - (b.year ?? 9999),
    title: (a, b) => a.title.localeCompare(b.title, "pt-BR"),
  };
  return [...ws].sort(by[S.sort]);
}

// ---- conceitos: cada linha da busca tem uma cor, usada nos destaques e nas etiquetas
let CQ: { q: Query; re: RegExp; per: RegExp[]; hits: Map<string, number[]> } | null = null;
function concepts() {
  const q = S.lastQuery;
  if (!q || !q.blocks.length) return null;
  if (CQ?.q === q) return CQ;
  const alt = (t: string) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "\\p{L}*");
  CQ = {
    q,
    re: new RegExp(q.blocks.map((b) => `(${b.map(alt).join("|")})`).join("|"), "giu"),
    per: q.blocks.map((b) => new RegExp(b.map(alt).join("|"), "iu")),
    hits: new Map(),
  };
  return CQ;
}
function hitsOf(w: Work): number[] {
  const c = concepts();
  if (!c) return [];
  let h = c.hits.get(w.key);
  if (!h) {
    const txt = `${w.title} ${w.abstract ?? ""} ${(w.keywords ?? []).join(" ")}`;
    h = c.per.map((r, i) => (r.test(txt) ? i : -1)).filter((i) => i >= 0);
    c.hits.set(w.key, h);
  }
  return h;
}
function hl(text: string): string {
  const e = esc(text);
  const c = concepts();
  if (!c) return e;
  return e.replace(c.re, (m: string, ...g: unknown[]) => {
    const i = g.slice(0, c.per.length).findIndex((x) => x !== undefined);
    return `<mark class="c${i % 5}">${m}</mark>`;
  });
}
function snippet(w: Work): string {
  const a = w.abstract ?? "";
  if (!a) return "";
  const c = concepts();
  const m = c ? a.search(c.re) : -1;
  const start = m > 80 ? a.lastIndexOf(" ", m - 60) + 1 : 0;
  return (start ? "… " : "") + hl(a.slice(start, start + 320));
}
function conceptName(i: number): string {
  const b = S.lastQuery?.blocks[i] ?? [];
  const t = b[0] ?? `Conceito ${i + 1}`;
  return t.length > 24 ? t.slice(0, 22) + "…" : t;
}
const tag = (k: string, v: string, label: string, color: string, cls = "") =>
  `<button class="tag ${cls}" style="${tagStyle(color)}" data-tk="${k}" data-tv="${esc(v)}" title="Filtrar por ${esc(label)}">${esc(label)}</button>`;
function conceptTags(w: Work): string {
  const n = S.lastQuery?.blocks.length ?? 0;
  if (n < 2) return "";
  const h = hitsOf(w);
  return `<span class="ctags">${Array.from({ length: n }, (_, i) => !h.includes(i) ? "" :
    `<button class="ctag c${i % 5} ${h.includes(i) ? "" : "miss"}" data-tk="concept" data-tv="${i}" title="${h.includes(i) ? "Tem" : "Não tem no título, resumo ou palavras-chave"}: ${esc((S.lastQuery?.blocks[i] ?? []).join(" ou "))}">${esc(conceptName(i))}</button>`
  ).join("")}</span>`;
}

function renderNets() {
  const el = $("#nets");
  if (!el) return;
  el.innerHTML = Object.entries(S.status)
    .map(([id, st]) => {
      const name = sourceById(id)?.name ?? id;
      const pct = st.total ? Math.min(100, (st.done / Math.min(st.total, S.settings.maxPerSource)) * 100) : st.state === "run" ? 8 : 100;
      const txt =
        st.state === "run" ? `${fmt(st.done)}${st.total != null ? ` / ${fmt(Math.min(st.total, S.settings.maxPerSource))}` : "…"}` :
        st.state === "ok" ? `${fmt(st.done)}${st.total != null && st.total > st.done ? ` de ${fmt(st.total)}` : ""}` :
        st.state === "err" ? "falhou" : "não usada";
      return `<span class="net ${st.state}" title="${esc(st.msg ?? "")}"><span class="dot"></span><b>${esc(name)}</b> ${txt}${st.state === "run" ? `<span class="bar" style="width:${pct}%"></span>` : ""}</span>`;
    })
    .join("");
}

function facetList(key: "venue" | "source" | "type" | "lang" | "kw", label: string, data: [string, number][], limit = 6, color?: (v: string) => string): string {
  if (!data.length) return "";
  const all = key === "venue" && S.venuesAll;
  const items = all ? data : data.slice(0, limit);
  return `<div class="facet"><h4>${label}${S.f[key] ? `<button data-clr="${key}">Limpar</button>` : ""}</h4>
    ${items.map(([k, n]) => `<button class="fitem ${S.f[key] === k ? "on" : ""}" data-tk="${key}" data-tv="${esc(k)}" title="${esc(k)}">${color ? `<i class="dot" style="background:${color(k)}"></i>` : ""}<span>${esc(k)}</span><span class="n">${fmt(n)}</span></button>`).join("")}
    ${key === "venue" && data.length > limit ? `<button class="link-btn" id="venMore">${all ? "Ver menos" : `Ver todas (${data.length})`}</button>` : ""}</div>`;
}

function conceptFacet(): string {
  const q = S.lastQuery;
  if (!q || q.blocks.length < 2) return "";
  const base = applyFacets(S.works, "concept");
  const nb = q.blocks.length;
  return `<div class="facet"><h4>Conceitos${S.f.concept >= 0 ? `<button data-clr="concept">Limpar</button>` : ""}</h4>
    ${q.blocks.map((b, i) => `<button class="fitem ${S.f.concept === i ? "on" : ""}" data-tk="concept" data-tv="${i}" title="${esc(b.join(" ou "))}"><i class="dot c${i % 5}"></i><span>${esc(conceptName(i))}</span><span class="n">${fmt(base.filter((w) => hitsOf(w).includes(i)).length)}</span></button>`).join("")}
    <label class="toggle"><input type="checkbox" id="fAll" ${S.f.allConcepts ? "checked" : ""}> Todos os ${nb} conceitos <span class="n">${fmt(base.filter((w) => hitsOf(w).length === nb).length)}</span></label></div>`;
}

function kwCloud(): string {
  const data = countBy(applyFacets(S.works, "kw"), (w) => (w.keywords ?? []).map((k) => k.toLowerCase())).slice(0, 18);
  if (data.length < 3) return "";
  return `<div class="facet"><h4>Palavras-chave${S.f.kw ? `<button data-clr="kw">Limpar</button>` : ""}</h4><div class="cloud">${data
    .map(([k, n]) => tag("kw", k, k, kwColor(k), S.f.kw.toLowerCase() === k ? "on" : "") .replace("</button>", `<small>${n}</small></button>`))
    .join("")}</div></div>`;
}

function renderResults() {
  queueMicrotask(setupClamps);
  const view = $("#view");
  if (!S.works.length && !S.running) {
    const tried = Object.keys(S.status).length;
    view.innerHTML = `<div class="empty"><h1>${tried ? "Nenhum trabalho encontrado" : "Nenhuma busca feita"}</h1>
      <p>${tried ? "Veja abaixo o que cada base respondeu. Tente menos conceitos, mais sinônimos ou um período maior." : "Os resultados de todas as bases aparecem aqui, já sem duplicatas."}</p>
      ${tried ? `<div class="nets" id="nets"></div>` : ""}
      <button class="go" id="toSearch">${tried ? "Ajustar a busca" : "Fazer uma busca"}</button></div>`;
    $("#toSearch").addEventListener("click", () => go("search"));
    renderNets();
    return;
  }
  const ws = sorted(applyFacets(S.works));
  const f = S.f;
  const years = countBy(applyFacets(S.works, "year"), (w) => w.year).sort((a, b) => Number(a[0]) - Number(b[0]));
  const yMin = years.length ? Number(years[0][0]) : 0;
  const yMax = years.length ? Number(years[years.length - 1][0]) : 0;
  const ym = new Map(years);
  const yTop = Math.max(1, ...years.map((y) => y[1]));
  const histo: string[] = [];
  for (let y = yMin; y <= yMax && years.length; y++) {
    const n = ym.get(String(y)) ?? 0;
    const on = f.y1 && y >= f.y1 && y <= (f.y2 || f.y1);
    histo.push(`<button data-y="${y}" class="${on ? "on" : ""}" style="height:${n ? Math.max(6, (n / yTop) * 100) : 2}%" title="${y}: ${n} ${n === 1 ? "trabalho" : "trabalhos"}" aria-label="${y}, ${n}"></button>`);
  }
  const q = S.lastQuery;
  const chips: [string, string][] = [
    ["year", f.y1 ? (f.y2 && f.y2 !== f.y1 ? `${f.y1}–${f.y2}` : `${f.y1}`) : ""],
    ["concept", f.concept >= 0 ? `Com ${conceptName(f.concept)}` : ""],
    ["source", f.source],
    ["type", f.type],
    ["lang", f.lang],
    ["venue", f.venue],
    ["author", f.author],
    ["kw", f.kw],
    ["text", f.text && `“${f.text}”`],
  ].filter((c) => c[1]) as [string, string][];

  view.innerHTML = `
  <div class="results ${S.active ? "reading" : ""}">
    <aside class="facets" aria-label="Filtros dos resultados">
      ${years.length ? `<div class="facet"><h4>Ano${f.y1 ? `<button data-clr="year">Limpar</button>` : ""}</h4><div class="histo" id="histo" title="Clique num ano ou arraste para escolher um intervalo">${histo.join("")}</div><div class="histo-axis"><span>${yMin}</span><span class="sel">${f.y1 ? (f.y2 && f.y2 !== f.y1 ? `${f.y1}–${f.y2}` : f.y1) : "arraste para escolher"}</span><span>${yMax}</span></div></div>` : ""}
      ${conceptFacet()}
      <div class="facet"><h4>Só os que têm</h4>
        <label class="toggle"><input type="checkbox" id="fAbs" ${f.onlyAbstract ? "checked" : ""}> Resumo</label>
        <label class="toggle"><input type="checkbox" id="fOA" ${f.onlyOA ? "checked" : ""}> Acesso aberto</label>
        <label class="toggle"><input type="checkbox" id="fMulti" ${f.onlyMulti ? "checked" : ""}> Mais de uma base</label>
      </div>
      ${facetList("source", "Bases", countBy(applyFacets(S.works, "source"), (w) => w.sources), 10, srcColor)}
      ${facetList("type", "Tipo", countBy(applyFacets(S.works, "type"), (w) => typeLabel(w) || undefined), 6, typeColor)}
      ${facetList("venue", "Revistas", countBy(applyFacets(S.works, "venue"), (w) => w.venue), 8)}
      ${facetList("lang", "Idioma", countBy(applyFacets(S.works, "lang"), (w) => langLabel(w.lang) || undefined), 6, langColor)}
      ${kwCloud()}
    </aside>

    <section class="list" id="list" aria-label="Resultados">
      <div class="list-head">
        <div class="qsum">
          <p class="qline" data-clamp="qline">${q ? q.blocks.map((b, i) => `<span class="blk c${i % 5}">${b.map((t) => `<span class="tm">${esc(t)}</span>`).join(`<span class="or">ou</span>`)}</span>`).join(`<span class="op">e</span>`) : "Registros importados"}${
            q?.noneTerms.length ? `<span class="op not">mas não</span><span class="blk none">${q.noneTerms.map((t) => `<span class="tm">${esc(t)}</span>`).join(`<span class="or">nem</span>`)}</span>` : ""
          }</p>
          <p class="qlim">${[q?.journalListName && `nas revistas da lista ${esc(q.journalListName)}`, q && (q.yearFrom || q.yearTo) && (q.yearFrom && q.yearTo ? `de ${q.yearFrom} a ${q.yearTo}` : q.yearFrom ? `desde ${q.yearFrom}` : `até ${q.yearTo}`), q?.author && `autor ${esc(q.authorLabel ? `${q.authorLabel} (ORCID ${q.authorOrcid})` : q.author)}`, q?.sourceCountry && `país da revista: ${esc(COUNTRIES.find(([c]) => c === q.sourceCountry)?.[1] ?? q.sourceCountry)}`].filter(Boolean).join(", ")}</p>
          <div class="qact"><button class="ghost" id="edit">${ic("edit", 15)}Editar busca</button>${S.running ? `<button class="ghost" id="stop">${ic("stop", 15)}Parar</button>` : ""}</div>
        </div>
        <div class="nets" id="nets"></div>
        <div class="tools">
          <span class="count" title="${fmt(S.raw.length)} registros recebidos antes de juntar duplicatas"><b>${fmt(ws.length)}</b> ${ws.length === S.works.length ? (ws.length === 1 ? "trabalho" : "trabalhos") : `de ${fmt(S.works.length)}`}</span>
          ${chips.map(([k, l]) => `<span class="chipf">${esc(l)}<button data-clr="${k}" aria-label="Remover filtro">${ic("x", 13)}</button></span>`).join("")}
          <span class="spacer"></span>
          <label class="search-in">${ic("search", 15)}<input id="ftext" placeholder="Filtrar estes resultados" value="${esc(f.text)}" aria-label="Filtrar estes resultados"><kbd>/</kbd></label>
          <select class="inp" id="sort" style="width:auto">${(
            [["relevance", "Relevância"], ["citations", "Mais citados"], ["newest", "Mais recentes"], ["oldest", "Mais antigos"], ["title", "Título A–Z"]] as [SortKey, string][]
          )
            .map(([k, l]) => `<option value="${k}" ${S.sort === k ? "selected" : ""}>${l}</option>`)
            .join("")}</select>
          <div class="seg" id="layout" role="group" aria-label="Visualização"><button data-l="cards" class="${S.layout === "cards" ? "on" : ""}" aria-pressed="${S.layout === "cards"}" title="Lista com resumo">${ic("rows", 15)}<span class="sr">Lista</span></button><button data-l="table" class="${S.layout === "table" ? "on" : ""}" aria-pressed="${S.layout === "table"}" title="Tabela compacta">${ic("table", 15)}<span class="sr">Tabela</span></button></div>
        </div>
      </div>
      ${
        !ws.length && S.running
          ? `<div class="loading"><p>Buscando nas bases. Os trabalhos aparecem aqui à medida que chegam.</p></div>`
          : !ws.length
          ? `<div class="loading"><p>Nenhum trabalho passa por esses filtros.</p><button class="ghost" id="clearAll">Limpar os filtros</button></div>`
          : S.layout === "cards"
          ? `<div class="cards">${ws.slice(0, S.shown).map(cardHtml).join("")}</div>`
          : tableHtml(ws.slice(0, S.shown))
      }
      ${ws.length > S.shown ? `<button class="ghost more" id="more">Mostrar mais ${fmt(Math.min(100, ws.length - S.shown))} (faltam ${fmt(ws.length - S.shown)})</button>` : ""}
    </section>

    <aside class="reader" id="reader" aria-label="Leitura">${S.active ? readerHtml(S.works.find((w) => w.key === S.active)) : ""}</aside>
  </div>`;
  renderNets();
  bindResults(ws);
}

function cardHtml(w: Work): string {
  const au = w.authors.slice(0, 4).map((x) => `<button class="au" data-tk="author" data-tv="${esc(x)}" title="Só trabalhos de ${esc(x)}">${esc(x)}</button>`).join("; ");
  const tl = typeLabel(w);
  const lg = langLabel(w.lang);
  return `<article class="card ${S.basket.has(w.key) ? "in" : ""} ${S.active === w.key ? "active" : ""}" data-key="${esc(w.key)}" tabindex="0">
    <input type="checkbox" class="pick" data-pick="${esc(w.key)}" ${S.basket.has(w.key) ? "checked" : ""} aria-label="Marcar este trabalho" title="Marcar (barra de espaço)">
    <div class="body">
      <h3>${hl(w.title)}</h3>
      <p class="by">${au || "Autoria não informada"}${w.authors.length > 4 ? " et al." : ""}${w.venue || w.year ? ` <span class="sep">·</span> ` : ""}${w.venue ? `<button class="vn" data-tk="venue" data-tv="${esc(w.venue)}" title="Só desta revista"><cite>${esc(w.venue)}</cite></button>` : ""}${w.venue && w.year ? ", " : ""}${w.year ?? ""}</p>
      ${snippet(w) ? `<p class="snip">${snippet(w)}</p>` : ""}
      <div class="tags">${conceptTags(w)}${w.sources.map((x) => tag("source", x, x, srcColor(x))).join("")}${tl ? tag("type", tl, tl, typeColor(tl)) : ""}${lg ? tag("lang", lg, lg, langColor(lg)) : ""}${w.oaUrl ? `<span class="tag oa" style="${tagStyle("#2b8a3e")}">${ic("oa", 12)}Acesso aberto</span>` : ""}</div>
    </div>
    <div class="side-col">
      <div class="cites">${w.citations != null ? `${fmt(w.citations)}<small>citações</small>` : ""}</div>
      <div class="qa" aria-label="Ações rápidas">
        <button data-qa="pick" title="${S.basket.has(w.key) ? "Desmarcar" : "Marcar"}">${ic("basket", 15)}</button>
        <button data-qa="copy" title="Copiar referência ABNT">${ic("copy", 15)}</button>
        ${w.oaUrl || w.doi || w.url ? `<a href="${esc(w.oaUrl || (w.doi ? `https://doi.org/${w.doi}` : w.url!))}" target="_blank" rel="noopener" title="Abrir">${ic("arrow", 15)}</a>` : ""}
      </div>
    </div>
  </article>`;
}

function tableHtml(ws: Work[]): string {
  return `<div style="padding:10px 18px 90px"><table class="grid"><colgroup><col style="width:30px"><col style="width:58px"><col style="width:18%"><col><col style="width:52px"><col style="width:17%"><col style="width:12%"></colgroup>
    <thead><tr><th></th><th>Cit.</th><th>Autores</th><th>Título</th><th>Ano</th><th>Fonte</th><th>Bases</th></tr></thead><tbody>
    ${ws
      .map(
        (w) => `<tr data-key="${esc(w.key)}" class="${S.basket.has(w.key) ? "in" : ""} ${S.active === w.key ? "active" : ""}">
      <td><input type="checkbox" data-pick="${esc(w.key)}" ${S.basket.has(w.key) ? "checked" : ""}></td><td>${w.citations ?? "—"}</td>
      <td title="${esc(w.authors.join("; "))}">${esc(w.authors.slice(0, 2).join("; "))}${w.authors.length > 2 ? " et al." : ""}</td>
      <td>${hl(w.title)}</td><td>${w.year ?? "—"}</td><td title="${esc(w.venue ?? "")}">${esc(w.venue ?? "—")}</td><td>${esc(w.sources.join(", "))}</td></tr>`
      )
      .join("")}</tbody></table></div>`;
}

function readerHtml(w?: Work): string {
  if (!w) return "";
  const scholar = `https://scholar.google.com/scholar?q=${encodeURIComponent(`"${w.title}"`)}`;
  const inB = S.basket.has(w.key);
  const facts: [string, string][] = [
    ["Fonte", [w.venue, w.year].filter(Boolean).join(", ")],
    ["Tipo", [typeLabel(w), langLabel(w.lang).toLowerCase()].filter(Boolean).join(" em ")],
    ["Citações", w.citations != null ? fmt(w.citations) : "Não informadas pelas bases"],
    
  ];
  return `<div class="reader-inner">
    <button class="close" id="rClose" title="Fechar (Esc)">${ic("x", 18)}<span class="sr">Fechar</span></button>
    <h2>${hl(w.title)}</h2>
    <p class="who">${esc(w.authors.join("; ") || "Autoria não informada")}</p>
    <div class="tags">${conceptTags(w)}${w.sources.map((x) => tag("source", x, x, srcColor(x))).join("")}</div>
    <dl class="facts">${facts.filter((f) => f[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <div class="actions">
      <button class="${inB ? "on" : ""}" id="rPick">${ic("basket", 15)}${inB ? "Marcado" : "Marcar"}</button>
      ${w.oaUrl ? `<a class="primary-a" href="${esc(w.oaUrl)}" target="_blank" rel="noopener">${ic("oa", 15)}Texto completo</a>` : ""}
      ${w.doi ? `<a href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">DOI${ic("arrow", 14)}</a>` : ""}
      ${w.url && !w.url.includes("doi.org") ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">Registro${ic("arrow", 14)}</a>` : ""}
      <a href="${scholar}" target="_blank" rel="noopener">Google Acadêmico${ic("arrow", 14)}</a>
    </div>
    <h3 class="sec">Resumo</h3>
    <div class="abs">${w.abstract ? hl(w.abstract) : `<p class="hint">Esta base não fornece o resumo. Abra o registro para lê-lo.</p>`}</div>
    ${w.keywords?.length ? `<h3 class="sec">Palavras-chave <span class="hint">clique para filtrar</span></h3><div class="kw">${w.keywords.map((k) => tag("kw", k, k, kwColor(k))).join("")}</div>` : ""}
    <h3 class="sec">Referência ABNT <span class="hint">confira antes de usar</span></h3>
    <p class="ref" id="rRef">${esc(toABNT(w))}</p>
    <button class="ghost" id="rCopy">${ic("copy", 15)}Copiar referência</button>
  </div>`;
}

function setActive(key: string | null) {
  S.active = key;
  const res = $(".results");
  if (!res) return;
  res.classList.toggle("reading", !!key);
  $$(".card.active, tr.active").forEach((el) => el.classList.remove("active"));
  if (key) document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.classList.add("active");
  $("#reader").innerHTML = key ? readerHtml(S.works.find((w) => w.key === key)) : "";
  bindReader();
}

function togglePick(key: string) {
  S.basket.has(key) ? S.basket.delete(key) : S.basket.add(key);
  const on = S.basket.has(key);
  document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.classList.toggle("in", on);
  const cb = document.querySelector<HTMLInputElement>(`[data-pick="${CSS.escape(key)}"]`);
  if (cb) cb.checked = on;
  if (S.active === key) setActive(key);
  renderBasket();
}

function bindReader() {
  $("#rClose")?.addEventListener("click", () => setActive(null));
  $("#rPick")?.addEventListener("click", () => S.active && togglePick(S.active));
  $("#rCopy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#rRef").textContent ?? "");
      toast("Referência copiada.");
    } catch {
      toast("Não foi possível copiar; selecione o texto manualmente.");
    }
  });
}

// filtro por etiqueta, autor, revista, palavra-chave… em qualquer tela (delegado)
function applyTag(k: string, v: string) {
  const f = S.f as any;
  if (k === "concept") f.concept = f.concept === Number(v) ? -1 : Number(v);
  else if (k === "kw") f.kw = f.kw.toLowerCase() === v.toLowerCase() ? "" : v;
  else f[k] = f[k] === v ? "" : v;
  S.shown = 60;
  if (S.view !== "results") go("results");
  else renderResults();
}
function clearFilter(k: string) {
  const f = S.f as any;
  if (k === "year") (f.y1 = 0), (f.y2 = 0);
  else if (k === "concept") f.concept = -1;
  else f[k] = "";
  renderResults();
}
document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;
  const tg = t.closest<HTMLElement>("[data-tk]");
  if (tg && tg.closest("#view")) return applyTag(tg.dataset.tk!, tg.dataset.tv!);
  const clr = t.closest<HTMLElement>("[data-clr]");
  if (clr && clr.closest("#view")) return clearFilter(clr.dataset.clr!);
  const qa = t.closest<HTMLElement>("[data-qa]");
  if (qa) {
    const key = qa.closest<HTMLElement>("[data-key]")?.dataset.key;
    const w = S.works.find((x) => x.key === key);
    if (!w) return;
    if (qa.dataset.qa === "pick") togglePick(w.key);
    if (qa.dataset.qa === "copy") {
      try {
        await navigator.clipboard.writeText(toABNT(w));
        toast("Referência ABNT copiada.");
      } catch {
        toast("Não foi possível copiar.");
      }
    }
  }
});

function bindHisto() {
  const h = $("#histo");
  if (!h) return;
  let a = 0, b = 0, down = false;
  const paint = () =>
    h.querySelectorAll<HTMLElement>("[data-y]").forEach((el) => {
      const y = Number(el.dataset.y);
      el.classList.toggle("on", y >= Math.min(a, b) && y <= Math.max(a, b));
    });
  h.addEventListener("pointerdown", (e) => {
    const y = Number((e.target as HTMLElement).closest<HTMLElement>("[data-y]")?.dataset.y);
    if (!y) return;
    e.preventDefault();
    down = true;
    a = b = y;
    paint();
  });
  h.addEventListener("pointerover", (e) => {
    if (!down) return;
    const y = Number((e.target as HTMLElement).closest<HTMLElement>("[data-y]")?.dataset.y);
    if (y) (b = y), paint();
  });
  window.addEventListener(
    "pointerup",
    () => {
      if (!down) return;
      down = false;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (S.f.y1 === lo && (S.f.y2 || S.f.y1) === hi) (S.f.y1 = 0), (S.f.y2 = 0);
      else (S.f.y1 = lo), (S.f.y2 = hi);
      S.shown = 60;
      renderResults();
    },
    { once: false }
  );
}

function bindResults(ws: Work[]) {
  $("#edit").addEventListener("click", () => go("search"));
  $("#stop")?.addEventListener("click", () => (S.cancel = true));
  $("#clearAll")?.addEventListener("click", () => (resetFacets(), renderResults()));
  $("#fAll")?.addEventListener("change", (e) => ((S.f.allConcepts = (e.target as HTMLInputElement).checked), renderResults()));
  bindHisto();
  $("#venMore")?.addEventListener("click", () => ((S.venuesAll = !S.venuesAll), renderResults()));
  const bindT = (id: string, k: "onlyOA" | "onlyAbstract" | "onlyMulti") =>
    $(id).addEventListener("change", (e) => ((S.f[k] = (e.target as HTMLInputElement).checked), renderResults()));
  bindT("#fOA", "onlyOA");
  bindT("#fAbs", "onlyAbstract");
  bindT("#fMulti", "onlyMulti");
  let deb = 0;
  const ft = $<HTMLInputElement>("#ftext");
  ft.addEventListener("input", () => {
    clearTimeout(deb);
    deb = window.setTimeout(() => {
      S.f.text = ft.value;
      renderResults();
      const n = $<HTMLInputElement>("#ftext");
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    }, 280);
  });
  $("#sort").addEventListener("change", (e) => ((S.sort = (e.target as HTMLSelectElement).value as SortKey), renderResults()));
  $$("#layout button").forEach((b) => b.addEventListener("click", () => ((S.layout = b.dataset.l as any), renderResults())));
  $("#more")?.addEventListener("click", () => ((S.shown += 100), renderResults()));
  const more = $("#more");
  if (more && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        const top = $("#list")?.scrollTop ?? 0;
        S.shown += 100;
        renderResults();
        const l = $("#list");
        if (l) l.scrollTop = top;
      }
    }, { root: $("#list"), rootMargin: "400px" });
    io.observe(more);
  }
  $$<HTMLElement>("[data-key]").forEach((el) =>
    el.addEventListener("click", (e) => {
      const key = el.dataset.key!;
      const t = e.target as HTMLElement;
      if (t.matches("[data-pick]")) return togglePick(key);
      if (t.closest("a, [data-tk], [data-qa]")) return;
      setActive(S.active === key ? null : key);
    })
  );
  bindReader();
  void ws;
}

// navegação por teclado na lista
document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).matches("input, textarea, select");
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !S.running) {
    e.preventDefault();
    if (S.view !== "search") go("search");
    runSearch();
    return;
  }
  if (e.key === "Escape") {
    if (document.querySelector(".modal-bg")) return document.querySelector(".modal-bg")!.remove();
    if (S.active) return setActive(null);
  }
  if (typing || S.view !== "results") return;
  const keys = $$<HTMLElement>("[data-key]").map((el) => el.dataset.key!);
  const i = S.active ? keys.indexOf(S.active) : -1;
  if (e.key === "/") {
    e.preventDefault();
    $("#ftext")?.focus();
  } else if (e.key === "j" || e.key === "ArrowDown") {
    e.preventDefault();
    const k = keys[Math.min(keys.length - 1, i + 1)];
    if (k) setActive(k), document.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "k" || e.key === "ArrowUp") {
    e.preventDefault();
    const k = keys[Math.max(0, i - 1)];
    if (k) setActive(k), document.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === " " && S.active) {
    e.preventDefault();
    togglePick(S.active);
  }
});

// =============================================================== cesta
function exportList(kind: "csv" | "ris" | "bib" | "tri", list: Work[]) {
  const stamp = new Date().toISOString().slice(0, 10);
  const content = kind === "csv" ? toCSV(list) : kind === "tri" ? toTriage(list) : kind === "ris" ? toRIS(list) : toBibTeX(list);
  const ext = kind === "tri" ? "csv" : kind;
  saveFile(kind === "tri" ? `tarrafa-triagem-${stamp}.csv` : `tarrafa-${stamp}.${ext}`, content, ext).then((ok) => ok && toast(`${fmt(list.length)} registros exportados.`));
}

function exportMenu(id: string, down = false): string {
  return `<div class="menu" id="${id}"><button class="main">${ic("download", 15)}<span class="lbl">Exportar</span>${ic("down", 14)}</button><div class="pop ${down ? "down" : ""}">
    <button data-exp="ris"><b>RIS</b><small>Zotero, Mendeley, Rayyan, EndNote</small></button>
    <button data-exp="bib"><b>BibTeX</b><small>LaTeX, JabRef</small></button>
    <button data-exp="csv"><b>CSV</b><small>Planilhas, R, Python, Redes</small></button>
    <button data-exp="tri"><b>Planilha de triagem</b><small>CSV com colunas para decidir incluir ou excluir</small></button></div></div>`;
}

function bindExportMenu(id: string, getList: () => Work[]) {
  const m = $(`#${id}`);
  if (!m) return;
  m.querySelector("button.main")!.addEventListener("click", (e) => {
    e.stopPropagation();
    m.classList.toggle("open");
  });
  m.querySelectorAll<HTMLElement>("[data-exp]").forEach((b) =>
    b.addEventListener("click", () => {
      m.classList.remove("open");
      exportList(b.dataset.exp as any, getList());
    })
  );
}
document.addEventListener("click", () => $$(".menu.open").forEach((m) => m.classList.remove("open")));

function renderBasket() {
  const slot = $("#basketSlot");
  const filtered = S.view === "results" ? applyFacets(S.works) : S.works;
  if (!S.works.length || (S.view !== "results" && !S.basket.size)) return void (slot.innerHTML = "");
  const n = S.basket.size;
  slot.innerHTML = `<div class="basket ${n ? "has" : ""} ${S.view === "results" ? "" : "wide"}" role="region" aria-label="Trabalhos marcados">
    ${n ? `<span class="bk-n">${ic("basket", 16)}<b>${fmt(n)}</b> ${n === 1 ? "marcado" : "marcados"}</span>` : ""}
    <span class="spacer"></span>
    ${n ? `<button class="ghost" id="bkClear">Desmarcar todos</button>` : ""}
    ${exportMenu("bkExp")}
  </div>`;
  $("#bkExp .lbl").textContent = n ? `Exportar ${fmt(n)} ${n === 1 ? "marcado" : "marcados"}` : `Exportar ${fmt(filtered.length)} ${filtered.length === 1 ? "trabalho" : "trabalhos"}`;
  if (!n) $("#bkExp").title = "Para exportar só alguns, marque-os com a caixa ou a barra de espaço";
  bindExportMenu("bkExp", () => (S.basket.size ? S.works.filter((w) => S.basket.has(w.key)) : applyFacets(S.works)));
  $("#bkClear")?.addEventListener("click", () => {
    S.basket.clear();
    render();
  });
}

// =============================================================== tela: métricas
function bars(data: [string, number][], n = 10, k?: string, color?: (v: string) => string): string {
  if (!data.length) return `<div class="hint">sem dados</div>`;
  const top = data[0][1];
  return `<div class="bars">${data
    .slice(0, n)
    .map(([key, v]) => `<${k ? `button data-tk="${k}" data-tv="${esc(key)}"` : "div"} class="row" title="${k ? "Ver estes trabalhos: " : ""}${esc(key)}"><span class="t"><i style="width:${(v / top) * 100}%;${color ? `background:${color(key)}` : ""}"></i><em>${esc(key)}</em></span><span class="n">${fmt(v)}</span></${k ? "button" : "div"}>`)
    .join("")}</div>`;
}

function yearChart(ws: Work[]): string {
  const ys = countBy(ws, (w) => w.year).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!ys.length) return `<div class="hint">sem dados</div>`;
  const min = Number(ys[0][0]), max = Number(ys[ys.length - 1][0]);
  const m = new Map(ys);
  const arr: [number, number][] = [];
  for (let y = min; y <= max; y++) arr.push([y, m.get(String(y)) ?? 0]);
  const W = 600, H = 170, top = Math.max(...arr.map((a) => a[1])), bw = (W - 20) / arr.length, step = Math.ceil(arr.length / 12);
  return `<svg viewBox="0 0 ${W} ${H + 20}" role="img" aria-label="Trabalhos por ano">${arr
    .map(([y, n], i) => {
      const h = (n / top) * H;
      return `<rect x="${10 + i * bw + 1}" y="${H - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" fill="#2a7f9e"><title>${y}: ${n}</title></rect>${i % step === 0 ? `<text x="${10 + i * bw + bw / 2}" y="${H + 14}" font-size="10" text-anchor="middle" fill="#6a7e8a">${y}</text>` : ""}`;
    })
    .join("")}</svg>`;
}

function renderMetrics() {
  const ws = applyFacets(S.works);
  if (!ws.length) {
    $("#view").innerHTML = `<div class="page"><div class="page-inner"><p class="eyebrow">Indicadores</p><h1 class="boxed">Métricas <span>do conjunto</span></h1><p class="sub">As métricas são calculadas sobre os resultados da busca. Faça uma busca primeiro.</p></div></div>`;
    return;
  }
  const m = computeMetrics(ws);
  const exclusive = new Map(countBy(S.works.filter((w) => w.sources.length === 1), (w) => w.sources));
  const filtered = ws.length !== S.works.length;
  const hasCites = ws.some((w) => w.citations != null);
  const rows: [string, string, string][] = [
    ["Trabalhos", fmt(m.papers), filtered ? "com os filtros da tela de resultados" : ""],
    ...(hasCites
      ? ([
          ["Citações", fmt(m.citations), "o maior valor entre as bases que informam"],
          ["Citações por ano", fmt(m.citesPerYear, 1), `em ${m.years} anos`],
          ["Citações por trabalho", fmt(m.citesPerPaper, 1), ""],
          ["Índice h", String(m.h), `${m.h} trabalhos têm ao menos ${m.h} citações`],
          ["Índice g", String(m.g), "os g mais citados somam ao menos g² citações"],
          ["hI,norm", String(m.hNorm), "índice h com as citações divididas pelo número de autores"],
        ] as [string, string, string][])
      : []),
    ["Autores por trabalho", fmt(m.authorsPerPaper, 1), ""],
    ["Com resumo", `${fmt((m.withAbstract / ws.length) * 100)}%`, ""],
    ["Em acesso aberto", `${fmt((m.openAccess / ws.length) * 100)}%`, ""],
    ["Anos cobertos", String(m.years), ""],
  ];
  $("#view").innerHTML = `<div class="page"><div class="page-inner">
    <h1 class="boxed">Métricas</h1>
    ${hasCites ? "" : `<p class="note-inline">ERIC, SciELO, BDTD e DOAJ não informam citações. Para ter índice h, índice g e citações por ano, inclua OpenAlex, Crossref ou Semantic Scholar na busca.</p>`}
    <div class="kpis">${rows.map(([k, v, n]) => `<div class="kpi"><b>${v}</b><span>${k}</span>${n ? `<small>${n}</small>` : ""}</div>`).join("")}</div>
    <div class="charts">
      <div class="chart"><h3>Produção por ano</h3>${yearChart(ws)}</div>
      <div class="chart"><h3>Bases <span class="hint">total e só nesta base</span></h3>
        <div class="bars">${countBy(S.works, (w) => w.sources)
          .map(([k, v], _, all) => `<button data-tk="source" data-tv="${esc(k)}" class="row" style="grid-template-columns:minmax(0,1fr) 90px"><span class="t"><i style="width:${(v / all[0][1]) * 100}%;background:${srcColor(k)}"></i><em>${esc(k)}</em></span><span class="n">${fmt(v)} <small>(${fmt(exclusive.get(k) ?? 0)})</small></span></button>`)
          .join("")}</div>
        <p class="hint" style="font-size:12px;margin:8px 0 0">${fmt(S.raw.length)} registros recebidos, ${fmt(S.works.length)} depois de juntar duplicatas.</p></div>
      <div class="chart"><h3>Revistas mais frequentes</h3>${bars(countBy(ws, (w) => w.venue), 10, "venue")}</div>
      <div class="chart"><h3>Autores mais frequentes</h3>${bars(countBy(ws, (w) => w.authors), 10, "author")}</div>
      <div class="chart"><h3>Mais citados</h3><div class="bars">${[...ws]
        .sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0))
        .slice(0, 8)
        .map((w) => `<div class="row"><span class="t" title="${esc(w.title)}"><em>${esc(w.title)}</em></span><span class="n">${fmt(w.citations ?? 0)}</span></div>`)
        .join("")}</div></div>
      <div class="chart"><h3>Palavras-chave mais frequentes</h3>${bars(countBy(ws, (w) => (w.keywords ?? []).map((k) => k.toLowerCase())), 10, "kw", kwColor)}</div>
    </div>
  </div></div>`;
}

// =============================================================== tela: histórico
function renderHistory() {
  $("#view").innerHTML = `<div class="page"><div class="page-inner">
    <p class="eyebrow">Para o método</p><h1 class="boxed">Histórico <span>das buscas</span></h1>
    <p class="sub">A expressão exata enviada a cada base, a data e quantos registros vieram. É o que a seção de método de uma revisão pede.</p>
    ${S.history.length ? `<div class="hist-actions"><button class="ghost" id="hMd">${ic("download", 15)}Exportar para o método (Markdown)</button><button class="ghost danger" id="hClear">${ic("trash", 15)}Apagar histórico</button></div>` : ""}
    <div class="hist-list">${
      S.history.length
        ? S.history
            .map(
              (h) => `<div class="hist-item"><div class="top-line"><b>${esc(describeQuery(h.query))}</b>
          <time>${new Date(h.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time><span class="hint">${fmt(h.unique)} trabalhos</span></div>
          <table>${h.runs
            .map((r) => `<tr><th scope="row">${esc(r.source)}</th><td><code>${esc(r.queryString || r.error || r.note || "—")}</code></td><td class="num">${r.error ? `<span class="danger">erro</span>` : `${fmt(r.retrieved)}${r.total != null ? ` de ${fmt(r.total)}` : ""}`}</td></tr>`)
            .join("")}</table>
          <button class="ghost sm" data-h="${h.id}">${ic("edit", 14)}Reabrir esta busca</button></div>`
            )
            .join("")
        : `<p class="hint">As buscas que você fizer ficam registradas aqui.</p>`
    }</div></div></div>`;
  $("#hMd")?.addEventListener("click", () => saveFile("tarrafa-estrategias.md", historyToMarkdown(S.history), "md"));
  $("#hClear")?.addEventListener("click", () => {
    if (!confirm("Apagar todo o histórico de buscas?")) return;
    S.history = [];
    store.saveHistory([]);
    render();
  });
  $$("[data-h]").forEach((b) => b.addEventListener("click", () => loadHistory(b.dataset.h!)));
}

// =============================================================== modais
function modal(html: string): HTMLElement {
  document.querySelector(".modal-bg")?.remove();
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener("click", (e) => e.target === bg && bg.remove());
  document.body.appendChild(bg);
  return bg;
}

function openSettings() {
  const s = S.settings;
  const bg = modal(`<h2>Configurações</h2>
    <div class="field"><label>Seu e-mail <span class="hint">OpenAlex e Crossref atendem melhor quem se identifica</span></label><input class="inp" type="email" id="sEmail" value="${esc(s.email)}"></div>
    <div class="field"><label>Chave da API do OpenAlex <span class="hint">gratuita; sem ela a cota diária é pequena e dividida com toda a sua rede</span></label>
      <div class="opt-row"><input class="inp" type="password" id="sOAKey" value="${esc(s.openalexKey)}" placeholder="cole aqui a chave recebida por e-mail"><button class="ghost" id="sOAReq" style="flex:0 0 auto">Pedir chave por e-mail</button></div>
      <div class="hint" id="sOAMsg" style="font-size:12.5px;margin-top:4px"></div></div>
    <div class="field"><label>Chave da API do Semantic Scholar <span class="hint">opcional; deixa a busca mais rápida</span></label><input class="inp" type="password" id="sS2" value="${esc(s.s2Key)}"></div>
    <div class="opt-row"><div class="field" style="flex:1"><label>Máximo de resultados por base</label><input class="inp" type="number" id="sMax" value="${s.maxPerSource}" min="50" max="20000" step="50"></div>
    <div class="field" style="flex:1"><label>Coleção do SciELO</label><select class="inp" id="sCol">${[["scl", "Brasil"], ["arg", "Argentina"], ["chl", "Chile"], ["col", "Colômbia"], ["mex", "México"], ["prt", "Portugal"], ["esp", "Espanha"], ["per", "Peru"], ["ury", "Uruguai"]]
      .map(([v, l]) => `<option value="${v}" ${s.scieloCollection === v ? "selected" : ""}>${l}</option>`)
      .join("")}</select></div></div>
    <div class="foot"><button class="ghost" id="sCancel">Cancelar</button><button class="btn-primary" id="sSave">Salvar</button></div>`);
  $("#sCancel", bg).addEventListener("click", () => bg.remove());
  $("#sOAReq", bg).addEventListener("click", async () => {
    const email = $<HTMLInputElement>("#sEmail", bg).value.trim();
    const msg = $("#sOAMsg", bg);
    if (!/^\S+@\S+\.\S+$/.test(email)) return void (msg.textContent = "Preencha seu e-mail acima primeiro.");
    msg.textContent = "Enviando pedido…";
    try {
      const r = await httpPost("https://api.openalex.org/api-keys", { email });
      msg.textContent = r.status < 300 ? `Pedido enviado. Abra o link que o OpenAlex mandou para ${email} e cole a chave aqui.` : `O OpenAlex respondeu ${r.status}: ${r.body.slice(0, 120)}`;
    } catch {
      msg.innerHTML = `Não consegui enviar daqui. Peça em <a href="https://openalex.org/settings/api" target="_blank">openalex.org/settings/api</a>.`;
    }
  });
  $("#sSave", bg).addEventListener("click", () => {
    S.settings = {
      ...s,
      email: $<HTMLInputElement>("#sEmail", bg).value.trim(),
      openalexKey: $<HTMLInputElement>("#sOAKey", bg).value.trim(),
      s2Key: $<HTMLInputElement>("#sS2", bg).value.trim(),
      maxPerSource: Math.max(50, Number($<HTMLInputElement>("#sMax", bg).value) || 500),
      scieloCollection: $<HTMLSelectElement>("#sCol", bg).value,
    };
    store.saveSettings(S.settings);
    bg.remove();
    toast("Configurações salvas.");
  });
}

function openLists(selectedId?: string) {
  let cur = S.lists.find((l) => l.id === selectedId) ?? S.lists[0];
  let results: any[] = [];
  let term = "";
  let timer = 0;
  const persist = () => {
    store.saveLists(S.lists);
    if (S.view === "search") renderSearch();
  };
  const issnsOf = (j: Journal) => [j.issn, ...(j.alt ?? [])];
  const inList = (x: any) => !!cur?.journals.some((j) => issnsOf(j).some((i) => (x.issn ?? [x.issn_l]).includes(i)));
  const meta = (pub?: string, country?: string, works?: number) =>
    [pub, country, works != null ? `${fmt(works)} trabalhos` : ""].filter(Boolean).map(esc).join(" · ");

  const bg = modal(`<div class="jl"></div>`);
  bg.querySelector(".modal")?.classList.add("modal-wide");
  const root = $(".jl", bg);

  const draw = () => {
    const kept = (document.activeElement as HTMLElement | null)?.id === "lSearch";
    root.innerHTML = `<h2>Revistas</h2>
      <p class="sub">A busca fica restrita às revistas da lista escolhida. Os dados vêm do OpenAlex, sem captcha.</p>
      <div class="jl-bar">
        <label class="lbl">Lista</label>
        <select class="inp" id="lSel">${S.lists.map((l) => `<option value="${l.id}" ${cur?.id === l.id ? "selected" : ""}>${esc(l.name)} (${l.journals.length})</option>`).join("")}</select>
        <button class="ghost" id="lNew">${ic("plus", 15)}Nova lista</button>
        ${cur ? `<button class="ghost danger" id="lDel">${ic("trash", 15)}Excluir lista</button>` : ""}
      </div>
      ${
        cur
          ? `<div class="jl-cols">
        <section>
          <input class="inp jl-name" id="lName" value="${esc(cur.name)}" aria-label="Nome da lista">
          <ul class="jl-list">${
            cur.journals
              .map(
                (j, i) => `<li class="jcard ${j.checked === null ? "bad" : ""}">
              <div><b>${esc(j.title)}</b>
                <span class="jmeta">${issnsOf(j).map((x) => `<code>${esc(x)}</code>`).join(" ")} ${
                  j.checked === null ? `<em class="danger">não achei no OpenAlex: confira o ISSN</em>` : esc(meta(j.publisher, j.country, j.works) ? "· " : "") + meta(j.publisher, j.country, j.works)
                }</span></div>
              <button class="rm" data-rm="${i}" title="Tirar da lista">${ic("x", 16)}</button></li>`
              )
              .join("") || `<li class="hint jl-empty">Nenhuma revista ainda. Procure ao lado.</li>`
          }</ul>
          <details class="jl-paste"><summary>Colar vários ISSNs</summary>
            <textarea class="inp" id="lPaste" rows="3" placeholder="um por linha"></textarea>
            <button class="ghost sm" id="lAddPaste">Adicionar</button></details>
        </section>
        <section>
          <label class="search-in jl-search">${ic("search", 16)}<input id="lSearch" placeholder="Nome da revista ou ISSN" value="${esc(term)}" autocomplete="off"></label>
          <div id="lResults" class="jl-results">${
            !term
              ? `<p class="hint">Digite o nome (ex.: Zetetiké, Statistics Education) ou o ISSN.</p>`
              : results === null
              ? `<p class="hint">Procurando…</p>`
              : results.length
              ? results
                  .map(
                    (x, i) => `<div class="jres ${inList(x) ? "in" : ""}">
                <div><b>${esc(x.display_name)}</b>${x.is_in_doaj ? ` <span class="tag oa">DOAJ</span>` : ""}
                  <span class="jmeta">${(x.issn ?? [x.issn_l]).map((y: string) => `<code>${esc(y)}</code>`).join(" ")} · ${meta(x.host_organization_name, x.country_code, x.works_count)}</span></div>
                ${inList(x) ? `<span class="jin">${ic("check", 15)}Na lista</span>` : `<button class="ghost sm" data-add="${i}">${ic("plus", 14)}Adicionar</button>`}</div>`
                  )
                  .join("")
              : `<p class="hint">Nada encontrado no OpenAlex.</p>`
          }</div>
        </section>
      </div>`
          : ""
      }
      <div class="foot"><button class="btn-primary" id="lClose">Concluir</button></div>`;

    $("#lSel", root)?.addEventListener("change", (e) => ((cur = S.lists.find((l) => l.id === (e.target as HTMLSelectElement).value)!), draw(), check()));
    $("#lNew", root).addEventListener("click", () => {
      cur = { id: `l${Date.now()}`, name: "Nova lista", journals: [] };
      S.lists.push(cur);
      persist();
      draw();
      ($("#lName", root) as HTMLInputElement)?.select();
    });
    $("#lDel", root)?.addEventListener("click", () => {
      if (!confirm(`Excluir a lista “${cur.name}”?`)) return;
      S.lists = S.lists.filter((l) => l !== cur);
      if (S.form.listId === cur.id) S.form.listId = "";
      cur = S.lists[0];
      persist();
      draw();
    });
    $("#lClose", root).addEventListener("click", () => bg.remove());
    if (!cur) return;
    $("#lName", root).addEventListener("change", (e) => ((cur.name = (e.target as HTMLInputElement).value.trim() || cur.name), persist(), draw()));
    $$("[data-rm]", root).forEach((b) => b.addEventListener("click", () => (cur.journals.splice(Number(b.dataset.rm), 1), persist(), draw())));
    $$("[data-add]", root).forEach((b) =>
      b.addEventListener("click", () => {
        const x = results[Number(b.dataset.add)];
        const all: string[] = x.issn?.length ? x.issn : [x.issn_l];
        const main = all.includes(x.issn_l) ? x.issn_l : all[0];
        cur.journals.push({ title: x.display_name, issn: main, alt: all.filter((i) => i !== main), publisher: x.host_organization_name ?? undefined, country: x.country_code ?? undefined, works: x.works_count, checked: true });
        persist();
        draw();
      })
    );
    const inp = $<HTMLInputElement>("#lSearch", root);
    inp.addEventListener("input", () => {
      term = inp.value.trim();
      clearTimeout(timer);
      timer = window.setTimeout(find, 350);
    });
    if (kept) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
    $("#lAddPaste", root).addEventListener("click", () => {
      for (const line of $<HTMLTextAreaElement>("#lPaste", root).value.split(/\n+/)) {
        const issn = cleanIssn(line);
        if (/^\d{4}-\d{3}[\dX]$/.test(issn) && !cur.journals.some((j) => issnsOf(j).includes(issn))) cur.journals.push({ title: issn, issn });
      }
      persist();
      draw();
      check();
    });
  };

  const find = async () => {
    const t = term;
    if (!t) return draw();
    results = null as any;
    draw();
    try {
      const isIssn = /^\d{4}-?\d{3}[\dxX]$/.test(t);
      const r = await getJson(
        isIssn
          ? `https://api.openalex.org/sources?filter=issn:${cleanIssn(t)}`
          : `https://api.openalex.org/sources?search=${encodeURIComponent(t)}&filter=type:journal&per-page=8`
      );
      if (t !== term) return;
      results = (r.results ?? []).filter((x: any) => x.issn_l || x.issn?.length);
    } catch {
      results = [];
    }
    draw();
  };

  // confere no OpenAlex as revistas ainda sem dados (listas antigas ou ISSNs colados)
  const check = async () => {
    const todo = cur?.journals.filter((j) => j.checked === undefined) ?? [];
    for (const j of todo) {
      try {
        const r = await getJson(`https://api.openalex.org/sources/issn:${cleanIssn(j.issn)}`);
        Object.assign(j, { checked: true, works: r.works_count, publisher: r.host_organization_name ?? undefined, country: r.country_code ?? undefined });
        if (/^\d{4}-\d{3}[\dX]$/.test(j.title)) j.title = r.display_name;
        const others = (r.issn ?? []).filter((i: string) => i !== j.issn);
        j.alt = [...new Set([...(j.alt ?? []), ...others])];
      } catch {
        j.checked = null;
      }
    }
    if (todo.length) {
      // junta entradas da mesma revista (listas antigas tinham um ISSN por linha)
      const seen: Journal[] = [];
      for (const j of cur.journals) {
        const twin = seen.find((s) => issnsOf(s).some((i) => issnsOf(j).includes(i)));
        if (twin) twin.alt = [...new Set([...(twin.alt ?? []), ...issnsOf(j)])].filter((i) => i !== twin.issn);
        else seen.push(j);
      }
      cur.journals = seen;
      persist();
      draw();
    }
  };
  draw();
  check();
}

$("#btnSettings").addEventListener("click", openSettings);
$("#btnLists").addEventListener("click", () => openLists(S.form.listId));

// modo de demonstração para revisar a interface sem rede: ?demo
if (new URLSearchParams(location.search).has("demo") || (window as any).__TARRAFA_DEMO__) {
  const demo = (window as any).__TARRAFA_DEMO__ as { works: Work[]; query: Query; view?: View; active?: number; basket?: number[] } | undefined;
  if (demo) {
    S.raw = demo.works;
    S.works = dedupe(demo.works);
    S.lastQuery = demo.query;
    S.form.blocks = demo.query.blocks.map((b) => [...b]);
    S.form.yearFrom = String(demo.query.yearFrom ?? "");
    S.form.yearTo = String(demo.query.yearTo ?? "");
    S.status = Object.fromEntries([...new Set(demo.works.flatMap((w) => w.sources))].map((s) => [SOURCES.find((x) => x.name === s)?.id ?? s, { state: "ok", done: demo.works.filter((w) => w.sources.includes(s)).length } as Status]));
    S.view = demo.view ?? "results";
    if (demo.active != null) S.active = S.works[demo.active]?.key ?? null;
    for (const i of demo.basket ?? []) if (S.works[i]) S.basket.add(S.works[i].key);
  }
}
render();
