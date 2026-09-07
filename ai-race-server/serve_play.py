#!/usr/bin/env python3
"""Serve human vs human rooms. No LLM. Bind 0.0.0.0 and $PORT on Render."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from game import VERSION_BY_NAME
from multiplayer import TwoPlayerGame, play_setup_payload

ROOT = Path(__file__).resolve().parent


def resolve_site() -> Path:
    candidates = (
        ROOT.parent / "site" / "ai-race",
        ROOT / "output" / "site" / "ai-race",
    )
    for path in candidates:
        if (path / "index.html").is_file():
            return path
    raise SystemExit("Missing site/ai-race/index.html next to the server or at ../site/ai-race.")


SITE = resolve_site()
ROOM_TTL_SEC = 60 * 60
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

_rooms: dict[str, dict[str, Any]] = {}
_rooms_lock = threading.Lock()

DEFAULT_ORIGINS = (
    "http://127.0.0.1:8766",
    "http://localhost:8766",
    "https://cwrodriguez.com",
    "https://www.cwrodriguez.com",
)


def parse_args() -> argparse.Namespace:
    env_port = os.environ.get("PORT")
    default_port = int(env_port) if env_port else 8766
    parser = argparse.ArgumentParser(description="Serve human vs human AI-race rooms.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=default_port)
    return parser.parse_args()


def allowed_origins() -> set[str]:
    extra = (os.environ.get("PLAY_CORS_ORIGINS") or "").strip()
    origins = set(DEFAULT_ORIGINS)
    if extra:
        origins.update(item.strip() for item in extra.split(",") if item.strip())
    return origins


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def read_json(handler: SimpleHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or 0)
    raw = handler.rfile.read(length) if length else b"{}"
    try:
        data = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("JSON body must be an object.")
    return data


def make_code() -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))
        if code not in _rooms:
            return code
    raise RuntimeError("Could not allocate a room code.")


def expire_rooms(now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    dead = [code for code, room in _rooms.items() if now - room["touched"] > ROOM_TTL_SEC]
    for code in dead:
        _rooms.pop(code, None)


def touch(room: dict[str, Any]) -> None:
    room["touched"] = time.monotonic()


def room_payload(room: dict[str, Any], role: str, token: str) -> dict[str, Any]:
    seats = {seat: bool(room["seats"][seat]) for seat in ("lead", "lag")}
    waiting_join = [seat for seat, taken in seats.items() if not taken]
    return {
        "room": room["code"],
        "token": token,
        "role": role,
        "seats": seats,
        "waiting_for_join": waiting_join,
        "state": room["game"].snapshot_for(role),
    }


def get_room(code: str) -> dict[str, Any]:
    expire_rooms()
    room = _rooms.get(code.strip().upper())
    if not room:
        raise LookupError("This room expired or the server restarted. Create a new one.")
    return room


def role_for_token(room: dict[str, Any], token: str) -> str:
    role = room["tokens"].get(token)
    if not role:
        raise ValueError("Unknown player token for this room.")
    return role


def create_room(data: dict[str, Any]) -> dict[str, Any]:
    version = VERSION_BY_NAME.get(str(data.get("version") or ""))
    if version is None:
        raise ValueError("Unknown game scenario.")
    preferred = data.get("role")
    if preferred not in {"lead", "lag"}:
        preferred = "lead"
    token = secrets.token_hex(16)
    other = "lag" if preferred == "lead" else "lead"
    with _rooms_lock:
        expire_rooms()
        code = make_code()
        room = {
            "code": code,
            "game": TwoPlayerGame(version),
            "lock": threading.Lock(),
            "tokens": {token: preferred},
            "seats": {preferred: token, other: None},
            "touched": time.monotonic(),
        }
        _rooms[code] = room
        return room_payload(room, preferred, token)


def join_room(data: dict[str, Any]) -> dict[str, Any]:
    code = str(data.get("room") or "").strip().upper()
    token = str(data.get("token") or "")
    preferred = data.get("role")
    with _rooms_lock:
        room = get_room(code)
        with room["lock"]:
            touch(room)
            if token and token in room["tokens"]:
                return room_payload(room, room["tokens"][token], token)
            empty = [seat for seat in ("lead", "lag") if not room["seats"][seat]]
            if not empty:
                raise ValueError("This room is full.")
            if preferred in empty:
                role = preferred
            else:
                role = empty[0]
            new_token = secrets.token_hex(16)
            room["seats"][role] = new_token
            room["tokens"][new_token] = role
            return room_payload(room, role, new_token)


def play_move(data: dict[str, Any]) -> dict[str, Any]:
    code = str(data.get("room") or "").strip().upper()
    token = str(data.get("token") or "")
    with _rooms_lock:
        room = get_room(code)
    with room["lock"]:
        touch(room)
        role = role_for_token(room, token)
        room["game"].submit(role, data)
        return room_payload(room, role, token)


def get_state(code: str, token: str) -> dict[str, Any]:
    with _rooms_lock:
        room = get_room(code)
    with room["lock"]:
        touch(room)
        role = role_for_token(room, token)
        return room_payload(room, role, token)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} {format % args}", flush=True)

    def _cors_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin and origin in allowed_origins():
            return origin
        return None

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, payload: Any) -> None:
        self._send(status, json_bytes(payload), "application/json; charset=utf-8")

    def do_OPTIONS(self) -> None:
        self._send(204, b"", "text/plain")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._send_json(200, {"ok": True})
            return
        if parsed.path == "/api/setup":
            self._send_json(200, play_setup_payload())
            return
        if parsed.path == "/api/state":
            query = parse_qs(parsed.query)
            try:
                self._send_json(
                    200,
                    get_state((query.get("room") or [""])[0], (query.get("token") or [""])[0]),
                )
            except LookupError as exc:
                self._send_json(404, {"error": str(exc)})
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            data = read_json(self)
            if parsed.path == "/api/rooms":
                self._send_json(200, create_room(data))
                return
            if parsed.path == "/api/rooms/join":
                self._send_json(200, join_room(data))
                return
            if parsed.path == "/api/move":
                self._send_json(200, play_move(data))
                return
        except LookupError as exc:
            self._send_json(404, {"error": str(exc)})
            return
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
            return
        self._send_json(404, {"error": "Unknown endpoint."})


def main() -> int:
    args = parse_args()
    if not SITE.is_dir():
        raise SystemExit(f"Missing site directory: {SITE}")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"AI-race at http://{args.host}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
