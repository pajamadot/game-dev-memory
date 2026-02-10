use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub api_base_url: String,
    pub client_id: Option<String>,
    pub access_token: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_base_url: default_api_base_url(),
            client_id: None,
            access_token: None,
        }
    }
}

pub fn default_api_base_url() -> String {
    std::env::var("PAJAMA_API_URL")
        .ok()
        .and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        })
        .unwrap_or_else(|| "https://api-game-dev-memory.pajamadot.com".to_string())
}

pub fn config_path() -> Result<PathBuf> {
    let proj = ProjectDirs::from("com", "PajamaDot", "pajama")
        .context("could not determine config directory")?;
    Ok(proj.config_dir().join("config.json"))
}

pub fn load_config() -> Result<Config> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Config::default());
    }

    let text = fs::read_to_string(&path).with_context(|| format!("read config {}", path.display()))?;
    let mut cfg: Config = serde_json::from_str(&text).context("parse config json")?;
    if cfg.api_base_url.trim().is_empty() {
        cfg.api_base_url = default_api_base_url();
    }
    Ok(cfg)
}

pub fn save_config(cfg: &Config) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create config dir {}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(cfg).context("serialize config json")?;
    fs::write(&path, format!("{text}\n")).with_context(|| format!("write config {}", path.display()))?;
    Ok(())
}
