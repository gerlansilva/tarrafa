use std::collections::HashMap;
use std::time::Duration;

const USER_AGENT: &str = concat!(
    "Tarrafa/",
    env!("CARGO_PKG_VERSION"),
    " (busca acadêmica; https://github.com/gerlansilva/tarrafa)"
);

struct Http(reqwest::Client);

#[derive(serde::Serialize)]
struct HttpResponse {
    status: u16,
    body: String,
}

/// GET genérico usado por todos os conectores (evita as restrições de CORS do webview).
#[tauri::command]
async fn http_get(
    state: tauri::State<'_, Http>,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<HttpResponse, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("URL inválida".into());
    }
    let mut req = state.0.get(&url);
    if let Some(h) = headers {
        for (k, v) in h {
            req = req.header(k, v);
        }
    }
    let resp = req.send().await.map_err(|e| format!("Falha de rede: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Falha ao ler resposta: {e}"))?;
    Ok(HttpResponse { status, body })
}

/// POST JSON — usado só para pedir a chave gratuita do OpenAlex.
#[tauri::command]
async fn http_post_json(state: tauri::State<'_, Http>, url: String, body: String) -> Result<HttpResponse, String> {
    if !url.starts_with("https://api.openalex.org/") {
        return Err("destino não permitido".into());
    }
    let resp = state
        .0
        .post(&url)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Falha de rede: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, body })
}

/// Grava um arquivo de exportação no caminho escolhido pelo usuário no diálogo "Salvar".
#[tauri::command]
fn save_text(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Não foi possível salvar: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(60))
        .gzip(true)
        .build()
        .expect("cliente HTTP");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Http(client))
        .invoke_handler(tauri::generate_handler![http_get, http_post_json, save_text])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a Tarrafa");
}
