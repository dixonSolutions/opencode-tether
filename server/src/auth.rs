use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

pub const COOKIE_NAME: &str = "tether_session";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthKind {
    Basic,
    Cookie,
}

#[derive(Debug)]
struct Attempt {
    failures: u32,
    first: Instant,
}

pub struct Auth {
    username: String,
    password_hash: String,
    secret: Vec<u8>,
    session_days: u64,
    attempts: Mutex<HashMap<String, Attempt>>,
}

impl Auth {
    pub fn new(username: String, password_hash: String, secret: Vec<u8>, session_days: u64) -> Self {
        Self {
            username,
            password_hash,
            secret,
            session_days: session_days.max(1),
            attempts: Mutex::new(HashMap::new()),
        }
    }

    pub fn verify_credentials(&self, username: &str, password: &str) -> bool {
        let expected = Sha256::digest(self.username.as_bytes());
        let actual = Sha256::digest(username.as_bytes());
        if expected.ct_eq(&actual).unwrap_u8() != 1 {
            return false;
        }
        crate::config::Config::verify_password_with_hash(&self.password_hash, password)
    }

    pub fn issue_cookie(&self) -> String {
        let issued = now_unix();
        let signature = self.sign(issued);
        format!("{COOKIE_NAME}=v1.{issued}.{signature}")
    }

    pub fn clear_cookie(&self) -> String {
        format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
    }

    pub fn cookie_header(&self, secure: bool) -> String {
        let mut value = self.issue_cookie();
        value.push_str("; Path=/; HttpOnly; SameSite=Lax");
        value.push_str(&format!("; Max-Age={}", self.session_days * 86_400));
        if secure {
            value.push_str("; Secure");
        }
        value
    }

    pub fn authorize(&self, headers: &http::HeaderMap) -> Option<AuthKind> {
        if let Some(value) = headers.get(http::header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
            if let Some((user, password)) = parse_basic(value) {
                if self.verify_credentials(&user, &password) {
                    return Some(AuthKind::Basic);
                }
            }
        }
        if let Some(token) = cookie_value(headers, COOKIE_NAME) {
            if self.verify_token(&token) {
                return Some(AuthKind::Cookie);
            }
        }
        None
    }

    pub fn is_rate_limited(&self, key: &str) -> bool {
        let mut attempts = self.attempts.lock().unwrap();
        let now = Instant::now();
        attempts.retain(|_, attempt| now.duration_since(attempt.first) < Duration::from_secs(300));
        attempts
            .get(key)
            .map(|attempt| attempt.failures >= 20)
            .unwrap_or(false)
    }

    pub fn record_failure(&self, key: &str) {
        let mut attempts = self.attempts.lock().unwrap();
        let now = Instant::now();
        let entry = attempts.entry(key.to_string()).or_insert(Attempt {
            failures: 0,
            first: now,
        });
        if now.duration_since(entry.first) > Duration::from_secs(300) {
            entry.failures = 0;
            entry.first = now;
        }
        entry.failures += 1;
    }

    pub fn record_success(&self, key: &str) {
        self.attempts.lock().unwrap().remove(key);
    }

    fn sign(&self, issued: u64) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.secret).expect("hmac accepts any key");
        mac.update(format!("v1.{issued}").as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    pub fn verify_token(&self, token: &str) -> bool {
        let mut parts = token.split('.');
        let (Some("v1"), Some(issued), Some(signature), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return false;
        };
        let Ok(issued) = issued.parse::<u64>() else {
            return false;
        };
        let now = now_unix();
        if issued > now + 120 || now.saturating_sub(issued) > self.session_days * 86_400 {
            return false;
        }
        let expected = self.sign(issued);
        expected.as_bytes().ct_eq(signature.as_bytes()).unwrap_u8() == 1
    }
}

pub fn parse_basic(value: &str) -> Option<(String, String)> {
    let encoded = value.strip_prefix("Basic ").or_else(|| value.strip_prefix("basic "))?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(encoded.trim()).ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    let (user, password) = decoded.split_once(':')?;
    Some((user.to_string(), password.to_string()))
}

pub fn cookie_value(headers: &http::HeaderMap, name: &str) -> Option<String> {
    let header = headers.get(http::header::COOKIE)?.to_str().ok()?;
    for part in header.split(';') {
        let part = part.trim();
        if let Some((key, value)) = part.split_once('=') {
            if key == name {
                return Some(value.to_string());
            }
        }
    }
    None
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auth() -> Auth {
        Auth::new(
            "alice".into(),
            crate::config::hash_password("hunter2").unwrap(),
            vec![7u8; 32],
            30,
        )
    }

    #[test]
    fn verifies_credentials() {
        let auth = auth();
        assert!(auth.verify_credentials("alice", "hunter2"));
        assert!(!auth.verify_credentials("alice", "nope"));
        assert!(!auth.verify_credentials("bob", "hunter2"));
    }

    #[test]
    fn token_round_trip_and_tamper() {
        let auth = auth();
        let token = auth.issue_cookie();
        let value = token.trim_start_matches("tether_session=");
        assert!(auth.verify_token(value));
        assert!(!auth.verify_token(&format!("{value}0")));
        assert!(!auth.verify_token("v1.1.deadbeef"));
    }

    #[test]
    fn basic_parsing() {
        let encoded = base64::engine::general_purpose::STANDARD.encode("alice:hunter2");
        let (user, password) = parse_basic(&format!("Basic {encoded}")).unwrap();
        assert_eq!(user, "alice");
        assert_eq!(password, "hunter2");
    }
}
