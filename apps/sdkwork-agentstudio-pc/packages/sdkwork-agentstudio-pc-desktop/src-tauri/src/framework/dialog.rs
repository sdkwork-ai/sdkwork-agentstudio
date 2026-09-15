use std::path::{Path, PathBuf};

use tauri::Runtime;
use tauri_plugin_dialog::FileDialogBuilder;

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogFilter {
    pub name: String,
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectFilesOptions {
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub directory: bool,
    pub title: Option<String>,
    pub default_path: Option<String>,
    #[serde(default)]
    pub filters: Vec<DialogFilter>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileOptions {
    pub title: Option<String>,
    pub default_path: Option<String>,
    #[serde(default)]
    pub filters: Vec<DialogFilter>,
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use std::path::PathBuf;

    use super::{
        resolve_default_file_name, resolve_starting_directory, sanitize_filter_extensions,
    };

    #[test]
    fn sanitizes_dialog_filter_extensions() {
        let extensions =
            sanitize_filter_extensions(&[".JSON".to_string(), " txt ".to_string(), "".to_string()]);

        assert_eq!(extensions, vec!["json".to_string(), "txt".to_string()]);
    }

    #[test]
    fn resolves_starting_directory_from_file_like_default_path() {
        let starting_directory =
            resolve_starting_directory(Some("C:/sdkwork/workspace/export/report.json"));

        assert_eq!(
            starting_directory,
            Some(PathBuf::from("C:/sdkwork/workspace/export"))
        );
    }

    #[test]
    fn prefers_filename_from_default_file_path() {
        let file_name = resolve_default_file_name(
            "backup.zip",
            Some("C:/sdkwork/workspace/export/archive.json"),
        );

        assert_eq!(file_name.as_deref(), Some("archive.json"));
    }

    #[test]
    fn falls_back_to_explicit_filename_when_default_path_is_directory() {
        let file_name =
            resolve_default_file_name("backup.zip", Some("C:/sdkwork/workspace/export"));

        assert_eq!(file_name.as_deref(), Some("backup.zip"));
    }
}

pub fn apply_dialog_options<R: Runtime>(
    mut dialog: FileDialogBuilder<R>,
    title: Option<&str>,
    default_path: Option<&str>,
    filters: &[DialogFilter],
) -> FileDialogBuilder<R> {
    if let Some(value) = normalize_text(title) {
        dialog = dialog.set_title(value);
    }

    if let Some(directory) = resolve_starting_directory(default_path) {
        dialog = dialog.set_directory(directory);
    }

    for filter in filters {
        if let Some(name) = normalize_text(Some(filter.name.as_str())) {
            let normalized_extensions = sanitize_filter_extensions(&filter.extensions);
            if normalized_extensions.is_empty() {
                continue;
            }

            let extension_refs = normalized_extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            dialog = dialog.add_filter(name, &extension_refs);
        }
    }

    dialog
}

pub fn sanitize_filter_extensions(extensions: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();

    for extension in extensions {
        let sanitized = extension
            .trim()
            .trim_start_matches('.')
            .to_ascii_lowercase();
        if sanitized.is_empty() || normalized.contains(&sanitized) {
            continue;
        }

        normalized.push(sanitized);
    }

    normalized
}

pub fn resolve_starting_directory(default_path: Option<&str>) -> Option<PathBuf> {
    let path = normalize_path(default_path)?;
    if path.exists() {
        if path.is_dir() {
            return Some(path);
        }

        return path.parent().map(Path::to_path_buf);
    }

    if is_probable_file_path(&path) {
        return path.parent().map(Path::to_path_buf);
    }

    Some(path)
}

pub fn resolve_default_file_name(filename: &str, default_path: Option<&str>) -> Option<String> {
    let normalized_filename = normalize_text(Some(filename));
    let Some(path) = normalize_path(default_path) else {
        return normalized_filename;
    };

    if path.exists() {
        if path.is_file() {
            return path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned());
        }

        return normalized_filename;
    }

    if is_probable_file_path(&path) {
        return path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned());
    }

    normalized_filename
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_path(value: Option<&str>) -> Option<PathBuf> {
    normalize_text(value).map(PathBuf::from)
}

fn is_probable_file_path(path: &Path) -> bool {
    path.extension().is_some()
}
