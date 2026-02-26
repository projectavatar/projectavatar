"""
Avatar output filter — Python implementation.

Feature parity with the Node.js filter. Intercepts agent responses, extracts
the [avatar:{...}] tag, strips it from the visible response, and forwards the
event to the relay.

The avatar is cosmetic. Filter failures MUST NOT affect the user's experience
with the agent. Every operation that could fail is wrapped to guarantee clean
text is always returned.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from typing import AsyncGenerator, Generator, Optional, Tuple

import httpx

logger = logging.getLogger("avatar_filter")
if os.getenv("AVATAR_DEBUG"):
    logging.basicConfig(level=logging.DEBUG, stream=sys.stderr)


# ─── Schema ──────────────────────────────────────────────────────────────────

@dataclass
class AvatarEvent:
    emotion: str
    action: str
    prop: str = "none"
    intensity: str = "medium"

    def to_dict(self) -> dict:
        return {
            "emotion": self.emotion,
            "action": self.action,
            "prop": self.prop,
            "intensity": self.intensity,
        }


@dataclass
class FilterConfig:
    relay_url: str
    token: str
    enabled: bool = True


# ─── Regex ───────────────────────────────────────────────────────────────────

# Same pattern as Node.js implementation (re.MULTILINE makes ^ match line starts)
#
# Pattern breakdown:
#   ^           – Start of a line (with MULTILINE)
#   \[avatar:   – Literal tag prefix
#   ({[^}]+})   – Capture group: JSON object (no nesting — our schema has none)
#   \]          – Literal tag suffix
#   [ \t]*\n?   – Optional trailing horizontal whitespace + optional newline
#
AVATAR_TAG_PATTERN = re.compile(
    r"^\[avatar:(\{[^}]+\})\][ \t]*\n?",
    re.MULTILINE,
)


# ─── Core filter ─────────────────────────────────────────────────────────────

def extract_avatar_tag(text: str) -> Tuple[str, Optional[AvatarEvent]]:
    """
    Extract and strip the avatar tag from a complete (non-streaming) response.

    Returns (clean_text, avatar_event | None).
    Never raises — malformed tags are ignored and the original text is returned.
    """
    try:
        match = AVATAR_TAG_PATTERN.search(text)
    except Exception:
        return text, None

    if not match:
        return text, None

    try:
        data = json.loads(match.group(1))
    except (json.JSONDecodeError, ValueError):
        # Malformed JSON — return original text unmodified
        return text, None

    emotion = data.get("emotion")
    action = data.get("action")

    if not isinstance(emotion, str) or not isinstance(action, str):
        return text, None

    event = AvatarEvent(
        emotion=emotion,
        action=action,
        prop=data.get("prop", "none"),
        intensity=data.get("intensity", "medium"),
    )

    # Strip the matched tag (and trailing whitespace/newline)
    clean_text = text[: match.start()] + text[match.end() :]
    clean_text = clean_text.lstrip()

    return clean_text, event


async def push_to_relay(config: FilterConfig, event: AvatarEvent) -> None:
    """
    Push an avatar event to the relay. Fire-and-forget — never raises.
    A failed push is logged but never allowed to block the response pipeline.
    """
    if not config.enabled:
        return

    url = f"{config.relay_url}/push/{config.token}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, json=event.to_dict())
    except Exception as exc:
        logger.debug("Failed to push avatar event: %s", exc)


def push_to_relay_sync(config: FilterConfig, event: AvatarEvent) -> None:
    """Synchronous version of push_to_relay for non-async contexts."""
    if not config.enabled:
        return

    url = f"{config.relay_url}/push/{config.token}"
    try:
        with httpx.Client(timeout=5.0) as client:
            client.post(url, json=event.to_dict())
    except Exception as exc:
        logger.debug("Failed to push avatar event (sync): %s", exc)


async def filter_response(text: str, config: FilterConfig) -> str:
    """
    Filter a complete (non-streaming) response.

    Extracts the avatar tag, pushes to relay asynchronously, and returns clean text.
    The relay push is fire-and-forget — this returns as soon as clean text is ready.
    """
    try:
        clean_text, event = extract_avatar_tag(text)
        if event:
            # Don't await — fire and forget
            import asyncio
            asyncio.ensure_future(push_to_relay(config, event))
        return clean_text
    except Exception:
        return text


def filter_response_sync(text: str, config: FilterConfig) -> str:
    """
    Synchronous version for non-async contexts.
    The relay push blocks briefly (max 5s timeout).
    """
    try:
        clean_text, event = extract_avatar_tag(text)
        if event:
            push_to_relay_sync(config, event)
        return clean_text
    except Exception:
        return text


# ─── Streaming filter ─────────────────────────────────────────────────────────

class StreamingAvatarFilter:
    """
    Processes a stream of text chunks from an LLM, extracting the avatar tag
    from the start of the stream without buffering the entire response.

    Usage (sync generator):

        filter = StreamingAvatarFilter(config, buffer_limit=200)
        for chunk in llm_stream:
            for clean in filter.process_chunk(chunk):
                print(clean, end="", flush=True)
        for clean in filter.flush():
            print(clean, end="", flush=True)

    Usage (async generator):

        async for clean in filter.process_chunk_async(chunk):
            ...
    """

    def __init__(self, config: FilterConfig, buffer_limit: int = 200) -> None:
        self.config = config
        self.buffer_limit = buffer_limit
        self._buffer = ""
        self._tag_resolved = False

    def process_chunk(self, chunk: str) -> Generator[str, None, None]:
        """
        Process a single chunk. Yields clean text chunks (may be zero, one,
        or more chunks depending on buffering state).
        """
        if self._tag_resolved:
            yield chunk
            return

        self._buffer += chunk

        clean_text, event = extract_avatar_tag(self._buffer)

        if event:
            self._tag_resolved = True
            push_to_relay_sync(self.config, event)
            self._buffer = ""
            if clean_text:
                yield clean_text
            return

        if len(self._buffer) > self.buffer_limit:
            # Exceeded window — give up, flush as-is
            self._tag_resolved = True
            buffered = self._buffer
            self._buffer = ""
            yield buffered

        # Still buffering — no output yet

    def flush(self) -> Generator[str, None, None]:
        """Flush any remaining buffered content."""
        if self._buffer:
            remaining = self._buffer
            self._buffer = ""

            if not self._tag_resolved:
                # One final extraction attempt
                clean_text, event = extract_avatar_tag(remaining)
                if event:
                    push_to_relay_sync(self.config, event)
                    if clean_text:
                        yield clean_text
                else:
                    yield remaining
                self._tag_resolved = True
            else:
                yield remaining

    async def process_chunk_async(self, chunk: str) -> AsyncGenerator[str, None]:
        """Async version of process_chunk (relay push is async)."""
        if self._tag_resolved:
            yield chunk
            return

        self._buffer += chunk

        clean_text, event = extract_avatar_tag(self._buffer)

        if event:
            self._tag_resolved = True
            await push_to_relay(self.config, event)
            self._buffer = ""
            if clean_text:
                yield clean_text
            return

        if len(self._buffer) > self.buffer_limit:
            self._tag_resolved = True
            buffered = self._buffer
            self._buffer = ""
            yield buffered

    async def flush_async(self) -> AsyncGenerator[str, None]:
        """Async version of flush."""
        if self._buffer:
            remaining = self._buffer
            self._buffer = ""

            if not self._tag_resolved:
                clean_text, event = extract_avatar_tag(remaining)
                if event:
                    await push_to_relay(self.config, event)
                    if clean_text:
                        yield clean_text
                else:
                    yield remaining
                self._tag_resolved = True
            else:
                yield remaining

    @property
    def resolved(self) -> bool:
        return self._tag_resolved
