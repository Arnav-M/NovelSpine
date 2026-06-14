# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the Novelflow API sidecar (Tauri external binary).

from PyInstaller.utils.hooks import collect_all

block_cipher = None

datas = [
    ("src/novelflow/assets/icon.ico", "novelflow/assets"),
    ("src/novelflow/assets/icon.png", "novelflow/assets"),
]
binaries = []
hiddenimports = [
    "novelflow",
    "novelflow.api",
    "novelflow.api.app",
    "novelflow.api.jobs",
    "novelflow.api.library",
    "novelflow.api.prefs",
    "novelflow.api.schemas",
    "novelflow.convert",
    "novelflow.refine",
    "novelflow.paths",
    "novelflow.pdf_extract",
    "novelflow.pdf_italics",
    "novelflow.text_cleanup",
    "novelflow.audiobook",
    "novelflow.book_structure",
    "novelflow.tts_engines",
    "novelflow.tts_voices",
    "novelflow.tts_config",
    "novelflow.tts_text",
    "novelflow.audio_merge",
    "novelflow.user_paths",
    "novelflow.cover_art",
    "novelflow.player",
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "fastapi",
    "pydantic",
    "edge_tts",
]

for pkg in ("pymupdf",):
    try:
        collected = collect_all(pkg)
        datas += collected[0]
        binaries += collected[1]
        hiddenimports += collected[2]
    except Exception:
        pass

a = Analysis(
    ["src/novelflow/sidecar_entry.py"],
    pathex=["src"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "matplotlib",
        "pandas",
        "scipy",
        "pytest",
        "IPython",
        "notebook",
        "tkinter",
        "tkinter.test",
        "pygame",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="novelflow-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="src/novelflow/assets/icon.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="novelflow-sidecar",
)
