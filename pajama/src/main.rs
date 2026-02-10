mod api;
mod config;
mod oauth;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::io::AsyncReadExt;

use crate::api::ApiClient;
use crate::config::{load_config, save_config};
use crate::oauth::{discover_oauth, login_oauth_pkce};

#[derive(Parser)]
#[command(name = "pajama", version, about = "PajamaDot CLI for Game Dev Memory (API + OAuth login)")]
struct Cli {
    /// Memory API base URL (defaults to config or PAJAMA_API_URL)
    #[arg(long, global = true)]
    api_url: Option<String>,

    /// Bearer token override (API key). If omitted, uses the saved token from `pajama login`.
    #[arg(long, global = true)]
    token: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Login via browser (OAuth PKCE). Stores an API key locally.
    Login {
        /// OAuth scopes requested (space-separated)
        #[arg(long)]
        scope: Option<String>,

        /// Do not attempt to open a browser automatically (prints URL instead)
        #[arg(long)]
        no_open: bool,
    },

    /// Remove the saved access token
    Logout,

    /// Print the current access token (treat as secret)
    Token,

    /// Print the config path
    ConfigPath,

    Projects {
        #[command(subcommand)]
        cmd: ProjectsCmd,
    },

    Memories {
        #[command(subcommand)]
        cmd: MemoriesCmd,
    },

    Assets {
        #[command(subcommand)]
        cmd: AssetsCmd,
    },
}

#[derive(Subcommand)]
enum ProjectsCmd {
    /// List projects in the current tenant scope
    List {
        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },

    /// Create a project
    Create {
        #[arg(long)]
        name: String,

        #[arg(long, default_value = "custom")]
        engine: String,

        #[arg(long, default_value = "")]
        description: String,
    },
}

#[derive(Subcommand)]
enum MemoriesCmd {
    /// List memories with optional filters
    List {
        #[arg(long)]
        project_id: Option<String>,

        #[arg(long)]
        category: Option<String>,

        #[arg(long)]
        q: Option<String>,

        #[arg(long)]
        tag: Option<String>,

        #[arg(long, default_value_t = 50)]
        limit: u32,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },

    /// Get a memory by id
    Get {
        id: String,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },

    /// Create a memory
    Create {
        #[arg(long)]
        project_id: String,

        #[arg(long)]
        category: String,

        #[arg(long)]
        title: String,

        #[arg(long)]
        content: String,

        /// Comma-separated tags
        #[arg(long, default_value = "")]
        tags: String,

        /// Confidence 0..1
        #[arg(long, default_value_t = 0.5)]
        confidence: f64,
    },
}

#[derive(Subcommand)]
enum AssetsCmd {
    /// Upload a large file as an asset (R2 multipart via the API)
    Upload {
        #[arg(long)]
        project_id: String,

        #[arg(long)]
        path: PathBuf,

        /// Optional memory id to link as an attachment
        #[arg(long)]
        memory_id: Option<String>,

        /// MIME type override (default: application/octet-stream)
        #[arg(long)]
        content_type: Option<String>,

        /// Part size in MB (5..95). Defaults based on file size.
        #[arg(long)]
        part_size_mb: Option<u32>,

        /// Output raw JSON for create/complete responses
        #[arg(long)]
        json: bool,
    },

    /// Get asset metadata
    Get {
        id: String,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },

    /// List assets with optional filters
    List {
        #[arg(long)]
        project_id: Option<String>,

        #[arg(long)]
        memory_id: Option<String>,

        #[arg(long)]
        status: Option<String>,

        #[arg(long, default_value_t = 50)]
        limit: u32,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },

    /// Download an asset to a file (supports ranged fetch internally)
    Download {
        id: String,

        #[arg(long)]
        out: PathBuf,
    },
}

#[derive(Debug, Deserialize, Serialize)]
struct ProjectsListResponse {
    projects: Vec<ProjectRow>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ProjectRow {
    id: String,
    name: String,
    engine: String,
    description: String,
    #[allow(dead_code)]
    created_at: Option<String>,
    #[allow(dead_code)]
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct MemoriesListResponse {
    memories: Vec<MemoryRow>,
    #[allow(dead_code)]
    meta: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct MemoryRow {
    id: String,
    project_id: String,
    category: String,
    title: String,
    #[allow(dead_code)]
    content: String,
    tags: serde_json::Value,
    confidence: f64,
    #[allow(dead_code)]
    updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct MemoryGetResponse {
    id: String,
    project_id: String,
    category: String,
    title: String,
    content: String,
    tags: serde_json::Value,
    confidence: f64,
}

#[derive(Debug, Deserialize, Serialize)]
struct AssetsListResponse {
    assets: Vec<AssetRow>,
}

#[derive(Debug, Deserialize, Serialize)]
struct AssetRow {
    id: String,
    project_id: String,
    status: String,
    r2_key: String,
    content_type: String,
    #[serde(deserialize_with = "de_u64_from_str_or_int")]
    byte_size: u64,
    original_name: Option<String>,
    created_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct CreateProjectRequest<'a> {
    name: &'a str,
    engine: &'a str,
    description: &'a str,
}

#[derive(Debug, Deserialize, Serialize)]
struct CreateProjectResponse {
    id: String,
}

#[derive(Debug, Serialize)]
struct CreateMemoryRequest<'a> {
    project_id: &'a str,
    session_id: Option<&'a str>,
    category: &'a str,
    source_type: &'a str,
    title: &'a str,
    content: &'a str,
    tags: Vec<String>,
    context: serde_json::Value,
    confidence: f64,
}

#[derive(Debug, Deserialize, Serialize)]
struct CreateMemoryResponse {
    id: String,
}

#[derive(Debug, Serialize)]
struct CreateAssetRequest<'a> {
    project_id: &'a str,
    original_name: &'a str,
    content_type: &'a str,
    byte_size: u64,
    part_size: u64,
    memory_id: Option<&'a str>,
    relation: Option<&'a str>,
    metadata: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct CreateAssetResponse {
    id: String,
    upload_part_size: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let Cli {
        api_url,
        token,
        command,
    } = cli;

    match command {
        Commands::ConfigPath => {
            let path = config::config_path()?;
            println!("{}", path.display());
            return Ok(());
        }
        _ => {}
    }

    let mut cfg = load_config()?;
    if let Some(api) = api_url.as_deref() {
        cfg.api_base_url = api.to_string();
    }

    match command {
        Commands::Login { scope, no_open } => {
            let meta = discover_oauth(&cfg.api_base_url).await?;
            let scope = scope.unwrap_or_else(|| {
                // Default: full access for a personal/org token in this system.
                // Enforcement is server-side; this is a request hint.
                "projects:read projects:write memories:read memories:write artifacts:read artifacts:write assets:read assets:write"
                    .to_string()
            });

            let res = login_oauth_pkce(
                &meta,
                &cfg.api_base_url,
                cfg.client_id.clone(),
                &scope,
                no_open,
            )
            .await?;

            cfg.client_id = Some(res.client_id);
            cfg.access_token = Some(res.access_token);
            save_config(&cfg)?;
            eprintln!("[pajama] Login saved.");
            return Ok(());
        }
        Commands::Logout => {
            cfg.access_token = None;
            save_config(&cfg)?;
            println!("ok");
            return Ok(());
        }
        Commands::Token => {
            let token = resolve_token(token.as_deref(), &cfg)?;
            println!("{token}");
            return Ok(());
        }
        Commands::Projects { cmd } => {
            let api = authed_api(token.as_deref(), &cfg)?;
            handle_projects(api, cmd).await?;
        }
        Commands::Memories { cmd } => {
            let api = authed_api(token.as_deref(), &cfg)?;
            handle_memories(api, cmd).await?;
        }
        Commands::Assets { cmd } => {
            let api = authed_api(token.as_deref(), &cfg)?;
            handle_assets(api, cmd).await?;
        }
        Commands::ConfigPath => unreachable!("handled above"),
    }

    Ok(())
}

fn resolve_token(token_override: Option<&str>, cfg: &config::Config) -> Result<String> {
    if let Some(t) = token_override {
        let t = t.trim();
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }
    if let Ok(env_t) = std::env::var("PAJAMA_TOKEN") {
        let t = env_t.trim().to_string();
        if !t.is_empty() {
            return Ok(t);
        }
    }
    cfg.access_token
        .clone()
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| anyhow!("missing access token; run `pajama login` (or pass --token / set PAJAMA_TOKEN)"))
}

fn authed_api(token_override: Option<&str>, cfg: &config::Config) -> Result<ApiClient> {
    let token = resolve_token(token_override, cfg)?;
    ApiClient::new(&cfg.api_base_url, &token)
}

async fn handle_projects(api: ApiClient, cmd: ProjectsCmd) -> Result<()> {
    match cmd {
        ProjectsCmd::List { json } => {
            let res: ProjectsListResponse = api.get_json("/api/projects", &[]).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&res)?);
                return Ok(());
            }
            for p in res.projects {
                println!("{}\t{}\t({})", p.id, p.name, p.engine);
            }
        }
        ProjectsCmd::Create {
            name,
            engine,
            description,
        } => {
            let req = CreateProjectRequest {
                name: &name,
                engine: &engine,
                description: &description,
            };
            let res: CreateProjectResponse = api.post_json("/api/projects", &req).await?;
            println!("{}", res.id);
        }
    }
    Ok(())
}

async fn handle_memories(api: ApiClient, cmd: MemoriesCmd) -> Result<()> {
    match cmd {
        MemoriesCmd::List {
            project_id,
            category,
            q,
            tag,
            limit,
            json,
        } => {
            let mut query: Vec<(&str, String)> = vec![("limit", limit.to_string())];
            if let Some(v) = project_id {
                query.push(("project_id", v));
            }
            if let Some(v) = category {
                query.push(("category", v));
            }
            if let Some(v) = q {
                query.push(("q", v));
            }
            if let Some(v) = tag {
                query.push(("tag", v));
            }

            let res: MemoriesListResponse = api.get_json("/api/memories", &query).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&res)?);
                return Ok(());
            }

            for m in res.memories {
                println!(
                    "{}\t{}\t{}\t(conf={:.2})\t{}",
                    m.id, m.project_id, m.category, m.confidence, m.title
                );
            }
        }
        MemoriesCmd::Get { id, json } => {
            let res: MemoryGetResponse = api.get_json(&format!("/api/memories/{id}"), &[]).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&res)?);
                return Ok(());
            }
            println!("{}\n{}\n\n{}", res.title, format!("[{}] conf={:.2}", res.category, res.confidence), res.content);
        }
        MemoriesCmd::Create {
            project_id,
            category,
            title,
            content,
            tags,
            confidence,
        } => {
            let tags = parse_tags_csv(&tags);
            let req = CreateMemoryRequest {
                project_id: &project_id,
                session_id: None,
                category: &category,
                source_type: "manual",
                title: &title,
                content: &content,
                tags,
                context: serde_json::json!({}),
                confidence: clamp_0_1(confidence),
            };
            let res: CreateMemoryResponse = api.post_json("/api/memories", &req).await?;
            println!("{}", res.id);
        }
    }
    Ok(())
}

async fn handle_assets(api: ApiClient, cmd: AssetsCmd) -> Result<()> {
    match cmd {
        AssetsCmd::Get { id, json } => {
            let res: serde_json::Value = api.get_json(&format!("/api/assets/{id}"), &[]).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&res)?);
                return Ok(());
            }
            println!("{}", serde_json::to_string_pretty(&res)?);
        }
        AssetsCmd::List {
            project_id,
            memory_id,
            status,
            limit,
            json,
        } => {
            let mut query: Vec<(&str, String)> = vec![("limit", limit.to_string())];
            if let Some(v) = project_id {
                query.push(("project_id", v));
            }
            if let Some(v) = memory_id {
                query.push(("memory_id", v));
            }
            if let Some(v) = status {
                query.push(("status", v));
            }

            let res: AssetsListResponse = api.get_json("/api/assets", &query).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&res)?);
                return Ok(());
            }

            for a in res.assets {
                println!(
                    "{}\t{}\t{}\t{} bytes\t{}",
                    a.id,
                    a.project_id,
                    a.status,
                    a.byte_size,
                    a.original_name.unwrap_or_else(|| a.r2_key)
                );
            }
        }
        AssetsCmd::Download { id, out } => {
            let query: Vec<(&str, String)> = vec![];
            let mut res = api.raw_get(&format!("/api/assets/{id}/object"), &query).await?;
            let status = res.status();
            if !status.is_success() {
                let text = res.text().await.unwrap_or_default();
                return Err(anyhow!("download failed (HTTP {status}): {text}"));
            }

            let mut f = tokio::fs::File::create(&out).await.with_context(|| format!("create {}", out.display()))?;
            while let Some(chunk) = res.chunk().await.context("read download chunk")? {
                tokio::io::AsyncWriteExt::write_all(&mut f, &chunk)
                    .await
                    .context("write download chunk")?;
            }
            println!("{}", out.display());
        }
        AssetsCmd::Upload {
            project_id,
            path,
            memory_id,
            content_type,
            part_size_mb,
            json,
        } => {
            let meta = tokio::fs::metadata(&path)
                .await
                .with_context(|| format!("stat {}", path.display()))?;
            if !meta.is_file() {
                return Err(anyhow!("path is not a file: {}", path.display()));
            }
            let byte_size = meta.len();

            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| anyhow!("invalid filename (non-utf8)"))?;

            let content_type = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
            let mut part_size = choose_part_size(byte_size, part_size_mb);

            // Ensure we stay <= 10k parts.
            let parts = div_ceil(byte_size, part_size);
            if parts > 10_000 {
                let min_part = div_ceil(byte_size, 10_000);
                part_size = clamp_part_size(min_part);
            }

            let req = CreateAssetRequest {
                project_id: &project_id,
                original_name: file_name,
                content_type: &content_type,
                byte_size,
                part_size,
                memory_id: memory_id.as_deref(),
                relation: Some("attachment"),
                metadata: serde_json::json!({}),
            };

            let created: CreateAssetResponse = api.post_json("/api/assets", &req).await?;
            if json {
                eprintln!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "id": created.id,
                        "upload_part_size": created.upload_part_size
                    }))?
                );
            } else {
                eprintln!("[pajama] Asset created: {}", created.id);
            }

            let mut f = tokio::fs::File::open(&path)
                .await
                .with_context(|| format!("open {}", path.display()))?;

            let mut remaining = byte_size;
            let mut part_number: u32 = 1;
            let part_size_u64 = created.upload_part_size;

            while remaining > 0 {
                let this_size = std::cmp::min(part_size_u64, remaining) as usize;
                let mut buf = vec![0u8; this_size];
                f.read_exact(&mut buf)
                    .await
                    .with_context(|| format!("read part {part_number}"))?;

                let _resp: serde_json::Value = api
                    .put_bytes(
                        &format!("/api/assets/{}/parts/{}", created.id, part_number),
                        "application/octet-stream",
                        buf,
                    )
                    .await
                    .with_context(|| format!("upload part {part_number}"))?;

                remaining -= this_size as u64;
                if !json {
                    let uploaded = byte_size - remaining;
                    eprintln!(
                        "[pajama] Uploaded part {} ({} / {} bytes)",
                        part_number, uploaded, byte_size
                    );
                }
                part_number += 1;
            }

            let completed: serde_json::Value = api
                .post_json(
                    &format!("/api/assets/{}/complete", created.id),
                    &serde_json::json!({}),
                )
                .await
                .context("complete multipart upload")?;

            if json {
                println!("{}", serde_json::to_string_pretty(&completed)?);
            } else {
                println!("{}", created.id);
            }
        }
    }

    Ok(())
}

fn parse_tags_csv(s: &str) -> Vec<String> {
    s.split(',')
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .take(32)
        .map(|t| t.to_string())
        .collect()
}

fn clamp_0_1(v: f64) -> f64 {
    if v.is_nan() {
        0.5
    } else if v < 0.0 {
        0.0
    } else if v > 1.0 {
        1.0
    } else {
        v
    }
}

fn div_ceil(n: u64, d: u64) -> u64 {
    if d == 0 { return 0; }
    (n + d - 1) / d
}

fn clamp_part_size(bytes: u64) -> u64 {
    const MB: u64 = 1024 * 1024;
    const MIN: u64 = 5 * MB;
    const MAX: u64 = 95 * MB;
    if bytes < MIN {
        MIN
    } else if bytes > MAX {
        MAX
    } else {
        bytes
    }
}

fn choose_part_size(file_size: u64, part_size_mb: Option<u32>) -> u64 {
    const MB: u64 = 1024 * 1024;

    if let Some(mb) = part_size_mb {
        return clamp_part_size(mb as u64 * MB);
    }

    // Heuristic: keep part count reasonable, while staying under typical Workers body limits.
    let mut part = if file_size >= 8 * 1024 * MB {
        64 * MB
    } else if file_size >= 512 * MB {
        32 * MB
    } else if file_size >= 64 * MB {
        16 * MB
    } else {
        8 * MB
    };

    // Also satisfy 10k part limit.
    let min_required = div_ceil(file_size, 10_000);
    if part < min_required {
        part = min_required;
    }

    clamp_part_size(part)
}

fn de_u64_from_str_or_int<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct V;

    impl<'de> serde::de::Visitor<'de> for V {
        type Value = u64;

        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            write!(f, "a non-negative integer or a string containing one")
        }

        fn visit_u64<E>(self, v: u64) -> Result<u64, E> {
            Ok(v)
        }

        fn visit_i64<E>(self, v: i64) -> Result<u64, E>
        where
            E: serde::de::Error,
        {
            u64::try_from(v).map_err(E::custom)
        }

        fn visit_str<E>(self, v: &str) -> Result<u64, E>
        where
            E: serde::de::Error,
        {
            v.parse::<u64>().map_err(E::custom)
        }

        fn visit_string<E>(self, v: String) -> Result<u64, E>
        where
            E: serde::de::Error,
        {
            v.parse::<u64>().map_err(E::custom)
        }
    }

    deserializer.deserialize_any(V)
}
