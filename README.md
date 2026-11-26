# Tarrafa

Busca de literatura acadêmica em várias bases ao mesmo tempo, inspirada no Publish or Perish, mas só para busca: ERIC, SciELO, OpenAlex, Crossref, DOAJ, BDTD e Semantic Scholar.

- Monte a busca em grupos de sinônimos (E / OU / NÃO) e veja a frase em português antes de buscar.
- Limite por ano, lista de revistas, país da revista e tipo de trabalho.
- Filtre os resultados por ano, conceito, base, tipo, revista e idioma.
- Exporte em RIS, BibTeX, CSV ou planilha de triagem.

## Rodar

```bash
npm install
npm run dev          # navegador, em http://localhost:5173
npm run tauri dev    # app de desktop
./build-mac.sh       # app para macOS, com assinatura ad hoc
```

## Online (Cloudflare Pages)

Build command `npm run build`, output directory `dist`. A pasta `functions/` publica o proxy `/api/proxy`, que só aceita os hosts das bases e contorna o CORS no navegador.

As configurações e chaves de API ficam no navegador de quem usa. Uma chave gratuita do OpenAlex (Configurações) tira o limite de 10 mil registros por busca.
