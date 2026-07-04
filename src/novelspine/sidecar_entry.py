"""PyInstaller entry point for the NovelSpine API sidecar."""

from novelspine.ffmpeg_path import configure_ffmpeg_env

configure_ffmpeg_env()

from novelspine.api.__main__ import main

if __name__ == "__main__":
    main()
