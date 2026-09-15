use crate::state::AppState;

#[tauri::command]
pub fn open_external(
    url: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .context
        .services
        .browser
        .open_external(&app, &url)
        .map_err(|error| error.to_string())
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use crate::framework::{config::SecurityConfig, services::browser::BrowserService};

    #[test]
    fn validates_allowed_external_url_schemes() {
        let service = BrowserService::new();

        assert!(service.validate_url("https://sdk.work").is_ok());
        assert!(service.validate_url("http://localhost:3000").is_ok());
        assert!(service.validate_url("mailto:team@sdk.work").is_ok());
        assert!(service.validate_url("tel:+8613800138000").is_ok());
        assert!(service.validate_url("file:///c:/windows").is_err());
        assert!(service.validate_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_missing_or_unsafe_external_urls() {
        let service = BrowserService::new();

        assert!(service.validate_url("").is_err());
        assert!(service.validate_url("   ").is_err());
        assert!(service.validate_url("sdk.work").is_err());
        assert!(service.validate_url("https://sdk work").is_err());
    }

    #[test]
    fn rejects_http_urls_when_external_http_is_disabled() {
        let service = BrowserService::with_security(&SecurityConfig {
            allow_external_http: false,
            ..SecurityConfig::default()
        });

        assert!(service.validate_url("https://sdk.work").is_err());
        assert!(service.validate_url("http://localhost:3000").is_err());
        assert!(service.validate_url("mailto:team@sdk.work").is_ok());
    }
}
