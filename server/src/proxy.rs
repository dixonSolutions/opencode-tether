use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{OriginalUri, Path, State};
use axum::http::{HeaderMap, HeaderName, Method, Request, Response, StatusCode};
use axum::response::{IntoResponse, Response as AxumResponse};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;

use crate::host::AppState;

const API_PREFIXES: &[&str] = &[
    "/session",
    "/global",
    "/event",
    "/config",
    "/provider",
    "/agent",
    "/project",
    "/path",
    "/file",
    "/find",
    "/vcs",
    "/command",
    "/permission",
    "/question",
    "/pty",
    "/tui",
    "/mcp",
    "/lsp",
    "/formatter",
    "/auth",
    "/log",
    "/doc",
    "/experimental",
    "/sync",
    "/instance",
    "/skill",
    "/api",
];

const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

pub fn is_api_path(path: &str) -> bool {
    if path == "/api/tether" || path.starts_with("/api/tether/") {
        return false;
    }
    API_PREFIXES
        .iter()
        .any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")))
}

fn is_hop_by_hop(name: &str) -> bool {
    HOP_BY_HOP.iter().any(|hop| name.eq_ignore_ascii_case(hop))
}

fn filter_request_headers(headers: &HeaderMap) -> Vec<(HeaderName, String)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let name_str = name.as_str();
            if is_hop_by_hop(name_str)
                || matches!(
                    name_str,
                    "host" | "authorization" | "cookie" | "content-length" | "accept-encoding"
                )
            {
                return None;
            }
            value.to_str().ok().map(|value| (name.clone(), value.to_string()))
        })
        .collect()
}

pub async fn proxy_http(state: AppState, request: Request<Body>) -> Response<Body> {
    let method = request.method().clone();
    let uri = request.uri().clone();
    let path_and_query = uri
        .path_and_query()
        .map(|part| part.as_str().to_string())
        .unwrap_or_else(|| uri.path().to_string());
    let url = format!("{}{}", state.config.upstream_base_url(), path_and_query);
    let headers = filter_request_headers(request.headers());
    let body = if method == Method::GET || method == Method::HEAD || method == Method::OPTIONS {
        reqwest::Body::from(Vec::new())
    } else {
        reqwest::Body::wrap_stream(request.into_body().into_data_stream())
    };

    let mut outgoing = state
        .client
        .request(reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET), &url)
        .body(body);
    for (name, value) in headers {
        outgoing = outgoing.header(name.as_str(), value);
    }
    if let Some(auth) = state.config.upstream_auth_header() {
        outgoing = outgoing.header("authorization", auth);
    }

    let response = match outgoing.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(%url, %error, "upstream request failed");
            return (
                StatusCode::BAD_GATEWAY,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                json!({
                    "name": "TetherUpstreamError",
                    "data": { "message": format!("opencode did not answer: {error}") }
                })
                .to_string(),
            )
                .into_response();
        }
    };

    let status = StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut output = Response::builder().status(status);
    for (name, value) in response.headers() {
        if is_hop_by_hop(name.as_str()) || name == axum::http::header::CONTENT_LENGTH {
            continue;
        }
        output = output.header(name.as_str(), value.as_bytes());
    }
    let is_sse = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.starts_with("text/event-stream"))
        .unwrap_or(false);
    if is_sse {
        output = output
            .header("Cache-Control", "no-cache, no-transform")
            .header("X-Accel-Buffering", "no")
            .header("Connection", "keep-alive");
    }
    output
        .body(Body::from_stream(response.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn parse_auth_token(value: &str) -> Option<(String, String)> {
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD.decode(percent_decode(value)).ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    let (user, password) = decoded.split_once(':')?;
    Some((user.to_string(), password.to_string()))
}

fn percent_decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value).decode_utf8_lossy().to_string()
}

pub async fn websocket(
    State(state): State<AppState>,
    Path(_pty_id): Path<String>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> AxumResponse {
    let mut allowed = state.auth.authorize(&headers).is_some();
    let mut upstream_query = uri.query().unwrap_or("").to_string();
    let mut forwarded_auth: Option<String> = None;
    if let Some(query) = uri.query() {
        let mut kept = Vec::new();
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            match key {
                "ticket" => {
                    if !value.is_empty() {
                        // The ticket is minted by an authenticated request and validated by opencode.
                        allowed = true;
                    }
                    kept.push(pair.to_string());
                }
                "auth_token" => {
                    if let Some((user, password)) = parse_auth_token(value) {
                        if state.auth.verify_credentials(&user, &password) {
                            allowed = true;
                            forwarded_auth = Some(format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))));
                        }
                    }
                }
                _ => kept.push(pair.to_string()),
            }
        }
        upstream_query = kept.join("&");
    }
    if !allowed {
        return crate::host::unauthorized();
    }
    let upstream_query = if upstream_query.is_empty() { String::new() } else { format!("?{upstream_query}") };
    let upstream = format!(
        "{}{}{}",
        state.config.upstream_base_url().replace("http://", "ws://"),
        uri.path(),
        upstream_query
    );
    let header_list = filter_request_headers(&headers);
    let mut request = tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(
        upstream.as_str(),
    )
    .unwrap_or_else(|_| unreachable!());
    for (name, value) in header_list {
        if let Ok(value) = http::HeaderValue::from_str(&value) {
            request.headers_mut().insert(name, value);
        }
    }
    if let Some(auth) = state.config.upstream_auth_header().or(forwarded_auth) {
        if let Ok(value) = http::HeaderValue::from_str(&auth) {
            request.headers_mut().insert(http::header::AUTHORIZATION, value);
        }
    }
    let connection = tokio_tungstenite::connect_async(request).await;
    match connection {
        Ok((stream, _)) => upgrade.on_upgrade(move |socket| bridge(socket, stream)),
        Err(error) => {
            tracing::warn!(%upstream, %error, "upstream websocket failed");
            (
                StatusCode::BAD_GATEWAY,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                json!({ "name": "TetherUpstreamError", "data": { "message": format!("websocket failed: {error}") } })
                    .to_string(),
            )
                .into_response()
        }
    }
}

async fn bridge(client: WebSocket, upstream: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>) {
    use tokio_tungstenite::tungstenite::Message as UpstreamMessage;
    let (mut client_tx, mut client_rx) = client.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();

    let client_to_upstream = async {
        while let Some(message) = client_rx.next().await {
            let Ok(message) = message else { break };
            let converted = match message {
                Message::Text(text) => UpstreamMessage::Text(text.to_string().into()),
                Message::Binary(bytes) => UpstreamMessage::Binary(bytes),
                Message::Ping(bytes) => UpstreamMessage::Ping(bytes),
                Message::Pong(bytes) => UpstreamMessage::Pong(bytes),
                Message::Close(_) => UpstreamMessage::Close(None),
            };
            if upstream_tx.send(converted).await.is_err() {
                break;
            }
        }
        let _ = upstream_tx.close().await;
    };

    let upstream_to_client = async {
        while let Some(message) = upstream_rx.next().await {
            let Ok(message) = message else { break };
            let converted = match message {
                UpstreamMessage::Text(text) => Message::Text(text.to_string().into()),
                UpstreamMessage::Binary(bytes) => Message::Binary(bytes),
                UpstreamMessage::Ping(bytes) => Message::Ping(bytes),
                UpstreamMessage::Pong(bytes) => Message::Pong(bytes),
                UpstreamMessage::Close(_) => Message::Close(None),
                UpstreamMessage::Frame(_) => continue,
            };
            if client_tx.send(converted).await.is_err() {
                break;
            }
        }
        let _ = client_tx.close().await;
    };

    tokio::select! {
        _ = client_to_upstream => {},
        _ = upstream_to_client => {},
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_api_paths() {
        assert!(is_api_path("/session"));
        assert!(is_api_path("/session/abc/message"));
        assert!(is_api_path("/api/fs/list"));
        assert!(!is_api_path("/api/tether/info"));
        assert!(!is_api_path("/"));
        assert!(!is_api_path("/assets/index.js"));
    }

}
