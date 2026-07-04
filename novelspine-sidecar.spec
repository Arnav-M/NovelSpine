# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the novelspine API sidecar (Tauri external binary).

from PyInstaller.utils.hooks import collect_all

block_cipher = None

datas = [
    ("src/novelspine/assets/icon.ico", "novelspine/assets"),
    ("src/novelspine/assets/icon.png", "novelspine/assets"),
]
binaries = []
hiddenimports = [
    "novelspine",
    "novelspine.api",
    "novelspine.api.app",
    "novelspine.api.jobs",
    "novelspine.api.library",
    "novelspine.api.prefs",
    "novelspine.api.schemas",
    "novelspine.convert",
    "novelspine.refine",
    "novelspine.paths",
    "novelspine.pdf_extract",
    "novelspine.pdf_italics",
    "novelspine.text_cleanup",
    "novelspine.audiobook",
    "novelspine.book_structure",
    "novelspine.tts_engines",
    "novelspine.tts_voices",
    "novelspine.tts_config",
    "novelspine.tts_text",
    "novelspine.audio_merge",
    "novelspine.user_paths",
    "novelspine.cover_art",
    "novelspine.player",
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
    ["src/novelspine/sidecar_entry.py"],
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
    name="novelspine-sidecar",
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
    icon="src/novelspine/assets/icon.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="novelspine-sidecar",
)
