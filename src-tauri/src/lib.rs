use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, State};

/// Files handed to us by the OS (Finder "Open With", dock drop) before the
/// webview has finished booting. The frontend drains this on mount.
#[derive(Default)]
struct PendingOpen(Mutex<Vec<String>>);

#[derive(Serialize)]
struct FileMeta {
    path: String,
    name: String,
    dir: String,
    size: u64,
    writable: bool,
}

fn library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {dir:?}: {e}"))?;
    Ok(dir.join("signatures.json"))
}

fn is_writable(path: &Path) -> bool {
    if path.exists() {
        std::fs::OpenOptions::new().write(true).open(path).is_ok()
    } else {
        path.parent()
            .map(|p| p.metadata().map(|m| !m.permissions().readonly()).unwrap_or(false))
            .unwrap_or(false)
    }
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(Response::new(bytes))
}

/// Binary write. The payload arrives as a raw IPC body (no JSON array round
/// trip, which matters for multi-megabyte PDFs); the destination path travels
/// in a base64url header so it survives non-ASCII filenames.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let encoded = request
        .headers()
        .get("x-target-path")
        .ok_or_else(|| "missing x-target-path header".to_string())?
        .to_str()
        .map_err(|e| format!("bad header: {e}"))?;
    let decoded = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|e| format!("bad base64 path: {e}"))?;
    let path = String::from_utf8(decoded).map_err(|e| format!("path is not utf-8: {e}"))?;

    let data = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(_) => return Err("expected a raw binary body".into()),
    };

    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create {parent:?}: {e}"))?;
    }

    // Write to a sibling temp file first so an interrupted save cannot destroy
    // the user's original document.
    let tmp = target.with_extension(format!(
        "{}.inkwell-tmp",
        target.extension().and_then(|e| e.to_str()).unwrap_or("pdf")
    ));
    std::fs::write(&tmp, data).map_err(|e| format!("Could not write {tmp:?}: {e}"))?;
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save {path}: {e}")
    })?;
    Ok(())
}

#[tauri::command]
fn file_meta(path: String) -> Result<FileMeta, String> {
    let p = PathBuf::from(&path);
    let meta = std::fs::metadata(&p).map_err(|e| format!("Could not stat {path}: {e}"))?;
    Ok(FileMeta {
        name: p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled.pdf")
            .to_string(),
        dir: p
            .parent()
            .and_then(|d| d.to_str())
            .unwrap_or("")
            .to_string(),
        size: meta.len(),
        writable: is_writable(&p),
        path,
    })
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn load_library(app: tauri::AppHandle) -> Result<String, String> {
    let path = library_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Could not read signature library: {e}")),
    }
}

#[tauri::command]
fn save_library(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = library_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("Could not write signature library: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Could not save signature library: {e}"))
}

#[tauri::command]
fn reveal(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Could not reveal {path}: {e}"))
}

#[tauri::command]
fn open_external(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| format!("Could not open {path}: {e}"))
}

#[tauri::command]
fn take_pending_open(state: State<'_, PendingOpen>) -> Vec<String> {
    let mut guard = state.0.lock().unwrap();
    std::mem::take(&mut *guard)
}

/// Normalises whatever the OS handed us (`file://` URL or plain path) into a
/// filesystem path, ignoring anything that is not a readable PDF.
fn normalise_opened(raw: &str) -> Option<String> {
    let path = if let Some(stripped) = raw.strip_prefix("file://") {
        percent_decode(stripped)
    } else {
        raw.to_string()
    };
    let p = Path::new(&path);
    if p.is_file() {
        Some(path)
    } else {
        None
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let pkg = app.package_info().clone();

    let app_menu = SubmenuBuilder::new(app, &pkg.name)
        .item(&PredefinedMenuItem::about(
            app,
            Some(&format!("About {}", pkg.name)),
            Some(
                AboutMetadata {
                    name: Some(pkg.name.clone()),
                    version: Some(pkg.version.to_string()),
                    copyright: Some("Inkwell — sign and fill PDFs".into()),
                    ..Default::default()
                },
            ),
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("save-as", "Save As…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("close-doc", "Close Document")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(
            &MenuItemBuilder::with_id("undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("redo", "Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("delete-selection", "Delete Selected")
                .accelerator("CmdOrCtrl+Backspace")
                .build(app)?,
        )
        .build()?;

    let insert_menu = SubmenuBuilder::new(app, "Insert")
        .item(
            &MenuItemBuilder::with_id("tool-signature", "Signature")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("tool-text", "Text")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("tool-date", "Today's Date")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("tool-check", "Checkmark")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("manage-signatures", "Manage Signatures…")
                .accelerator("CmdOrCtrl+Shift+M")
                .build(app)?,
        )
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("zoom-in", "Zoom In")
                .accelerator("CmdOrCtrl+Plus")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom-out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom-fit", "Fit Width")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("toggle-sidebar", "Toggle Page Thumbnails")
                .accelerator("CmdOrCtrl+Alt+S")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &insert_menu,
            &view_menu,
            &window_menu,
        ])
        .build()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingOpen::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            file_meta,
            path_exists,
            load_library,
            save_library,
            reveal,
            open_external,
            take_pending_open,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let menu = build_menu(&handle)?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                let id = event.id().0.as_str();
                // Predefined items handle themselves; everything else is an
                // app-level command the frontend owns.
                let _ = app.emit("menu", id);
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Inkwell")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| normalise_opened(u.as_str()))
                    .collect();
                if !paths.is_empty() {
                    if let Some(state) = app.try_state::<PendingOpen>() {
                        state.0.lock().unwrap().extend(paths.clone());
                    }
                    let _ = app.emit("open-file", paths);
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_focus();
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
