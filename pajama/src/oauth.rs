use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use reqwest::header;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::timeout;
use url::Url;

#[derive(Debug, Deserialize)]
pub struct OAuthMetadata {
    #[allow(dead_code)]
    pub issuer: Option<String>,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RegisterResponse {
    client_id: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
    expires_in: Option<u64>,
    scope: Option<String>,
}

pub async fn discover_oauth(api_base_url: &str) -> Result<OAuthMetadata> {
    let base = api_base_url.trim_end_matches('/');
    let url = format!("{base}/.well-known/oauth-authorization-server");

    let client = reqwest::Client::new();
    let res = client.get(url).send().await.context("fetch oauth metadata")?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("oauth metadata request failed (HTTP {status}): {text}"));
    }

    let meta: OAuthMetadata =
        serde_json::from_str(&text).context("parse oauth metadata json")?;
    Ok(meta)
}

pub async fn register_client(registration_endpoint: &str, client_name: &str) -> Result<String> {
    let client = reqwest::Client::new();
    let res = client
        .post(registration_endpoint)
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::json!({
                "client_name": client_name,
                "redirect_uris": [],
            })
            .to_string(),
        )
        .send()
        .await
        .context("register oauth client")?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("client registration failed (HTTP {status}): {text}"));
    }

    let parsed: RegisterResponse =
        serde_json::from_str(&text).context("parse register response json")?;
    Ok(parsed.client_id)
}

fn random_base64url(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_verifier() -> String {
    // 64 bytes -> ~86 chars, within 43..128 requirement.
    random_base64url(64)
}

fn pkce_challenge_s256(verifier: &str) -> String {
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    let digest = h.finalize();
    URL_SAFE_NO_PAD.encode(digest)
}

async fn wait_for_oauth_callback(
    listener: TcpListener,
    expected_state: String,
) -> Result<String> {
    let (tx, rx) = oneshot::channel::<Result<String>>();

    tokio::spawn(async move {
        let mut tx = Some(tx);
        loop {
            let accept = listener.accept().await;
            let Ok((mut socket, _addr)) = accept else {
                if let Some(tx) = tx.take() {
                    let _ = tx.send(Err(anyhow!("failed to accept callback connection")));
                }
                return;
            };

            // Minimal HTTP parse: read headers and request line.
            let mut buf = vec![0u8; 16 * 1024];
            let mut n = 0usize;
            loop {
                match socket.read(&mut buf[n..]).await {
                    Ok(0) => break,
                    Ok(read_n) => {
                        n += read_n;
                        if n >= 4 && buf[..n].windows(4).any(|w| w == b"\r\n\r\n") {
                            break;
                        }
                        if n >= buf.len() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }

            let req = String::from_utf8_lossy(&buf[..n]);
            let first_line = req.lines().next().unwrap_or("");
            let mut parts = first_line.split_whitespace();
            let method = parts.next().unwrap_or("");
            let target = parts.next().unwrap_or("");

            let mut send_ok = None::<String>;
            let mut html = Some(error_html("Not found."));

            if method == "GET" && target.starts_with("/callback") {
                match Url::parse(&format!("http://127.0.0.1{target}")) {
                    Ok(url) => {
                        let mut code: Option<String> = None;
                        let mut state: Option<String> = None;
                        for (k, v) in url.query_pairs() {
                            if k == "code" {
                                code = Some(v.to_string());
                            } else if k == "state" {
                                state = Some(v.to_string());
                            }
                        }

                        if state.as_deref() != Some(&expected_state) {
                            html = Some(error_html("State mismatch. You can close this window and retry."));
                        } else if let Some(code) = code {
                            send_ok = Some(code);
                            html = Some(success_html());
                        } else {
                            html = Some(error_html(
                                "Missing authorization code. You can close this window and retry.",
                            ));
                        }
                    }
                    Err(_) => {
                        html = Some(error_html("Invalid callback URL"));
                    }
                }
            }

            let body = html.unwrap_or_else(|| error_html("Unknown error."));
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.as_bytes().len(),
                body
            );
            let _ = socket.write_all(resp.as_bytes()).await;
            let _ = socket.shutdown().await;

            if let Some(code) = send_ok {
                if let Some(tx) = tx.take() {
                    let _ = tx.send(Ok(code));
                }
                return;
            }
        }
    });

    // Wait up to 3 minutes for the auth callback.
    let code = timeout(Duration::from_secs(180), rx)
        .await
        .context("timeout waiting for oauth callback")?
        .context("oauth callback channel closed")??;
    Ok(code)
}

fn success_html() -> String {
    "<!doctype html><html><head><meta charset=\"utf-8\" /><title>Pajama</title></head><body><h2>Login complete</h2><p>You can close this window.</p></body></html>".to_string()
}

fn error_html(msg: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\" /><title>Pajama</title></head><body><h2>Login error</h2><p>{}</p></body></html>",
        html_escape(msg)
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\"', "&quot;")
        .replace('\'', "&#x27;")
}

pub struct LoginResult {
    pub access_token: String,
    #[allow(dead_code)]
    pub token_type: String,
    #[allow(dead_code)]
    pub expires_in: Option<u64>,
    #[allow(dead_code)]
    pub scope: Option<String>,
    pub client_id: String,
}

pub async fn login_oauth_pkce(
    meta: &OAuthMetadata,
    api_base_url: &str,
    existing_client_id: Option<String>,
    scope: &str,
    no_open: bool,
) -> Result<LoginResult> {
    let client_id = if let Some(cid) = existing_client_id {
        cid
    } else {
        let reg = meta
            .registration_endpoint
            .as_deref()
            .ok_or_else(|| anyhow!("oauth server does not expose a registration_endpoint"))?;
        register_client(reg, "pajama-cli").await?
    };

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("bind loopback callback server")?;
    let addr = listener.local_addr().context("read callback addr")?;
    let redirect_uri = format!("http://127.0.0.1:{}/callback", addr.port());

    let state = random_base64url(18);
    let verifier = pkce_verifier();
    let challenge = pkce_challenge_s256(&verifier);

    let mut auth_url = Url::parse(&meta.authorization_endpoint)
        .context("parse authorization_endpoint")?;
    {
        let mut q = auth_url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", &client_id);
        q.append_pair("redirect_uri", &redirect_uri);
        q.append_pair("scope", scope);
        q.append_pair("state", &state);
        q.append_pair("code_challenge", &challenge);
        q.append_pair("code_challenge_method", "S256");
    }

    if no_open {
        eprintln!("[pajama] Open this URL in your browser to continue login:");
        eprintln!("{auth_url}");
    } else {
        match open::that(auth_url.as_str()) {
            Ok(_) => {
                eprintln!("[pajama] Opening browser for login...");
            }
            Err(err) => {
                eprintln!("[pajama] Failed to open browser: {err}");
                eprintln!("[pajama] Open this URL manually:");
                eprintln!("{auth_url}");
            }
        }
    }

    let code = wait_for_oauth_callback(listener, state).await?;

    // Exchange code -> token
    let client = reqwest::Client::new();
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_verifier", verifier.as_str()),
        ("client_id", client_id.as_str()),
    ];

    let res = client
        .post(&meta.token_endpoint)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(url::form_urlencoded::Serializer::new(String::new()).extend_pairs(form).finish())
        .send()
        .await
        .context("exchange oauth code for token")?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("token exchange failed (HTTP {status}): {text}"));
    }

    let token: TokenResponse = serde_json::from_str(&text).context("parse token response json")?;
    if token.token_type.to_lowercase() != "bearer" {
        return Err(anyhow!(
            "unexpected token_type '{}' (expected Bearer)",
            token.token_type
        ));
    }

    // Basic sanity: make sure the token looks like our API keys.
    if !token.access_token.starts_with("gdm_") {
        eprintln!(
            "[pajama] Warning: access_token does not look like a gdm_ API key. Continuing anyway."
        );
    }

    // TODO: Add a simple post-login check (e.g., GET /api/projects) once the token is stored.
    // We keep the OAuth module pure and let the caller do that.
    let _ = api_base_url;

    Ok(LoginResult {
        access_token: token.access_token,
        token_type: token.token_type,
        expires_in: token.expires_in,
        scope: token.scope,
        client_id,
    })
}
