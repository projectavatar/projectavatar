#!/usr/bin/env python3
"""
CLI wrapper for the Python avatar output filter.

Usage (pipe mode):
  echo "[avatar:...] Hello" | python cli.py --relay https://... --token abc123
  cat response.txt | python cli.py --config filter-config.json

The filter reads from stdin and writes clean text to stdout.
Avatar events are pushed to the relay synchronously (max 5s timeout).
Errors go to stderr and never affect stdout.
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Allow running as a script without installing the package
sys.path.insert(0, str(Path(__file__).parent))
from filter import FilterConfig, StreamingAvatarFilter

BUFFER_LIMIT = 200  # chars to buffer while searching for the avatar tag


def load_config_file(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def build_config(args: argparse.Namespace) -> FilterConfig:
    config_data: dict = {}

    # Config file first (lowest priority)
    if args.config:
        config_data.update(load_config_file(args.config))

    # Env vars override config file
    if os.getenv("AVATAR_RELAY_URL"):
        config_data["relay_url"] = os.environ["AVATAR_RELAY_URL"]
    if os.getenv("AVATAR_TOKEN"):
        config_data["token"] = os.environ["AVATAR_TOKEN"]

    # CLI flags have highest priority
    if args.relay:
        config_data["relay_url"] = args.relay
    if args.token:
        config_data["token"] = args.token
    if args.disabled:
        config_data["enabled"] = False

    relay_url = config_data.get("relay_url")
    token = config_data.get("token")

    if not relay_url:
        print("[avatar-filter] Error: --relay <url> is required", file=sys.stderr)
        sys.exit(1)
    if not token:
        print("[avatar-filter] Error: --token <token> is required", file=sys.stderr)
        sys.exit(1)

    return FilterConfig(
        relay_url=relay_url,
        token=token,
        enabled=config_data.get("enabled", True),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="avatar-filter",
        description="Strip avatar tags from agent responses and push to relay",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  echo "[avatar:{...}] Hello" | python cli.py --relay https://relay.projectavatar.io --token abc123
  cat response.txt | python cli.py --config ./filter-config.json

Config file format:
  {"relay_url": "https://...", "token": "...", "enabled": true}

Environment variables:
  AVATAR_RELAY_URL     Relay base URL
  AVATAR_TOKEN         Avatar token
  AVATAR_DEBUG         Enable verbose logging
        """,
    )
    parser.add_argument("-r", "--relay", help="Relay base URL")
    parser.add_argument("-t", "--token", help="Avatar token")
    parser.add_argument("-c", "--config", help="JSON config file path")
    parser.add_argument("--disabled", action="store_true", help="Passthrough mode (no relay push)")
    parser.add_argument("--debug", action="store_true", help="Verbose stderr logging")

    args = parser.parse_args()

    if args.debug:
        os.environ["AVATAR_DEBUG"] = "1"
        import logging
        logging.basicConfig(level=logging.DEBUG, stream=sys.stderr)

    config = build_config(args)

    if args.debug:
        token_preview = config.token[:8] + "..."
        print(
            f"[avatar-filter] relay={config.relay_url} token={token_preview} enabled={config.enabled}",
            file=sys.stderr,
        )

    filter_ = StreamingAvatarFilter(config, buffer_limit=BUFFER_LIMIT)

    try:
        # Read stdin line by line to avoid loading entire response into memory
        first_line = True
        for line in sys.stdin:
            # StreamingAvatarFilter expects raw text with newlines intact
            # readline already includes the \n; just feed it through
            chunk = line if not first_line else line
            first_line = False
            for clean in filter_.process_chunk(chunk):
                sys.stdout.write(clean)
                sys.stdout.flush()

        for clean in filter_.flush():
            sys.stdout.write(clean)
            sys.stdout.flush()

    except BrokenPipeError:
        # stdout closed (e.g. piped to `head`) — exit cleanly
        sys.exit(0)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
