use crate::framework::{
    config::SecurityConfig,
    install_records::{
        read_install_record, resolve_openclaw_install_records_home_candidates, InstallRecord,
        InstallRecordStatus,
    },
    paths::AppPaths,
    FrameworkError, Result,
};
use serde_json::Value;
use std::{
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct ExecutionPolicy {
    default_working_directory: PathBuf,
    managed_roots: Vec<PathBuf>,
    allow_custom_process_cwd: bool,
}

impl ExecutionPolicy {
    #[cfg(test)]
    pub fn for_paths(paths: &AppPaths) -> Result<Self> {
        Self::for_paths_with_security(paths, &SecurityConfig::default())
    }

    pub fn for_paths_with_security(paths: &AppPaths, security: &SecurityConfig) -> Result<Self> {
        let default_working_directory = canonicalize_directory(&paths.data_dir)?;
        let managed_roots = paths
            .managed_roots()
            .into_iter()
            .map(|root| canonicalize_directory(&root))
            .collect::<Result<Vec<_>>>()?;

        Ok(Self {
            default_working_directory,
            managed_roots,
            allow_custom_process_cwd: security.allow_custom_process_cwd,
        })
    }

    pub fn validate_command_spawn(&self, command: &str, args: &[String]) -> Result<()> {
        let _ = self;
        validate_command_spawn(command, args)
    }

    pub fn validate_profile_command_spawn(&self, command: &str, args: &[String]) -> Result<()> {
        let _ = self;
        validate_profile_command_spawn(command, args)
    }

    pub fn resolve_working_directory(&self, working_directory: Option<&Path>) -> Result<PathBuf> {
        let directory = match working_directory {
            Some(directory) => canonicalize_directory(directory)?,
            None => self.default_working_directory.clone(),
        };

        if self
            .managed_roots
            .iter()
            .any(|root| directory.starts_with(root))
        {
            return Ok(directory);
        }

        if working_directory.is_some() && self.allow_custom_process_cwd {
            return Ok(directory);
        }

        Err(FrameworkError::PolicyViolation {
            path: directory,
            reason: "path is outside managed runtime directories".to_string(),
        })
    }

    pub fn sanitize_environment<I>(&self, entries: I) -> Vec<(OsString, OsString)>
    where
        I: IntoIterator<Item = (OsString, OsString)>,
    {
        let _ = self;

        entries
            .into_iter()
            .filter(|(key, _)| is_allowed_environment_key(key))
            .collect()
    }
}

pub fn managed_path_roots_snapshot(paths: &AppPaths) -> Vec<PathBuf> {
    managed_path_roots(paths)
}

pub fn resolve_managed_path(paths: &AppPaths, candidate: &Path) -> Result<PathBuf> {
    let raw = if candidate.as_os_str().is_empty() {
        paths.data_dir.clone()
    } else if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        paths.data_dir.join(candidate)
    };

    let normalized = normalize_path(&raw);
    let allowed = managed_path_roots(paths)
        .into_iter()
        .any(|root| normalized.starts_with(&root));

    if allowed {
        return Ok(normalized);
    }

    Err(FrameworkError::PolicyViolation {
        path: normalized,
        reason: "path is outside managed runtime directories".to_string(),
    })
}

pub fn resolve_user_tooling_config_path(paths: &AppPaths, candidate: &Path) -> Result<PathBuf> {
    let host_home = resolve_host_home_directory(paths);
    let raw = if candidate.as_os_str().is_empty() {
        host_home
    } else if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        host_home.join(candidate)
    };
    let normalized = normalize_path(&raw);
    let allowed = user_tooling_config_files(paths);

    if allowed
        .iter()
        .any(|allowed_path| normalized == *allowed_path)
    {
        return Ok(normalized);
    }

    Err(FrameworkError::PolicyViolation {
        path: normalized,
        reason: "path is outside allowlisted user tooling config files".to_string(),
    })
}

pub fn ensure_parent_directory(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    Ok(())
}

pub fn ensure_not_managed_root(paths: &AppPaths, candidate: &Path) -> Result<()> {
    let normalized = normalize_path(candidate);
    let is_root = managed_path_roots(paths)
        .into_iter()
        .any(|root| normalized == root);

    if is_root {
        return Err(FrameworkError::PolicyViolation {
            path: normalized,
            reason: "managed root directories cannot be modified directly".to_string(),
        });
    }

    Ok(())
}

pub fn validate_command_spawn(command: &str, _args: &[String]) -> Result<()> {
    let normalized = command.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(FrameworkError::ValidationFailed(
            "command must not be empty".to_string(),
        ));
    }

    let allowed = allowed_spawn_commands()
        .iter()
        .any(|candidate| normalized == *candidate);

    if allowed {
        return Ok(());
    }

    Err(FrameworkError::PolicyDenied {
        resource: command.to_string(),
        reason: "command spawn is not allowed".to_string(),
    })
}

pub fn validate_profile_command_spawn(command: &str, args: &[String]) -> Result<()> {
    let normalized = command.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(FrameworkError::ValidationFailed(
            "command must not be empty".to_string(),
        ));
    }

    if is_allowed_managed_openclaw_node_spawn(&normalized, args)
        || is_allowed_dingtalk_connector_installer_spawn(&normalized, args)
    {
        return Ok(());
    }

    validate_command_spawn(command, args)
}

pub fn allowed_spawn_commands_snapshot() -> Vec<String> {
    allowed_spawn_commands()
        .iter()
        .map(|value| value.to_string())
        .collect()
}

fn allowed_spawn_commands() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &[
            "cmd",
            "cmd.exe",
            "powershell",
            "powershell.exe",
            "where",
            "where.exe",
        ]
    }

    #[cfg(not(windows))]
    {
        &["sh", "/bin/sh", "which", "/usr/bin/which"]
    }
}

fn is_allowed_managed_openclaw_node_spawn(command: &str, args: &[String]) -> bool {
    if !is_node_command(command) {
        return false;
    }

    let Some(cli_path) = args.first() else {
        return false;
    };
    let normalized_cli_path = cli_path.replace('\\', "/").to_ascii_lowercase();
    let is_openclaw_cli = normalized_cli_path.ends_with(
        "/runtime/package/node_modules/openclaw/openclaw.mjs",
    );
    if !is_openclaw_cli {
        return false;
    }

    matches!(
        &args[1..],
        [channels, add, channel_flag, channel_id]
            if channels == "channels"
                && add == "add"
                && channel_flag == "--channel"
                && channel_id == "qqbot"
    ) || matches!(
        &args[1..],
        [channels, login, channel_flag, channel_id]
            if channels == "channels"
                && login == "login"
                && channel_flag == "--channel"
                && (channel_id == "openclaw-weixin" || channel_id == "feishu")
    )
}

fn is_allowed_dingtalk_connector_installer_spawn(command: &str, args: &[String]) -> bool {
    if !is_npx_command(command) {
        return false;
    }

    matches!(
        args,
        [yes, package, install]
            if yes == "-y"
                && package == "@dingtalk-real-ai/dingtalk-connector"
                && install == "install"
    )
}

fn is_node_command(command: &str) -> bool {
    let normalized = command.replace('\\', "/");

    matches!(
        normalized.as_str(),
        "node" | "node.exe" | "/usr/bin/node" | "/usr/local/bin/node"
    ) || normalized.ends_with("/node")
        || normalized.ends_with("/node.exe")
}

fn is_npx_command(command: &str) -> bool {
    let normalized = command.replace('\\', "/");

    matches!(
        normalized.as_str(),
        "npx" | "npx.cmd" | "npx.exe" | "/usr/bin/npx" | "/usr/local/bin/npx"
    ) || normalized.ends_with("/npx")
        || normalized.ends_with("/npx.cmd")
        || normalized.ends_with("/npx.exe")
}

fn managed_path_roots(paths: &AppPaths) -> Vec<PathBuf> {
    let mut roots = paths
        .managed_roots()
        .into_iter()
        .map(|root| normalize_path(&root))
        .collect::<Vec<_>>();

    for root in discover_registered_openclaw_roots(paths) {
        let normalized = normalize_path(&root);
        if !roots.iter().any(|existing| existing == &normalized) {
            roots.push(normalized);
        }
    }

    roots
}

fn user_tooling_config_files(paths: &AppPaths) -> Vec<PathBuf> {
    let home = resolve_host_home_directory(paths);
    let mut files = vec![
        home.join(".codex").join("config.toml"),
        home.join(".codex").join("auth.json"),
        home.join(".claude").join("settings.json"),
        home.join(".config").join("opencode").join("opencode.json"),
        home.join(".config").join("opencode").join("opencode.jsonc"),
        home.join(".config").join("opencode").join("auth.json"),
        home.join(".local")
            .join("share")
            .join("opencode")
            .join("auth.json"),
        home.join("AppData")
            .join("Roaming")
            .join("opencode")
            .join("opencode.json"),
        home.join("AppData")
            .join("Roaming")
            .join("opencode")
            .join("opencode.jsonc"),
        home.join("AppData")
            .join("Roaming")
            .join("opencode")
            .join("auth.json"),
        home.join("Library")
            .join("Application Support")
            .join("opencode")
            .join("auth.json"),
    ];

    for file in &mut files {
        *file = normalize_path(file);
    }

    files.sort();
    files.dedup();
    files
}

fn resolve_host_home_directory(paths: &AppPaths) -> PathBuf {
    let normalized_user_root = normalize_path(&paths.user_root);
    let mut current = Some(normalized_user_root.as_path());

    while let Some(path) = current {
        if path.file_name().and_then(|value| value.to_str()) == Some(".sdkwork") {
            if let Some(parent) = path.parent() {
                return parent.to_path_buf();
            }
        }

        current = path.parent();
    }

    normalized_user_root
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(normalized_user_root)
}

fn discover_registered_openclaw_roots(paths: &AppPaths) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    for installer_home in resolve_openclaw_install_records_home_candidates(&paths.user_root) {
        let Some(record) = read_installed_openclaw_install_record(&installer_home) else {
            continue;
        };
        let Some(config_path) = discover_registered_openclaw_config_path(paths, &record) else {
            continue;
        };

        push_unique_path(
            &mut roots,
            normalize_path(&resolve_openclaw_state_root(&config_path)),
        );

        for root in discover_explicit_openclaw_config_roots(&config_path) {
            push_unique_path(&mut roots, normalize_path(&root));
        }
    }

    roots
}

fn read_installed_openclaw_install_record(installer_home: &Path) -> Option<InstallRecord> {
    read_install_record(installer_home.to_string_lossy().as_ref(), "openclaw")
        .ok()
        .flatten()
        .filter(|record| matches!(record.status, InstallRecordStatus::Installed))
}

fn discover_registered_openclaw_config_path(
    paths: &AppPaths,
    record: &InstallRecord,
) -> Option<PathBuf> {
    let config_path = canonical_openclaw_config_file_path(paths);
    match record.manifest_name.as_str() {
        "openclaw-wsl" | "openclaw-podman" | "openclaw-docker" => None,
        _ if config_path.is_file() => Some(config_path),
        _ => None,
    }
}

fn canonical_openclaw_config_file_path(paths: &AppPaths) -> PathBuf {
    paths
        .kernel_paths("openclaw")
        .map(|kernel| kernel.config_file)
        .expect("canonical openclaw config path")
}

fn resolve_openclaw_state_root(config_path: &Path) -> PathBuf {
    let Some(parent) = config_path.parent() else {
        return config_path.to_path_buf();
    };

    if parent
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("config"))
    {
        return parent.parent().unwrap_or(parent).to_path_buf();
    }

    parent.to_path_buf()
}

fn resolve_openclaw_user_root(config_path: &Path) -> PathBuf {
    let state_root = resolve_openclaw_state_root(config_path);
    state_root.parent().unwrap_or(&state_root).to_path_buf()
}

fn discover_explicit_openclaw_config_roots(config_path: &Path) -> Vec<PathBuf> {
    let content = match fs::read_to_string(config_path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let root = match json5::from_str::<Value>(&content) {
        Ok(root) => root,
        Err(_) => return Vec::new(),
    };

    let mut resolved_roots = Vec::new();

    if let Some(workspace) = read_json_path_string(&root, &["agents", "defaults", "workspace"]) {
        if let Some(path) = resolve_explicit_openclaw_path(config_path, workspace) {
            push_unique_path(&mut resolved_roots, path);
        }
    }

    for entry in root
        .get("agents")
        .and_then(|value| value.get("list"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(workspace) = entry
            .get("workspace")
            .and_then(Value::as_str)
            .map(str::trim)
        {
            if let Some(path) = resolve_explicit_openclaw_path(config_path, workspace) {
                push_unique_path(&mut resolved_roots, path);
            }
        }

        if let Some(agent_dir) = entry.get("agentDir").and_then(Value::as_str).map(str::trim) {
            if let Some(path) = resolve_explicit_openclaw_path(config_path, agent_dir) {
                if let Some(parent) = path.parent() {
                    push_unique_path(&mut resolved_roots, parent.to_path_buf());
                } else {
                    push_unique_path(&mut resolved_roots, path);
                }
            }
        }
    }

    resolved_roots
}

fn read_json_path_string<'a>(value: &'a Value, segments: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for segment in segments {
        current = current.get(*segment)?;
    }

    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn resolve_explicit_openclaw_path(config_path: &Path, raw_path: &str) -> Option<PathBuf> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed == "~" {
        return Some(normalize_path(&resolve_openclaw_user_root(config_path)));
    }

    if let Some(stripped) = trimmed.strip_prefix("~/") {
        return Some(normalize_path(
            &resolve_openclaw_user_root(config_path).join(stripped),
        ));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Some(normalize_path(&path));
    }

    None
}

fn push_unique_path(target: &mut Vec<PathBuf>, value: PathBuf) {
    if !target.iter().any(|existing| existing == &value) {
        target.push(value);
    }
}

fn canonicalize_directory(path: &Path) -> Result<PathBuf> {
    let metadata = fs::metadata(path).map_err(|_| {
        FrameworkError::NotFound(format!("working directory not found: {}", path.display()))
    })?;
    if !metadata.is_dir() {
        return Err(FrameworkError::ValidationFailed(format!(
            "working directory is not a directory: {}",
            path.display()
        )));
    }

    fs::canonicalize(path).map_err(FrameworkError::from)
}

fn is_allowed_environment_key(key: &std::ffi::OsStr) -> bool {
    let key = key.to_string_lossy();

    #[cfg(windows)]
    return matches_ci(
        &key,
        &["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"],
    );

    #[cfg(not(windows))]
    return matches_ci(&key, &["PATH", "HOME", "TMPDIR", "LANG"]);
}

fn matches_ci(value: &str, allowed: &[&str]) -> bool {
    allowed
        .iter()
        .any(|candidate| value.eq_ignore_ascii_case(candidate))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(Path::new(std::path::MAIN_SEPARATOR_STR)),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(value) => normalized.push(value),
        }
    }

    normalized
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use super::{
        ensure_not_managed_root, resolve_managed_path, resolve_user_tooling_config_path,
        validate_command_spawn, validate_profile_command_spawn, ExecutionPolicy,
    };
    use crate::framework::{
        config::SecurityConfig,
        install_records::{
            write_install_record, EffectiveRuntimePlatform, InstallControlLevel, InstallRecord,
            InstallRecordStatus, InstallScope, SupportedPlatform,
        },
        paths::resolve_paths_for_root,
    };
    use std::ffi::OsString;

    #[test]
    fn resolves_relative_path_inside_data_dir() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        let resolved = resolve_managed_path(&paths, std::path::Path::new("notes/readme.txt"))
            .expect("resolved path");

        assert_eq!(resolved, paths.data_dir.join("notes").join("readme.txt"));
    }

    #[test]
    fn rejects_path_outside_managed_roots() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let outside = root.path().join("outside.txt");

        let error = resolve_managed_path(&paths, &outside).expect_err("policy failure");

        assert!(error
            .to_string()
            .contains("outside managed runtime directories"));
    }

    #[test]
    fn resolves_allowlisted_user_tooling_config_file() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let candidate = root.path().join(".codex").join("config.toml");

        let resolved =
            resolve_user_tooling_config_path(&paths, &candidate).expect("allowlisted tooling path");

        assert_eq!(resolved, candidate);
    }

    #[test]
    fn rejects_non_allowlisted_user_tooling_file() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let candidate = root.path().join(".codex").join("history.json");

        let error = resolve_user_tooling_config_path(&paths, &candidate)
            .expect_err("non-allowlisted tooling path should be denied");

        assert!(error
            .to_string()
            .contains("allowlisted user tooling config files"));
    }

    #[test]
    fn allows_config_backed_local_external_openclaw_paths() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let install_root = root.path().join("external-install");
        let work_root = root.path().join("external-work");
        let data_root = root.path().join("external-data");
        let config_path = paths.openclaw_config_file.clone();
        let workspace_file = root
            .path()
            .join("agent-market")
            .join("workspace")
            .join("orchestrator")
            .join("AGENTS.md");
        let workspace_root = workspace_file
            .parent()
            .and_then(|path| path.parent())
            .expect("workspace root")
            .to_path_buf();
        let installer_home = paths.user_root.join("openclaw-install");

        std::fs::create_dir_all(&install_root).expect("create install root");
        std::fs::create_dir_all(&work_root).expect("create work root");
        std::fs::create_dir_all(&data_root).expect("create data root");
        std::fs::create_dir_all(config_path.parent().expect("config parent"))
            .expect("create config parent");
        std::fs::write(
            &config_path,
            format!(
                r#"{{
  agents: {{
    defaults: {{
      workspace: "{}",
    }},
  }},
}}
"#,
                workspace_root.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .expect("write external config");

        let record = InstallRecord {
            schema_version: "1.0".to_string(),
            software_name: "openclaw".to_string(),
            manifest_name: "openclaw-pnpm".to_string(),
            manifest_path: "./manifests/openclaw-pnpm.hub.yaml".to_string(),
            manifest_source_input: "bundled-registry".to_string(),
            manifest_source_kind: "registry".to_string(),
            platform: SupportedPlatform::Windows,
            effective_runtime_platform: EffectiveRuntimePlatform::Windows,
            installer_home: installer_home.to_string_lossy().into_owned(),
            install_scope: InstallScope::User,
            install_root: install_root.to_string_lossy().into_owned(),
            work_root: work_root.to_string_lossy().into_owned(),
            bin_dir: install_root.join("bin").to_string_lossy().into_owned(),
            data_root: data_root.to_string_lossy().into_owned(),
            install_control_level: InstallControlLevel::Partial,
            status: InstallRecordStatus::Installed,
            installed_at: Some("2026-03-21T00:00:00Z".to_string()),
            updated_at: "2026-03-21T00:00:00Z".to_string(),
        };

        write_install_record(
            installer_home.to_string_lossy().as_ref(),
            "openclaw",
            &record,
        )
        .expect("write install record");

        let managed_roots = super::managed_path_roots_snapshot(&paths);

        let resolved_config = resolve_managed_path(&paths, &config_path).unwrap_or_else(|error| {
            panic!("resolve config-backed path: {error}; managed_roots={managed_roots:?}");
        });
        let resolved_workspace =
            resolve_managed_path(&paths, &workspace_file).unwrap_or_else(|error| {
                panic!("resolve workspace path: {error}; managed_roots={managed_roots:?}");
            });

        assert_eq!(resolved_config, config_path);
        assert_eq!(resolved_workspace, workspace_file);
    }

    #[test]
    fn rejects_legacy_local_external_openclaw_config_candidates() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let install_root = root.path().join("external-install");
        let work_root = root.path().join("external-work");
        let data_root = root.path().join("external-data");
        let legacy_config_path = data_root.join("config").join("openclaw.json");
        let workspace_file = root
            .path()
            .join("agent-market")
            .join("workspace")
            .join("orchestrator")
            .join("AGENTS.md");
        let workspace_root = workspace_file
            .parent()
            .and_then(|path| path.parent())
            .expect("workspace root")
            .to_path_buf();
        let installer_home = paths.user_root.join("openclaw-install");

        std::fs::create_dir_all(&install_root).expect("create install root");
        std::fs::create_dir_all(&work_root).expect("create work root");
        std::fs::create_dir_all(&data_root).expect("create data root");
        std::fs::create_dir_all(legacy_config_path.parent().expect("legacy config parent"))
            .expect("create legacy config parent");
        std::fs::write(
            &legacy_config_path,
            format!(
                r#"{{
  agents: {{
    defaults: {{
      workspace: "{}",
    }},
  }},
}}
"#,
                workspace_root.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .expect("write legacy external config");

        let record = InstallRecord {
            schema_version: "1.0".to_string(),
            software_name: "openclaw".to_string(),
            manifest_name: "openclaw-docker".to_string(),
            manifest_path: "./manifests/openclaw-docker.hub.yaml".to_string(),
            manifest_source_input: "bundled-registry".to_string(),
            manifest_source_kind: "registry".to_string(),
            platform: SupportedPlatform::Windows,
            effective_runtime_platform: EffectiveRuntimePlatform::Windows,
            installer_home: installer_home.to_string_lossy().into_owned(),
            install_scope: InstallScope::User,
            install_root: install_root.to_string_lossy().into_owned(),
            work_root: work_root.to_string_lossy().into_owned(),
            bin_dir: install_root.join("bin").to_string_lossy().into_owned(),
            data_root: data_root.to_string_lossy().into_owned(),
            install_control_level: InstallControlLevel::Partial,
            status: InstallRecordStatus::Installed,
            installed_at: Some("2026-03-21T00:00:00Z".to_string()),
            updated_at: "2026-03-21T00:00:00Z".to_string(),
        };

        write_install_record(
            installer_home.to_string_lossy().as_ref(),
            "openclaw",
            &record,
        )
        .expect("write install record");

        let config_error =
            resolve_managed_path(&paths, &legacy_config_path).expect_err("legacy config denied");
        let workspace_error =
            resolve_managed_path(&paths, &workspace_file).expect_err("legacy workspace denied");

        assert!(config_error
            .to_string()
            .contains("outside managed runtime directories"));
        assert!(workspace_error
            .to_string()
            .contains("outside managed runtime directories"));
    }

    #[test]
    fn rejects_direct_managed_root_mutation() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        let error =
            ensure_not_managed_root(&paths, &paths.data_dir).expect_err("managed root protected");

        assert!(error
            .to_string()
            .contains("managed root directories cannot be modified directly"));
    }

    #[test]
    fn rejects_spawn_for_unknown_command() {
        let error =
            validate_command_spawn("python", &["-c".to_string(), "print('hi')".to_string()])
                .expect_err("policy should deny unknown command");

        assert!(error.to_string().contains("not allowed"));
    }

    #[cfg(windows)]
    #[test]
    fn allows_spawn_for_powershell() {
        validate_command_spawn(
            "powershell.exe",
            &["-Command".to_string(), "Write-Output hi".to_string()],
        )
        .expect("powershell should be allowed for installer execution");
    }

    #[test]
    fn public_spawn_rejects_profile_only_managed_openclaw_channel_binding_node_profiles() {
        let error = validate_command_spawn(
            "node",
            &[
                "C:\\Users\\admin\\.sdkwork\\crawstudio\\runtimes\\openclaw\\runtime\\package\\node_modules\\openclaw\\openclaw.mjs".to_string(),
                "channels".to_string(),
                "login".to_string(),
                "--channel".to_string(),
                "feishu".to_string(),
            ],
        )
        .expect_err("public process commands must not execute profile-only binding commands");

        assert!(error.to_string().contains("not allowed"));
    }

    #[test]
    fn allows_only_managed_openclaw_channel_binding_node_profiles_for_internal_profiles() {
        validate_profile_command_spawn(
            "C:\\Program Files\\nodejs\\node.exe",
            &[
                "C:\\Users\\admin\\.sdkwork\\crawstudio\\runtimes\\openclaw\\runtime\\package\\node_modules\\openclaw\\openclaw.mjs".to_string(),
                "channels".to_string(),
                "login".to_string(),
                "--channel".to_string(),
                "feishu".to_string(),
            ],
        )
        .expect("managed OpenClaw channel binding CLI should be allowed");

        let error = validate_profile_command_spawn(
            "node",
            &[
                "C:\\tmp\\arbitrary.js".to_string(),
                "channels".to_string(),
                "login".to_string(),
                "--channel".to_string(),
                "feishu".to_string(),
            ],
        )
        .expect_err("arbitrary Node scripts must stay blocked");

        assert!(error.to_string().contains("not allowed"));
    }

    #[test]
    fn public_spawn_rejects_profile_only_official_dingtalk_connector_installer() {
        let error = validate_command_spawn(
            "npx.cmd",
            &[
                "-y".to_string(),
                "@dingtalk-real-ai/dingtalk-connector".to_string(),
                "install".to_string(),
            ],
        )
        .expect_err("public process commands must not execute profile-only installers");

        assert!(error.to_string().contains("not allowed"));
    }

    #[test]
    fn allows_only_official_dingtalk_connector_installer_npx_profile_for_internal_profiles() {
        validate_profile_command_spawn(
            "C:\\Program Files\\nodejs\\npx.cmd",
            &[
                "-y".to_string(),
                "@dingtalk-real-ai/dingtalk-connector".to_string(),
                "install".to_string(),
            ],
        )
        .expect("official DingTalk connector installer should be allowed");

        let error = validate_profile_command_spawn(
            "npx.cmd",
            &["-y".to_string(), "left-pad".to_string()],
        )
        .expect_err("arbitrary npx packages must stay blocked");

        assert!(error.to_string().contains("not allowed"));
    }

    #[test]
    fn rejects_path_openclaw_spawn_so_release_binding_uses_managed_runtime() {
        let error = validate_command_spawn(
            "openclaw",
            &["channels".to_string(), "add".to_string(), "--channel".to_string(), "qqbot".to_string()],
        )
        .expect_err("path openclaw should not be directly executable");

        assert!(error.to_string().contains("not allowed"));
    }

    #[test]
    fn resolves_managed_working_directory_to_canonical_path() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let nested = paths.data_dir.join("work").join("nested");
        std::fs::create_dir_all(&nested).expect("nested directory");
        let policy = ExecutionPolicy::for_paths(&paths).expect("policy");

        let resolved = policy
            .resolve_working_directory(Some(nested.as_path()))
            .expect("resolved cwd");

        assert_eq!(
            resolved,
            std::fs::canonicalize(&nested).expect("canonical cwd")
        );
    }

    #[test]
    fn defaults_working_directory_to_data_dir() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let policy = ExecutionPolicy::for_paths(&paths).expect("policy");

        let resolved = policy.resolve_working_directory(None).expect("default cwd");

        assert_eq!(
            resolved,
            std::fs::canonicalize(&paths.data_dir).expect("canonical data dir")
        );
    }

    #[test]
    fn rejects_working_directory_outside_managed_roots() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let outside = root.path().join("external");
        std::fs::create_dir_all(&outside).expect("outside dir");
        let policy = ExecutionPolicy::for_paths_with_security(
            &paths,
            &SecurityConfig {
                allow_custom_process_cwd: false,
                ..SecurityConfig::default()
            },
        )
        .expect("policy");

        let error = policy
            .resolve_working_directory(Some(outside.as_path()))
            .expect_err("outside cwd should be denied");

        assert!(error
            .to_string()
            .contains("outside managed runtime directories"));
    }

    #[test]
    fn allows_custom_working_directory_outside_managed_roots_when_enabled() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let outside = root.path().join("external");
        std::fs::create_dir_all(&outside).expect("outside dir");
        let policy = ExecutionPolicy::for_paths_with_security(
            &paths,
            &SecurityConfig {
                allow_custom_process_cwd: true,
                ..SecurityConfig::default()
            },
        )
        .expect("policy");

        let resolved = policy
            .resolve_working_directory(Some(outside.as_path()))
            .expect("outside cwd should be allowed");

        assert_eq!(
            resolved,
            std::fs::canonicalize(&outside).expect("canonical outside dir")
        );
    }

    #[test]
    fn sanitizes_environment_to_allow_list() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let policy = ExecutionPolicy::for_paths(&paths).expect("policy");

        let sanitized = policy.sanitize_environment(vec![
            (OsString::from("PATH"), OsString::from("path-value")),
            (OsString::from("SECRET_TOKEN"), OsString::from("hidden")),
            #[cfg(windows)]
            (OsString::from("SystemRoot"), OsString::from("C:\\Windows")),
            #[cfg(not(windows))]
            (OsString::from("LANG"), OsString::from("en_US.UTF-8")),
        ]);

        assert!(sanitized.iter().any(|(key, _)| key == "PATH"));
        assert!(!sanitized.iter().any(|(key, _)| key == "SECRET_TOKEN"));
    }
}
