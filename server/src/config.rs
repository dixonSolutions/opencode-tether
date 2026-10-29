use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};

pub const DEFAULT_BIND: &str = "0.0.0.0:4096";
pub const DEFAULT_UPSTREAM_PORT: u16 = 5191;
pub const DEFAULT_COMMAND: &str = "opencode serve --hostname 127.0.0.1 --port {port}";
pub const DEFAULT_REPO: &str = "dixonSolutions/opencode-tether";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub server: ServerConfig,
    pub opencode: OpencodeConfig,
    pub web: WebConfig,
    pub update: UpdateConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub bind: String,
    pub username: String,
    pub password_hash: String,
    pub cookie_secret: String,
    pub secure_cookies: bool,
    pub public_url: Option<String>,
    pub allowed_origins: Vec<String>,
    pub session_days: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OpencodeConfig {
    pub command: String,
    pub port: u16,
    pub hostname: String,
    pub autostart: bool,
    pub startup_timeout_secs: u64,
    pub working_dir: Option<PathBuf>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub env: BTreeMap<String, String>,
    pub health_interval_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WebConfig {
    pub root: Option<PathBuf>,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UpdateConfig {
    pub repo: String,
    pub channel: String,
    pub check_on_start: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: DEFAULT_BIND.into(),
            username: "opencode".into(),
            password_hash: String::new(),
            cookie_secret: String::new(),
            secure_cookies: false,
            public_url: None,
            allowed_origins: vec![
                "http://tauri.localhost".into(),
                "https://tauri.localhost".into(),
                "tauri://localhost".into(),
            ],
            session_days: 30,
        }
    }
}

impl Default for OpencodeConfig {
    fn default() -> Self {
        Self {
            command: DEFAULT_COMMAND.into(),
            port: DEFAULT_UPSTREAM_PORT,
            hostname: "127.0.0.1".into(),
            autostart: true,
            startup_timeout_secs: 40,
            working_dir: None,
            username: None,
            password: None,
            env: BTreeMap::new(),
            health_interval_secs: 10,
        }
    }
}

impl Default for WebConfig {
    fn default() -> Self {
        Self {
            root: None,
            title: "opencode-tether".into(),
        }
    }
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            repo: DEFAULT_REPO.into(),
            channel: "stable".into(),
            check_on_start: true,
        }
    }
}

impl Config {
    pub fn new(username: &str, password: &str) -> Result<Self> {
        let mut config = Self::default();
        config.server.username = username.to_string();
        config.server.password_hash = hash_password(password)?;
        config.server.cookie_secret = random_hex(32);
        Ok(config)
    }

    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| {
            format!(
                "could not read {}. Run `opencode-tether init` first.",
                path.display()
            )
        })?;
        let mut config: Config = toml::from_str(&text)
            .with_context(|| format!("invalid configuration in {}", path.display()))?;
        config.normalize();
        Ok(config)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("could not create {}", parent.display()))?;
        }
        let text = toml::to_string_pretty(self)?;
        std::fs::write(path, text).with_context(|| format!("could not write {}", path.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn normalize(&mut self) {
        if self.server.cookie_secret.is_empty() {
            self.server.cookie_secret = random_hex(32);
        }
        if self.server.username.is_empty() {
            self.server.username = "opencode".into();
        }
        if self.opencode.health_interval_secs == 0 {
            self.opencode.health_interval_secs = 10;
        }
        if self.opencode.startup_timeout_secs == 0 {
            self.opencode.startup_timeout_secs = 40;
        }
        if self.update.repo.is_empty() {
            self.update.repo = DEFAULT_REPO.into();
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.server.password_hash.is_empty() {
            bail!("server.password_hash is empty; run `opencode-tether init --force`");
        }
        let addr: std::net::SocketAddr = self
            .server
            .bind
            .parse()
            .with_context(|| format!("invalid server.bind `{}` (expected host:port)", self.server.bind))?;
        let _ = addr;
        if self.server.cookie_secret.len() < 32 {
            bail!("server.cookie_secret is too short; regenerate it with `opencode-tether init --force`");
        }
        if !self.opencode.command.is_empty() && self.opencode.port == 0 {
            bail!("opencode.port must not be zero");
        }
        Ok(())
    }

    pub fn verify_password_with_hash(hash: &str, password: &str) -> bool {
        match PasswordHash::new(hash) {
            Ok(hash) => Argon2::default().verify_password(password.as_bytes(), &hash).is_ok(),
            Err(_) => false,
        }
    }

    pub fn cookie_secret(&self) -> Vec<u8> {
        match hex::decode(&self.server.cookie_secret) {
            Ok(bytes) if !bytes.is_empty() => bytes,
            _ => self.server.cookie_secret.as_bytes().to_vec(),
        }
    }

    pub fn upstream_auth_header(&self) -> Option<String> {
        use base64::Engine;
        let username = self.opencode.username.as_deref()?;
        let password = self.opencode.password.as_deref().unwrap_or("");
        Some(format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"))
        ))
    }

    pub fn upstream_base_url(&self) -> String {
        let host = match self.opencode.hostname.as_str() {
            "" | "0.0.0.0" | "::" => "127.0.0.1",
            host => host,
        };
        format!("http://{}:{}", host, self.opencode.port)
    }

    pub fn redacted_json(&self) -> serde_json::Value {
        let mut value = serde_json::to_value(self).unwrap_or_default();
        if let Some(server) = value.get_mut("server").and_then(|v| v.as_object_mut()) {
            server.insert("password_hash".into(), serde_json::Value::String("<redacted>".into()));
            server.insert("cookie_secret".into(), serde_json::Value::String("<redacted>".into()));
        }
        if let Some(opencode) = value.get_mut("opencode").and_then(|v| v.as_object_mut()) {
            if opencode.get("password").map(|value| !value.is_null()).unwrap_or(false) {
                opencode.insert("password".into(), serde_json::Value::String("<redacted>".into()));
            }
        }
        value
    }
}

pub fn config_dir() -> PathBuf {
    if let Ok(path) = std::env::var("OPENCODE_TETHER_CONFIG_DIR") {
        return PathBuf::from(path);
    }
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("opencode-tether")
}

pub fn default_config_path() -> PathBuf {
    if let Ok(path) = std::env::var("OPENCODE_TETHER_CONFIG") {
        return PathBuf::from(path);
    }
    #[cfg(unix)]
    {
        let is_root = std::env::var("EUID").map(|v| v == "0").unwrap_or(false)
            || std::env::var("USER").map(|v| v == "root").unwrap_or(false)
            || std::env::var("HOME").map(|v| v == "/root").unwrap_or(false);
        if is_root {
            return PathBuf::from("/etc/opencode-tether/config.toml");
        }
    }
    config_dir().join("config.toml")
}

pub fn hash_password(password: &str) -> Result<String> {
    if password.len() < 4 {
        bail!("password must be at least 4 characters");
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| anyhow::anyhow!("could not hash password: {error}"))
}

pub fn random_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut buffer = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buffer);
    hex::encode(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_and_verifies() {
        let hash = hash_password("secret").unwrap();
        let mut config = Config::default();
        config.server.password_hash = hash;
        assert!(Config::verify_password_with_hash(&config.server.password_hash, "secret"));
        assert!(!Config::verify_password_with_hash(&config.server.password_hash, "wrong"));
    }

    #[test]
    fn normalizes_defaults() {
        let mut config = Config::default();
        config.server.cookie_secret.clear();
        config.normalize();
        assert_eq!(config.server.cookie_secret.len(), 64);
    }

    #[test]
    fn redacts_secrets() {
        let config = Config::new("alice", "secret").unwrap();
        let json = config.redacted_json().to_string();
        assert!(!json.contains("password_hash\":\"$argon2"));
        assert!(json.contains("<redacted>"));
    }
}
