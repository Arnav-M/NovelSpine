"""Native folder picker for browser dev mode (local sidecar only)."""

from __future__ import annotations

from pathlib import Path


def pick_folder_dialog() -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return None

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update_idletasks()
    folder = filedialog.askdirectory(parent=root)
    root.destroy()
    if not folder:
        return None
    return str(Path(folder).resolve())
