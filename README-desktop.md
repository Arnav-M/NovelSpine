# Novelflow Desktop

Hybrid desktop app: **Tauri 2** shell + **React** UI + **FastAPI** Python sidecar.

Convert PDF novels to readable markdown and chapter-marked audiobooks — same pipeline as the CLI, with a modern UI and HTML5 audio playback.

## For end users (download & run)

1. Download **`Novelflow-Setup-x.x.x-x64.exe`** from [GitHub Releases](https://github.com/Arnav-M/Novelflow/releases) (or from the `release/` folder after building locally).
2. Run the installer — no Python or Node required.
3. Launch **Novelflow** from the Start menu.

Everything (PDF conversion, TTS, ffmpeg encoding, playback) is bundled in the installer.

## Architecture

```
React UI (apps/web)  →  HTTP/SSE  →  FastAPI sidecar (src/novelflow/api)  →  novelflow core
        ↑
   Tauri 2 shell (src-tauri) spawns sidecar on port 8765
```

| Layer | Location | Role |
|-------|----------|------|
| UI | `apps/web/` | Document, Audiobook, and Player tabs |
| API | `src/novelflow/api/` | Jobs, prefs, library scan, voice list |
| Sidecar binary | `src-tauri/binaries/` | PyInstaller bundle for release builds |
| Legacy GUI | `src/novelflow/gui*.py` | **Deprecated** Tkinter app (kept for reference) |

## Prerequisites

| Tool | Required for | Install |
|------|----------------|---------|
| **Python 3.10+** | API sidecar, PDF/TTS pipeline | [python.org](https://www.python.org/) |
| **Node.js 18+** | React UI | [nodejs.org](https://nodejs.org/) |
| **ffmpeg** | Audiobook encoding | [ffmpeg.org](https://ffmpeg.org/) — add to PATH |
| **Rust** | `npm run tauri` only | [rustup.rs](https://rustup.rs/) — **not needed for browser dev** |
| **PyInstaller** | Release sidecar binary only | `pip install -e ".[build]"` — use `python -m PyInstaller`, not bare `pyinstaller` |

## Install

From the project root (`Novelflow-desktop`):

```bash
pip install -e ".[audiobook,api,dev]"
npm install
```

Optional extras:

```bash
pip install -e ".[desktop]"   # shorthand for audiobook + api
pip install -e ".[gui]"       # legacy Tkinter GUI only (pygame + tkinterdnd2)
pip install -e ".[build]"     # PyInstaller for release sidecar
```

## Development

### Recommended — single command (no Rust)

Starts the Python API and Vite dev server together. Open http://localhost:5174 (5173 if FlashMon isn’t running).

```bash
npm run start
```

This is equivalent to two terminals:

```bash
npm run sidecar    # python -m novelflow.api --port 8765
npm run dev        # Vite on :5174 (falls back if busy)
```

Drag-and-drop works in the browser. Native file dialogs require the Tauri shell (see below).

### Full Tauri dev (requires Rust)

1. Install Rust: https://rustup.rs/ (restart the terminal after install; verify with `cargo --version`).

2. Build the sidecar binary (PyInstaller is **not** on PATH by default on Windows — use the module form):

   ```bash
   pip install -e ".[audiobook,api,build]"
   npm run build:sidecar:win
   ```

   Or manually:

   ```bash
   python -m PyInstaller novelflow-sidecar.spec
   copy dist\novelflow-sidecar\novelflow-sidecar.exe src-tauri\binaries\novelflow-sidecar-x86_64-pc-windows-msvc.exe
   ```

3. Run Tauri:

   ```bash
   npm run tauri
   ```

## Troubleshooting

### `pyinstaller` is not recognized

PyInstaller is installed as a Python module but its Scripts folder may not be on PATH. Always use:

```bash
python -m PyInstaller novelflow-sidecar.spec
```

Or run `npm run build:sidecar:win` which handles the copy step.

### `cargo metadata` / program not found

Rust is not installed. Either:

- **Use browser dev:** `npm run start` (no Rust needed), or
- **Install Rust:** https://rustup.rs/ then retry `npm run tauri`

### Port 5173 / 5174 already in use

Another dev server (often FlashMon) may be on 5173. Novelflow defaults to **5174**. If both are busy, Vite picks the next free port — check the terminal for the actual URL.

To free a port on Windows:

```powershell
netstat -ano | findstr :5173
taskkill /PID <pid> /F
```

### API offline in the UI

The React app expects the sidecar on **http://127.0.0.1:8765**. Start it with `npm run sidecar` or `npm run start` before opening the UI.

### Scripts not on PATH (`novelflow-api.exe` warning)

Use module form:

```bash
python -m novelflow.api --port 8765
```

## Tests

```bash
python -m pytest tests/test_api.py -v
```

## Production build

One command packages everything for Windows users:

```bash
npm run package:win
```

Output lands in **`release/`**:

| File | Who it's for |
|------|----------------|
| `Novelflow-Setup-3.0.0-x64.exe` | **Most users** - double-click to install |
| `Novelflow-3.0.0-x64.msi` | IT / silent deploy |

To publish on GitHub: tag a release (`git tag v3.0.0 && git push origin v3.0.0`) - the workflow in `.github/workflows/release.yml` builds and attaches these files automatically.

Manual steps (same as `package:win`):

1. Build the web UI:

   ```bash
   npm run build
   ```

2. Build the sidecar with PyInstaller:

   ```bash
   npm run build:sidecar:win
   ```

3. Build the desktop installer:

   ```bash
   npm run tauri:build
   ```

## Accessibility

Novelflow Desktop is built for **Windows screen readers** (Narrator, NVDA, JAWS) via WebView2 UI Automation. The React UI uses ARIA landmarks, labeled controls, live regions for job progress, keyboard navigation, visible focus rings, and high-contrast (`forced-colors`) styling.

### Navigation

- **Skip link** — Tab once after launch to jump to main content.
- **Main tabs** — Document, Audiobook, and Player. Use **Left/Right arrow** on the tab bar to move and activate tabs; **Home/End** jump to first/last tab.
- **Settings** — Header button opens a focus-trapped dialog; **Escape** closes and returns focus.

### Player keyboard shortcuts

Active on the **Player** tab when focus is not in a text field or open dialog:

| Key | Action |
|-----|--------|
| Space | Play / pause |
| Left arrow | Back 10 seconds |
| Right arrow | Forward 10 seconds |
| `[` | Previous chapter |
| `]` | Next chapter |
| `?` | Open shortcuts help |

The book timeline scrubber supports **Left/Right** (±5 s or 1% of book), **Home**, and **End**. Chapter list supports **Up/Down** and **Enter** to jump.

### Manual test checklist (Narrator)

1. Launch the app — hear API status and skip link.
2. **Document** tab — choose or drop a file, convert; hear progress and completion announcements.
3. **Audiobook** tab — select voice/sections, create audiobook; hear estimate updates and job outcome.
4. **Player** tab — select library item, play, seek with timeline and shortcuts, move chapters with keyboard.
5. Open **Settings** and shortcuts help — verify Tab stays inside, Escape closes.

Turn **Scan mode off** in forms; use Scan mode for reading static content.

### Known limits

- Cover art in the player is decorative (no alt text).
- Drag-and-drop is supplementary; use **Choose file** / **Browse** if pointer access is difficult.
- Some color cues (status pill, progress tone) are paired with text for screen readers.

## Player audio

The React **Player** tab uses the HTML5 `<audio>` element (via `convertFileSrc` in Tauri). The legacy Tkinter player used pygame; that code remains under `src/novelflow/gui_player_tab.py` but is not used by this app.

M4B/M4A playback depends on the OS webview codec support. MP3 chapter folders work everywhere.

## API endpoints (local only)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| GET/PUT | `/prefs` | User settings |
| GET/PUT | `/resume` | Playback bookmarks |
| GET | `/voices` | TTS voice list |
| GET | `/sections` | Book section manifest |
| GET | `/library` | Scan audiobook folder |
| GET | `/chapters` | Chapter markers + playable path |
| POST | `/jobs/convert` | PDF → markdown job |
| POST | `/jobs/audiobook` | Audiobook synthesis job |
| GET | `/jobs/{id}/events` | SSE progress stream |

## Legacy Tkinter GUI

The original GUI is still installable:

```bash
pip install -e ".[gui]"
novelflow-gui
```

It is **deprecated** in favor of this desktop app. Source files (`gui.py`, `gui_*_tab.py`) are retained for compatibility but receive no new features.
