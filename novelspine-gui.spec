# -*- mode: python ; coding: utf-8 -*-
# Folder build (onedir) — much faster startup than single-file extract.
from PyInstaller.utils.hooks import collect_all

block_cipher = None

datas = [
    ("src/novelspine/assets/icon.ico", "novelspine/assets"),
    ("src/novelspine/assets/icon.png", "novelspine/assets"),
]
binaries = []
hiddenimports = [
    "novelspine",
    "novelspine.gui",
    "novelspine.convert",
    "novelspine.refine",
    "novelspine.paths",
    "novelspine.pdf_extract",
    "novelspine.pdf_italics",
    "novelspine.text_cleanup",
    "novelspine.gui_theme",
    "novelspine.audiobook",
    "novelspine.book_structure",
    "novelspine.tts_engines",
    "novelspine.tts_voices",
    "novelspine.tts_config",
    "novelspine.tts_text",
    "novelspine.audio_merge",
    "novelspine.user_paths",
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
    ["src/novelspine/gui_entry.py"],
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
        "tkinter.test",
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
    name="novelspine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
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
    name="novelspine",
)
