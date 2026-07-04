"""Run the NovelSpine API sidecar: python -m novelspine.api"""

from __future__ import annotations

import argparse


def main() -> None:
    from novelspine.ffmpeg_path import configure_ffmpeg_env

    configure_ffmpeg_env()

    parser = argparse.ArgumentParser(description="NovelSpine API sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run("novelspine.api.app:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
