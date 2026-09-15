use crate::framework::dialog::{resolve_default_file_name, resolve_starting_directory};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri_plugin_dialog::FilePath;

#[derive(Clone, Debug, Default)]
pub struct DialogService;

impl DialogService {
    pub fn new() -> Self {
        Self
    }

    #[allow(dead_code)]
    pub fn resolve_starting_directory(&self, default_path: Option<&str>) -> Option<PathBuf> {
        resolve_starting_directory(default_path)
    }

    pub fn resolve_default_file_name(
        &self,
        filename: &str,
        default_path: Option<&str>,
    ) -> Option<String> {
        resolve_default_file_name(filename, default_path)
    }

    pub fn normalize_selected_paths(&self, paths: Vec<FilePath>) -> Result<Vec<String>, String> {
        paths
            .into_iter()
            .map(|path| {
                path.into_path()
                    .map(|value| value.to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .collect()
    }

    pub fn write_blob_to_path(&self, path: &Path, content: &[u8]) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        fs::write(path, content).map_err(|error| error.to_string())
    }
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use super::DialogService;

    #[test]
    fn dialog_service_keeps_filename_and_directory_resolution_behavior() {
        let service = DialogService::new();

        assert_eq!(
            service.resolve_starting_directory(Some("C:/sdkwork/workspace/export/report.json")),
            Some(std::path::PathBuf::from("C:/sdkwork/workspace/export"))
        );
        assert_eq!(
            service.resolve_default_file_name(
                "backup.zip",
                Some("C:/sdkwork/workspace/export/archive.json")
            ),
            Some("archive.json".to_string())
        );
    }
}
