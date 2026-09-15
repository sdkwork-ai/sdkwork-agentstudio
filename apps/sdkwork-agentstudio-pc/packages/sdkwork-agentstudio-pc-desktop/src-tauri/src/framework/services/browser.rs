use crate::framework::{config::SecurityConfig, FrameworkError, Result};
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug)]
pub struct BrowserService {
    allow_external_http: bool,
}

impl BrowserService {
    pub fn new() -> Self {
        Self::with_security(&SecurityConfig::default())
    }

    pub fn with_security(security: &SecurityConfig) -> Self {
        Self {
            allow_external_http: security.allow_external_http,
        }
    }

    pub fn validate_url(&self, url: &str) -> Result<()> {
        validate_external_url(url, self.allow_external_http)
    }

    pub fn open_external<R: Runtime>(&self, app: &AppHandle<R>, url: &str) -> Result<()> {
        self.validate_url(url)?;
        app.opener()
            .open_url(url.trim(), None::<String>)
            .map_err(|error| FrameworkError::Internal(error.to_string()))
    }
}

impl Default for BrowserService {
    fn default() -> Self {
        Self::new()
    }
}

pub fn validate_external_url(url: &str, allow_external_http: bool) -> Result<()> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(FrameworkError::ValidationFailed(
            "external url must not be empty".to_string(),
        ));
    }

    if trimmed.chars().any(char::is_whitespace) {
        return Err(FrameworkError::ValidationFailed(
            "external url must not contain whitespace".to_string(),
        ));
    }

    let Some((scheme, _rest)) = trimmed.split_once(':') else {
        return Err(FrameworkError::ValidationFailed(
            "external url must include a scheme".to_string(),
        ));
    };

    let normalized_scheme = scheme.to_ascii_lowercase();
    let allowed = matches!(normalized_scheme.as_str(), "mailto" | "tel")
        || (allow_external_http && matches!(normalized_scheme.as_str(), "http" | "https"));
    if allowed {
        return Ok(());
    }

    Err(FrameworkError::PolicyDenied {
        resource: scheme.to_string(),
        reason: if matches!(normalized_scheme.as_str(), "http" | "https") {
            "external http access is disabled by security policy".to_string()
        } else {
            "external url scheme is not allowed".to_string()
        },
    })
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use super::BrowserService;
    use crate::framework::config::SecurityConfig;

    #[test]
    fn browser_service_rejects_unsafe_urls() {
        let service = BrowserService::new();

        assert!(service.validate_url("https://sdk.work").is_ok());
        assert!(service.validate_url("javascript:alert(1)").is_err());
        assert!(service.validate_url("file:///C:/Windows").is_err());
    }

    #[test]
    fn browser_service_denies_http_when_external_http_is_disabled() {
        let service = BrowserService::with_security(&SecurityConfig {
            allow_external_http: false,
            ..SecurityConfig::default()
        });

        assert!(service.validate_url("https://sdk.work").is_err());
        assert!(service.validate_url("http://localhost:3000").is_err());
        assert!(service.validate_url("mailto:team@sdk.work").is_ok());
        assert!(service.validate_url("tel:+8613800138000").is_ok());
    }
}
