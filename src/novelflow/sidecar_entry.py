"""PyInstaller entry point for the Novelflow API sidecar."""

from novelflow.ffmpeg_path import configure_ffmpeg_env

configure_ffmpeg_env()

from novelflow.api.__main__ import main

if __name__ == "__main__":
    main()
