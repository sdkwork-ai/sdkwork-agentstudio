#[cfg(not(windows))]
use crate::framework::FrameworkError;
use crate::framework::{paths::AppPaths, Result};
use crate::internal_cli::RUN_OPENCLAW_CLI_FLAG;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

const PATH_BLOCK_START: &str = "# >>> agent-studio-openclaw >>>";
const PATH_BLOCK_END: &str = "# <<< agent-studio-openclaw <<<";
const MANAGED_PROFILE_FILE_NAME: &str = "profile.sh";

#[derive(Clone, Debug, Default)]
pub struct PathRegistrationService;

impl PathRegistrationService {
    pub fn new() -> Self {
        Self
    }

    pub fn install_openclaw_shims(&self, paths: &AppPaths) -> Result<()> {
        fs::create_dir_all(&paths.user_bin_dir)?;
        let launcher_path = resolve_launcher_executable_path()?;

        write_if_changed(
            &paths.user_bin_dir.join("openclaw.cmd"),
            &render_cmd_shim(&launcher_path),
        )?;
        write_if_changed(
            &paths.user_bin_dir.join("openclaw.ps1"),
            &render_powershell_shim(&launcher_path),
        )?;
        let unix_shim = paths.user_bin_dir.join("openclaw");
        write_if_changed(&unix_shim, &render_unix_shim(&launcher_path))?;
        set_executable_if_supported(&unix_shim)?;

        Ok(())
    }

    pub fn ensure_user_bin_on_path(&self, paths: &AppPaths) -> Result<()> {
        self.ensure_install_local_user_bin_on_path(paths)?;

        if cfg!(test) {
            return Ok(());
        }

        #[cfg(windows)]
        ensure_windows_path_contains(&paths.user_bin_dir)?;

        #[cfg(not(windows))]
        ensure_shell_profiles_source(&paths.user_root.join(MANAGED_PROFILE_FILE_NAME))?;

        Ok(())
    }

    pub fn ensure_install_local_user_bin_on_path(&self, paths: &AppPaths) -> Result<()> {
        let managed_profile = paths.user_root.join(MANAGED_PROFILE_FILE_NAME);
        let current_profile = fs::read_to_string(&managed_profile).unwrap_or_default();
        let next_profile = upsert_path_block(&current_profile, &paths.user_bin_dir);
        write_if_changed(&managed_profile, &next_profile)?;

        Ok(())
    }
}

fn render_cmd_shim(launcher_path: &Path) -> String {
    format!(
        "@echo off\r\n\"{}\" {} %*\r\n",
        escape_cmd_value(&launcher_path.display().to_string()),
        RUN_OPENCLAW_CLI_FLAG,
    )
}

fn render_powershell_shim(launcher_path: &Path) -> String {
    format!(
        "& '{}' '{}' @Args\r\n",
        escape_powershell_path(launcher_path),
        RUN_OPENCLAW_CLI_FLAG,
    )
}

fn render_unix_shim(launcher_path: &Path) -> String {
    format!(
        "#!/bin/sh\nexec '{}' '{}' \"$@\"\n",
        escape_unix_path(launcher_path),
        RUN_OPENCLAW_CLI_FLAG,
    )
}

fn upsert_path_block(current: &str, user_bin_dir: &Path) -> String {
    let block = format!(
        "{PATH_BLOCK_START}\nexport PATH=\"{}:$PATH\"\n{PATH_BLOCK_END}\n",
        user_bin_dir.display()
    );

    if let (Some(start), Some(end)) = (current.find(PATH_BLOCK_START), current.find(PATH_BLOCK_END))
    {
        let end_index = end + PATH_BLOCK_END.len();
        let mut updated = String::new();
        updated.push_str(&current[..start]);
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(&block);
        let suffix = current[end_index..].trim_start_matches(['\r', '\n']);
        if !suffix.is_empty() {
            updated.push('\n');
            updated.push_str(suffix);
            if !updated.ends_with('\n') {
                updated.push('\n');
            }
        }
        return updated;
    }

    let mut updated = current.trim_end().to_string();
    if !updated.is_empty() {
        updated.push_str("\n\n");
    }
    updated.push_str(&block);
    updated
}

fn write_if_changed(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    if fs::read_to_string(path).ok().as_deref() == Some(content) {
        return Ok(());
    }

    fs::write(path, content)?;
    Ok(())
}

#[cfg(unix)]
fn set_executable_if_supported(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_executable_if_supported(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(windows)]
fn ensure_windows_path_contains(user_bin_dir: &Path) -> Result<()> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let environment = hkcu
        .open_subkey_with_flags(
            "Environment",
            winreg::enums::KEY_READ | winreg::enums::KEY_WRITE,
        )
        .or_else(|_| hkcu.create_subkey("Environment").map(|(key, _)| key))?;
    let current = environment
        .get_value::<String, _>("Path")
        .unwrap_or_default();
    let updated = merge_windows_path(&current, user_bin_dir);

    if updated != current {
        environment.set_value("Path", &updated)?;
    }

    Ok(())
}

#[cfg(not(windows))]
fn ensure_windows_path_contains(_user_bin_dir: &Path) -> Result<()> {
    Ok(())
}

#[cfg(not(windows))]
fn ensure_shell_profiles_source(managed_profile: &Path) -> Result<()> {
    let home_dir = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| FrameworkError::NotFound("HOME environment variable".to_string()))?;

    for file_name in [
        ".profile",
        ".bash_profile",
        ".bashrc",
        ".zprofile",
        ".zshrc",
    ] {
        let profile_path = home_dir.join(file_name);
        let current = fs::read_to_string(&profile_path).unwrap_or_default();
        let next = upsert_source_block(&current, managed_profile);
        write_if_changed(&profile_path, &next)?;
    }

    Ok(())
}

#[cfg(windows)]
#[allow(dead_code)]
fn ensure_shell_profiles_source(_managed_profile: &Path) -> Result<()> {
    Ok(())
}

fn merge_windows_path(current: &str, user_bin_dir: &Path) -> String {
    let needle = user_bin_dir.to_string_lossy().to_string();
    let mut entries = current
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .filter(|entry| !entry.eq_ignore_ascii_case(needle.as_str()))
        .collect::<Vec<_>>();

    entries.insert(0, needle);
    entries.join(";")
}

#[cfg_attr(windows, allow(dead_code))]
fn upsert_source_block(current: &str, managed_profile: &Path) -> String {
    let block = format!(
        "{PATH_BLOCK_START}\n. \"{}\"\n{PATH_BLOCK_END}\n",
        managed_profile.display()
    );

    if let (Some(start), Some(end)) = (current.find(PATH_BLOCK_START), current.find(PATH_BLOCK_END))
    {
        let end_index = end + PATH_BLOCK_END.len();
        let mut updated = String::new();
        updated.push_str(&current[..start]);
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(&block);
        let suffix = current[end_index..].trim_start_matches(['\r', '\n']);
        if !suffix.is_empty() {
            updated.push('\n');
            updated.push_str(suffix);
            if !updated.ends_with('\n') {
                updated.push('\n');
            }
        }
        return updated;
    }

    let mut updated = current.trim_end().to_string();
    if !updated.is_empty() {
        updated.push_str("\n\n");
    }
    updated.push_str(&block);
    updated
}

fn escape_powershell_path(path: &Path) -> String {
    escape_powershell_value(&path.display().to_string())
}

fn escape_unix_path(path: &Path) -> String {
    escape_unix_value(&path.display().to_string())
}

fn escape_cmd_value(value: &str) -> String {
    value.replace('"', "\"\"")
}

fn escape_powershell_value(value: &str) -> String {
    value.replace('\'', "''")
}

fn escape_unix_value(value: &str) -> String {
    value.replace('\'', "'\"'\"'")
}

fn resolve_launcher_executable_path() -> Result<PathBuf> {
    env::current_exe().map_err(Into::into)
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use super::PathRegistrationService;
    use crate::framework::paths::resolve_paths_for_root;
    use std::{fs, path::PathBuf};

    #[test]
    fn writes_openclaw_cli_shims_for_windows_shells() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let service = PathRegistrationService::new();

        service
            .install_openclaw_shims(&paths)
            .expect("install shims");

        let cmd = fs::read_to_string(paths.user_bin_dir.join("openclaw.cmd")).expect("cmd shim");
        let ps1 = fs::read_to_string(paths.user_bin_dir.join("openclaw.ps1")).expect("ps1 shim");
        let unix = fs::read_to_string(paths.user_bin_dir.join("openclaw")).expect("unix shim");

        assert!(cmd.contains("--run-openclaw-cli"));
        assert!(!cmd.contains("OPENCLAW_GATEWAY_TOKEN"));
        assert!(ps1.contains("--run-openclaw-cli"));
        assert!(!ps1.contains("OPENCLAW_GATEWAY_TOKEN"));
        assert!(unix.contains("--run-openclaw-cli"));
        assert!(!unix.contains("OPENCLAW_GATEWAY_TOKEN"));
    }

    #[test]
    fn updates_shell_profile_exports_idempotently() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let service = PathRegistrationService::new();

        service
            .ensure_user_bin_on_path(&paths)
            .expect("first path registration");
        service
            .ensure_user_bin_on_path(&paths)
            .expect("second path registration");

        let profile = fs::read_to_string(paths.user_root.join("profile.sh")).expect("profile");
        let export_line = format!(
            "export PATH=\"{}:$PATH\"",
            paths.user_bin_dir.to_string_lossy()
        );

        assert_eq!(profile.matches("# >>> agent-studio-openclaw >>>").count(), 1);
        assert_eq!(profile.matches("# <<< agent-studio-openclaw <<<").count(), 1);
        assert_eq!(profile.matches(export_line.as_str()).count(), 1);
    }

    #[test]
    fn windows_path_registration_prioritizes_embedded_openclaw_bin_directory() {
        let user_bin_dir = PathBuf::from(r"C:\Users\admin\.sdkwork\crawstudio\bin");
        let current = format!(
            r"C:\Program Files\OpenClaw\bin;{};C:\Windows\System32",
            user_bin_dir.display()
        );

        let merged = super::merge_windows_path(&current, &user_bin_dir);
        let entries = merged.split(';').collect::<Vec<_>>();

        assert_eq!(
            entries.first().copied(),
            Some(user_bin_dir.to_string_lossy().as_ref()),
            "the embedded openclaw bin dir should take precedence on PATH"
        );
        assert_eq!(
            entries
                .iter()
                .filter(|entry| entry.eq_ignore_ascii_case(user_bin_dir.to_string_lossy().as_ref()))
                .count(),
            1,
            "the embedded openclaw bin dir should not be duplicated on PATH"
        );
    }
}
