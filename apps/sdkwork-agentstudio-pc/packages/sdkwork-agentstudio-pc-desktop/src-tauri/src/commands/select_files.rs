use crate::{framework::dialog::SelectFilesOptions, state::AppState};
use tauri::{Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use crate::framework::services::dialog::DialogService;
    use std::path::PathBuf;
    use tauri_plugin_dialog::FilePath;

    #[test]
    fn normalizes_dialog_file_paths() {
        let paths = DialogService::new()
            .normalize_selected_paths(vec![
                FilePath::Path(PathBuf::from("C:/sdkwork/demo.txt")),
                FilePath::Path(PathBuf::from("C:/sdkwork/data.json")),
            ])
            .expect("normalized paths");

        assert_eq!(paths.len(), 2);
        assert!(paths[0].ends_with("demo.txt"));
        assert!(paths[1].ends_with("data.json"));
    }
}

fn create_file_dialog<R: Runtime>(
    app: &tauri::AppHandle<R>,
    options: &SelectFilesOptions,
) -> FileDialogBuilder<R> {
    let dialog = crate::framework::dialog::apply_dialog_options(
        app.dialog().file(),
        options.title.as_deref().or(Some(if options.directory {
            "Select Folder"
        } else {
            "Select File"
        })),
        options.default_path.as_deref(),
        &options.filters,
    );
    if let Some(window) = app.get_webview_window("main") {
        return dialog.set_parent(&window);
    }

    dialog
}
#[tauri::command]
pub async fn select_files(
    options: Option<SelectFilesOptions>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let options = options.unwrap_or_default();
    let dialog = create_file_dialog(&app, &options);

    let selected = match (options.directory, options.multiple) {
        (true, true) => dialog.blocking_pick_folders().unwrap_or_default(),
        (true, false) => dialog
            .blocking_pick_folder()
            .map(|path| vec![path])
            .unwrap_or_default(),
        (false, true) => dialog.blocking_pick_files().unwrap_or_default(),
        (false, false) => dialog
            .blocking_pick_file()
            .map(|path| vec![path])
            .unwrap_or_default(),
    };

    state
        .context
        .services
        .dialog
        .normalize_selected_paths(selected)
}
