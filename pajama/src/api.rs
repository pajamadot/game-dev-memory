use anyhow::{Context, Result, anyhow};
use reqwest::header;
use serde::Serialize;
use serde::de::DeserializeOwned;
use url::Url;

#[derive(Clone)]
pub struct ApiClient {
    base: Url,
    client: reqwest::Client,
    token: String,
}

impl ApiClient {
    pub fn new(api_base_url: &str, token: &str) -> Result<Self> {
        let base = Url::parse(api_base_url)
            .with_context(|| format!("invalid api base url: {api_base_url}"))?;
        let client = reqwest::Client::builder()
            .user_agent("pajama-cli/0.1.2")
            .build()
            .context("build http client")?;

        Ok(Self {
            base,
            client,
            token: token.to_string(),
        })
    }

    fn url(&self, path: &str) -> Result<Url> {
        let path = path.trim_start_matches('/');
        self.base
            .join(path)
            .with_context(|| format!("join url path: {path}"))
    }

    pub async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<T> {
        let url = self.url(path)?;
        let mut req = self
            .client
            .get(url)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token));

        if !query.is_empty() {
            let pairs: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
            req = req.query(&pairs);
        }

        let res = req.send().await.context("http get")?;
        parse_json_response(res).await
    }

    pub async fn post_json<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let url = self.url(path)?;
        let res = self
            .client
            .post(url)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token))
            .header(header::CONTENT_TYPE, "application/json")
            .json(body)
            .send()
            .await
            .context("http post")?;
        parse_json_response(res).await
    }

    pub async fn put_bytes<T: DeserializeOwned>(
        &self,
        path: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<T> {
        let url = self.url(path)?;
        let res = self
            .client
            .put(url)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token))
            .header(header::CONTENT_TYPE, content_type)
            .body(bytes)
            .send()
            .await
            .context("http put")?;
        parse_json_response(res).await
    }

    #[allow(dead_code)]
    pub async fn delete_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = self.url(path)?;
        let res = self
            .client
            .delete(url)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token))
            .send()
            .await
            .context("http delete")?;
        parse_json_response(res).await
    }

    pub async fn raw_get(&self, path: &str, query: &[(&str, String)]) -> Result<reqwest::Response> {
        let url = self.url(path)?;
        let mut req = self
            .client
            .get(url)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token));

        if !query.is_empty() {
            let pairs: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
            req = req.query(&pairs);
        }

        let res = req.send().await.context("http get")?;
        Ok(res)
    }
}

async fn parse_json_response<T: DeserializeOwned>(res: reqwest::Response) -> Result<T> {
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("HTTP {status}: {text}"));
    }
    serde_json::from_str(&text).context("parse json response")
}
