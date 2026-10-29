use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_CREDENTIALS, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_MAX_AGE, CACHE_CONTROL, CONTENT_TYPE, HOST, ORIGIN,
    SET_COOKIE, VARY, WWW_AUTHENTICATE,
};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::process::Child;
use tracing::{error, info, warn};
use url::Url;

use crate::auth::{Auth, AuthKind};
use crate::config::Config;
use crate::proxy;
use crate::web::WebAssets;

#[derive(Clone, Debug, Serialize, Default)]
pub struct UpstreamInfo {
    pub healthy: bool,
    pub version: Option<String>,
    pub error: Option<String>,
    pub checked_at: Option<u64>,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub auth: Arc<Auth>,
    pub client: reqwest::Client,
    pub upstream: Arc<RwLock<UpstreamInfo>>,
    pub web: WebAssets,
    pub started: Instant,
    pub child_pid: Arc<RwLock<Option<u32>>>,
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

pub async fn run(config: Config, config_path: std::path::PathBuf) -> Result<()> {
    config.validate()?;
    let bind: SocketAddr = config
        .server
        .bind
        .parse()
        .with_context(|| format!("invalid bind address {}", config.server.bind))?;

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .no_proxy()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .context("could not build HTTP client")?;

    let auth = Arc::new(Auth::new(
        config.server.username.clone(),
        config.server.password_hash.clone(),
        config.cookie_secret(),
        config.server.session_days,
    ));
    let mut web = WebAssets::new(config.web.root.clone());
    web.title = config.web.title.clone();
    let state = AppState {
        config: Arc::new(config.clone()),
        auth,
        client,
        upstream: Arc::new(RwLock::new(UpstreamInfo::default())),
        web,
        started: Instant::now(),
        child_pid: Arc::new(RwLock::new(None)),
    };

    let mut child = maybe_spawn_upstream(&state).await?;
    poll_upstream_once(&state).await;
    spawn_upstream_poller(state.clone());

    let app = router(state.clone()).layer(middleware::from_fn_with_state(
        state.clone(),
        cors_middleware,
    ));

    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("could not bind {bind}"))?;
    let local = listener.local_addr().unwrap_or(bind);
    info!("opencode-tether {} listening on http://{local}", env!("CARGO_PKG_VERSION"));
    info!("config: {}", config_path.display());
    if let Some(public) = &config.server.public_url {
        info!("public URL: {public}");
    }
    if bind.ip().is_unspecified() {
        info!("also available at http://127.0.0.1:{}/", local.port());
    }

    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal());

    if let Err(error) = server.await {
        error!(%error, "server stopped with an error");
    }

    if let Some(child) = child.as_mut() {
        info!("stopping upstream opencode");
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    }
    info!("opencode-tether stopped");
    Ok(())
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/tether/info", get(info_handler))
        .route("/api/tether/login", post(login_handler))
        .route("/api/tether/logout", post(logout_handler))
        .route("/api/tether/session", get(session_handler))
        .route("/api/tether/health", get(health_handler))
        .route("/pty/{pty_id}/connect", get(proxy::websocket))
        .route("/api/pty/{pty_id}/connect", get(proxy::websocket))
        .route("/healthz", get(|| async { Json(json!({ "ok": true })) }))
        .fallback(gateway)
        .with_state(state)
}

async fn info_handler(State(state): State<AppState>) -> Json<Value> {
    let upstream = state.upstream.read().map(|value| value.clone()).unwrap_or_default();
    Json(json!({
        "name": "opencode-tether",
        "version": env!("CARGO_PKG_VERSION"),
        "mode": "host",
        "requiresAuth": true,
        "upstream": {
            "healthy": upstream.healthy,
            "version": upstream.version,
            "error": upstream.error,
        },
        "features": {
            "proxy": true,
            "embeddedWeb": true,
            "websockets": true,
            "singleUser": true,
        }
    }))
}

async fn login_handler(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Response {
    if has_origin(&headers) && !origin_allowed(&state, &headers) {
        return forbidden("Origin is not allowed");
    }
    let key = peer.ip().to_string();
    if state.auth.is_rate_limited(&key) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "name": "RateLimited", "data": { "message": "Too many attempts; wait a few minutes." } })),
        )
            .into_response();
    }
    if !state.auth.verify_credentials(&body.username, &body.password) {
        state.auth.record_failure(&key);
        return unauthorized();
    }
    state.auth.record_success(&key);
    let secure = state.config.server.secure_cookies
        || state
            .config
            .server
            .public_url
            .as_deref()
            .map(|url| url.starts_with("https://"))
            .unwrap_or(false);
    let cookie = state.auth.cookie_header(secure);
    let mut response = Json(json!({
        "authenticated": true,
        "username": state.config.server.username,
        "mode": "host",
        "version": env!("CARGO_PKG_VERSION"),
    }))
    .into_response();
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(SET_COOKIE, value);
    }
    response
}

async fn logout_handler(State(state): State<AppState>) -> Response {
    let mut response = Json(json!({ "authenticated": false })).into_response();
    if let Ok(value) = HeaderValue::from_str(&state.auth.clear_cookie()) {
        response.headers_mut().append(SET_COOKIE, value);
    }
    response
}

async fn session_handler(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if state.auth.authorize(&headers).is_none() {
        return unauthorized();
    }
    let upstream = state.upstream.read().map(|value| value.clone()).unwrap_or_default();
    Json(json!({
        "authenticated": true,
        "mode": "host",
        "username": state.config.server.username,
        "version": env!("CARGO_PKG_VERSION"),
        "upstream": {
            "healthy": upstream.healthy,
            "version": upstream.version,
            "error": upstream.error,
        },
        "startedAt": crate::auth::now_unix().saturating_sub(state.started.elapsed().as_secs()),
    }))
    .into_response()
}

async fn health_handler(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if state.auth.authorize(&headers).is_none() {
        return unauthorized();
    }
    poll_upstream_once(&state).await;
    let upstream = state.upstream.read().map(|value| value.clone()).unwrap_or_default();
    Json(json!({
        "ok": true,
        "name": "opencode-tether",
        "version": env!("CARGO_PKG_VERSION"),
        "uptimeSeconds": state.started.elapsed().as_secs(),
        "upstream": upstream,
    }))
    .into_response()
}

async fn gateway(State(state): State<AppState>, request: Request<Body>) -> Response {
    let path = request.uri().path().to_string();
    let method = request.method().clone();
    let headers = request.headers().clone();

    if path == "/api/tether" || path.starts_with("/api/tether/") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "name": "NotFound", "data": { "message": "Unknown tether endpoint" } })),
        )
            .into_response();
    }

    let is_api = proxy::is_api_path(&path);
    let auth_kind = state.auth.authorize(&headers);

    if is_api {
        if auth_kind.is_none() {
            return unauthorized();
        }
        if auth_kind == Some(AuthKind::Cookie) && !is_safe_method(&method) && !origin_ok_for_write(&state, &headers) {
            return forbidden("Cross-origin request rejected");
        }
        return proxy::proxy_http(state, request).await;
    }

    if method != Method::GET && method != Method::HEAD {
        return (StatusCode::METHOD_NOT_ALLOWED, "Method not allowed").into_response();
    }

    let Some(asset) = state.web.read(&path) else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };

    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(asset.bytes)
    };
    let mut response = Response::new(body);
    if let Ok(value) = HeaderValue::from_str(asset.mime) {
        response.headers_mut().insert(CONTENT_TYPE, value);
    }
    if let Ok(value) = HeaderValue::from_str(asset.cache) {
        response.headers_mut().insert(CACHE_CONTROL, value);
    }
    response
        .headers_mut()
        .insert("X-Content-Type-Options", HeaderValue::from_static("nosniff"));
    response
        .headers_mut()
        .insert("Referrer-Policy", HeaderValue::from_static("no-referrer"));
    response
}

async fn cors_middleware(State(state): State<AppState>, request: Request<Body>, next: Next) -> Response {
    let origin = request
        .headers()
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let allowed = origin
        .as_deref()
        .map(|_| origin_allowed(&state, request.headers()))
        .unwrap_or(false);

    if request.method() == Method::OPTIONS && allowed {
        let mut response = StatusCode::NO_CONTENT.into_response();
        add_cors(&mut response, origin.as_deref());
        return response;
    }

    let mut response = next.run(request).await;
    if allowed {
        add_cors(&mut response, origin.as_deref());
    }
    response
}

fn add_cors(response: &mut Response, origin: Option<&str>) {
    let Some(origin) = origin else { return };
    if let Ok(value) = HeaderValue::from_str(origin) {
        response.headers_mut().insert(ACCESS_CONTROL_ALLOW_ORIGIN, value);
        response
            .headers_mut()
            .insert(ACCESS_CONTROL_ALLOW_CREDENTIALS, HeaderValue::from_static("true"));
        response
            .headers_mut()
            .insert(ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"));
        response.headers_mut().insert(
            ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("authorization, content-type, accept, last-event-id, x-requested-with"),
        );
        response
            .headers_mut()
            .insert(ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("86400"));
        response.headers_mut().insert(VARY, HeaderValue::from_static("Origin"));
    }
}

fn has_origin(headers: &HeaderMap) -> bool {
    headers.get(ORIGIN).is_some()
}

fn origin_allowed(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(ORIGIN).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    if origin == "null" {
        return false;
    }
    if state.config.server.allowed_origins.iter().any(|allowed| allowed == origin) {
        return true;
    }
    if let Some(public) = &state.config.server.public_url {
        if let Ok(public) = Url::parse(public) {
            if let Ok(candidate) = Url::parse(origin) {
                if public.origin() == candidate.origin() {
                    return true;
                }
            }
        }
    }
    let Ok(candidate) = Url::parse(origin) else { return false };
    let Some(host) = headers.get(HOST).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let host_without_port = host.rsplit_once(':').map(|(host, _)| host).unwrap_or(host);
    candidate.host_str() == Some(host_without_port)
        || candidate.host_str() == Some(host)
        || candidate.authority() == host
}

fn origin_ok_for_write(state: &AppState, headers: &HeaderMap) -> bool {
    if !has_origin(headers) {
        return true;
    }
    origin_allowed(state, headers)
}

fn is_safe_method(method: &Method) -> bool {
    matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

pub fn unauthorized() -> Response {
    let mut response = (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "name": "Unauthorized",
            "data": { "message": "Sign in to this opencode-tether host." }
        })),
    )
        .into_response();
    response.headers_mut().insert(
        WWW_AUTHENTICATE,
        HeaderValue::from_static("Basic realm=\"opencode-tether\", charset=\"UTF-8\""),
    );
    response
}

fn forbidden(message: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "name": "Forbidden", "data": { "message": message } })),
    )
        .into_response()
}

async fn maybe_spawn_upstream(state: &AppState) -> Result<Option<Child>> {
    if !state.config.opencode.autostart {
        info!("opencode.autostart is false; using the configured upstream without starting it");
        return Ok(None);
    }
    let command = state.config.opencode.command.trim();
    if command.is_empty() {
        info!("opencode.command is empty; no upstream will be started");
        return Ok(None);
    }
    let expanded = command
        .replace("{port}", &state.config.opencode.port.to_string())
        .replace("{hostname}", &state.config.opencode.hostname)
        .replace("{bind}", &state.config.server.bind)
        .replace("{url}", &state.config.upstream_base_url());
    let parts = shell_words::split(&expanded).context("could not parse opencode.command")?;
    let Some((program, args)) = parts.split_first() else {
        bail!("opencode.command did not contain a program");
    };
    info!(command = %expanded, "starting upstream opencode");
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null());
    if let Some(dir) = &state.config.opencode.working_dir {
        command.current_dir(dir);
    }
    command.env(
        "OPENCODE_TETHER_UPSTREAM_PORT",
        state.config.opencode.port.to_string(),
    );
    command.env("OPENCODE_TETHER_HOST", &state.config.server.bind);
    for (key, value) in &state.config.opencode.env {
        command.env(key, value);
    }
    let child = command.spawn().context("could not start opencode; is it installed and on PATH?")?;
    let pid = child.id();
    if let Ok(mut guard) = state.child_pid.write() {
        *guard = pid;
    }
    if let Some(pid) = pid {
        info!(pid, "upstream opencode started");
    }
    wait_for_upstream(state).await;
    Ok(Some(child))
}

async fn wait_for_upstream(state: &AppState) {
    let timeout = Duration::from_secs(state.config.opencode.startup_timeout_secs.max(1));
    let started = Instant::now();
    loop {
        let info = fetch_upstream(state).await;
        if info.healthy {
            info!(
                version = info.version.as_deref().unwrap_or("unknown"),
                "upstream opencode is ready"
            );
            return;
        }
        if started.elapsed() > timeout {
            warn!(
                error = info.error.as_deref().unwrap_or("unknown error"),
                "upstream opencode did not become ready in time"
            );
            return;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}

fn spawn_upstream_poller(state: AppState) {
    let interval = Duration::from_secs(state.config.opencode.health_interval_secs.max(2));
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            let info = fetch_upstream(&state).await;
            if let Ok(mut guard) = state.upstream.write() {
                *guard = info;
            }
        }
    });
}

async fn poll_upstream_once(state: &AppState) {
    let info = fetch_upstream(state).await;
    if let Ok(mut guard) = state.upstream.write() {
        *guard = info;
    }
}

async fn fetch_upstream(state: &AppState) -> UpstreamInfo {
    let url = format!("{}/global/health", state.config.upstream_base_url());
    let mut request = state.client.get(&url).timeout(Duration::from_secs(5));
    if let Some(auth) = state.config.upstream_auth_header() {
        request = request.header("authorization", auth);
    }
    match request.send().await {
        Ok(response) if response.status().is_success() => {
            let body: Value = response.json().await.unwrap_or(Value::Null);
            UpstreamInfo {
                healthy: body.get("healthy").and_then(Value::as_bool).unwrap_or(true),
                version: body.get("version").and_then(Value::as_str).map(str::to_string),
                error: None,
                checked_at: Some(crate::auth::now_unix()),
            }
        }
        Ok(response) if response.status() == StatusCode::UNAUTHORIZED => UpstreamInfo {
            healthy: true,
            version: None,
            error: Some("upstream requires authentication".into()),
            checked_at: Some(crate::auth::now_unix()),
        },
        Ok(response) => UpstreamInfo {
            healthy: false,
            version: None,
            error: Some(format!("upstream returned HTTP {}", response.status())),
            checked_at: Some(crate::auth::now_unix()),
        },
        Err(error) => UpstreamInfo {
            healthy: false,
            version: None,
            error: Some(if error.is_timeout() {
                "upstream timed out".into()
            } else {
                error.to_string()
            }),
            checked_at: Some(crate::auth::now_unix()),
        },
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    info!("shutdown signal received");
}

#[allow(dead_code)]
fn encode_basic(username: &str, password: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"))
}
