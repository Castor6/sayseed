#!/usr/bin/env python3
"""Exercise the Sayseed updater against an isolated, real Docker Compose instance."""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
UPDATER_FILE = ROOT / "scripts/deploy/sayseed-update.py"
SPEC = importlib.util.spec_from_file_location("sayseed_update", UPDATER_FILE)
assert SPEC and SPEC.loader
UPDATE_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATE_MODULE)


def command(*args: str, cwd: Path | None = None, timeout: int = 90) -> str:
    result = subprocess.run(
        args, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False
    )
    if result.returncode:
        error = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"{' '.join(args[:3])} failed ({result.returncode}): {error[-1200:]}")
    return result.stdout.strip()


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(url: str, method: str = "GET", body: dict | None = None, token: str = "") -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.load(error)
        except json.JSONDecodeError:
            return error.code, {}


class DockerFixture:
    def __init__(self, image: str) -> None:
        self.id = f"sayseed-updater-test-{uuid4().hex[:12]}"
        self.root = Path(tempfile.mkdtemp(prefix=f"{self.id}-"))
        self.app_dir = self.root / "app"
        self.state_dir = self.root / "state"
        self.backup_dir = self.root / "backups"
        self.volume = f"{self.id}-data"
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.password = f"fixture-{uuid4().hex}"
        self.input_image = image
        self.base_image = image
        self.images: list[str] = []
        self.app_dir.mkdir(mode=0o700)
        self.state_dir.mkdir(mode=0o700)
        self.backup_dir.mkdir(mode=0o700)
        compose = (ROOT / "compose.production.yaml").read_text()
        compose = compose.replace("interval: 30s", "interval: 2s").replace("start_period: 20s", "start_period: 2s")
        (self.app_dir / "compose.production.yaml").write_text(compose)
        self.gate_port = free_port()
        self.gate_url = f"http://127.0.0.1:{self.gate_port}/api/health"
        self.gate = None
        self.gate_thread = None
        self.prepare_base_image()
        self.set_image(self.base_image)

    def prepare_base_image(self) -> None:
        info = json.loads(command("docker", "image", "inspect", self.input_image))[0]
        labels = info.get("Config", {}).get("Labels") or {}
        self.base_version = labels.get("org.opencontainers.image.version", "0.1.1")
        UPDATE_MODULE.version_tuple(self.base_version)
        revision = labels.get("org.opencontainers.image.revision", "0" * 40)
        if len(revision) != 40 or any(character not in "0123456789abcdef" for character in revision):
            revision = "0" * 40
        context = self.root / "build-base"
        context.mkdir()
        dockerfile = (
            f"FROM {self.input_image}\n"
            'LABEL org.opencontainers.image.source="https://github.com/Castor6/sayseed" \\\n'
            f'      org.opencontainers.image.version="{self.base_version}" \\\n'
            f'      org.opencontainers.image.revision="{revision}"\n'
        )
        (context / "Dockerfile").write_text(dockerfile)
        tag = f"{self.id}:base"
        command("docker", "build", "--quiet", "--tag", tag, str(context), timeout=180)
        self.images.append(tag)
        self.base_image = tag

    def set_image(self, image: str) -> None:
        contents = "\n".join(
            (
                f"SAYSEED_PASSWORD={self.password}",
                f"SAYSEED_PUBLIC_URL={self.url}",
                f"SAYSEED_PORT={self.port}",
                f"SAYSEED_VOLUME={self.volume}",
                f"SAYSEED_IMAGE={image}",
            )
        ) + "\n"
        env = self.app_dir / ".env"
        env.write_text(contents)
        env.chmod(0o600)

    def compose(self, *args: str, timeout: int = 120) -> str:
        return command(*self.compose_command(*args), timeout=timeout)

    def compose_command(self, *args: str) -> tuple[str, ...]:
        result = [
            "docker", "compose", "-p", self.id,
            "--project-directory", str(self.app_dir),
            "-f", str(self.app_dir / "compose.production.yaml"),
        ]
        overlay = self.app_dir / "deployment-image.json"
        if overlay.exists():
            result.extend(("-f", str(overlay)))
        result.extend(("--env-file", str(self.app_dir / ".env"), *args))
        return tuple(result)

    def container_id(self) -> str:
        return self.compose("ps", "-q", "sayseed")

    def wait_healthy(self, timeout: int = 90) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                status, _ = request(f"{self.url}/api/health")
                if status == 200:
                    return
            except (OSError, TimeoutError):
                pass
            time.sleep(1)
        raise AssertionError("isolated Sayseed did not become healthy")

    def start(self) -> None:
        self.compose("up", "-d", "--no-build", timeout=180)
        self.wait_healthy()

    def build_candidate(self, version: str, revision: str, broken: bool = False) -> str:
        tag = f"{self.id}:{version.replace('.', '-')}"
        lines = [
            f"FROM {self.base_image}",
            'LABEL org.opencontainers.image.source="https://github.com/Castor6/sayseed"',
            f"LABEL org.opencontainers.image.version={version}",
            f"LABEL org.opencontainers.image.revision={revision}",
        ]
        if broken:
            lines.append('CMD ["node", "/sayseed-updater-test-missing.js"]')
        context = self.root / f"build-{len(self.images)}"
        context.mkdir()
        (context / "Dockerfile").write_text("\n".join(lines) + "\n")
        command("docker", "build", "--quiet", "--tag", tag, str(context), timeout=180)
        self.images.append(tag)
        return tag

    def login(self) -> str:
        status, body = request(f"{self.url}/api/auth/login", "POST", {"password": self.password})
        assert status == 200, f"fixture login failed: {status}"
        assert isinstance(body.get("token"), str)
        return body["token"]

    def create_note(self, token: str) -> str:
        status, body = request(
            f"{self.url}/api/notes", "POST",
            {
                "expression": "update fixture",
                "sentence": "This record survives an update.",
                "meaning": "升级测试记录",
                "sentenceTranslation": "这条记录在升级后仍然存在。",
                "usage": "isolated Docker fixture",
                "sourceKind": "webpage",
                "sourceUrl": "https://example.com/fixture",
                "sourceTitle": "Updater fixture",
            }, token
        )
        assert status in (200, 201), f"fixture note creation failed: {status}"
        return body["note"]["id"]

    def secret_hash(self) -> str:
        script = (
            "const fs=require('node:fs'),c=require('node:crypto');"
            "process.stdout.write(c.createHash('sha256').update(fs.readFileSync('/app/data/.secret')).digest('hex'))"
        )
        return command("docker", "exec", self.container_id(), "node", "-e", script)

    def verify_note(self, token: str, note_id: str, secret_hash: str) -> None:
        self.wait_healthy()
        assert self.secret_hash() == secret_hash, "persistent encryption key changed"
        status, body = request(f"{self.url}/api/notes", token=token)
        assert status == 200, f"fixture notes request failed: {status}"
        assert any(note.get("id") == note_id for note in body["notes"]), "SQLite note disappeared"

    def start_gate(self) -> None:
        marker = self.state_dir / "maintenance"

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                active = marker.exists()
                self.send_response(503 if active else 200)
                if active:
                    self.send_header("X-Sayseed-Maintenance", "1")
                self.end_headers()

            def log_message(self, *_args: object) -> None:
                pass

        self.gate = ThreadingHTTPServer(("127.0.0.1", self.gate_port), Handler)
        self.gate_thread = threading.Thread(target=self.gate.serve_forever, daemon=True)
        self.gate_thread.start()

    def config(self) -> dict:
        return {
            "app_dir": str(self.app_dir),
            "state_dir": str(self.state_dir),
            "backup_dir": str(self.backup_dir),
            "image_repository": "registry.example.test/castor6/sayseed",
            "volume_name": self.volume,
            "health_url": f"{self.url}/api/health",
            "public_health_url": "https://example.invalid/api/health",
            "ca_file": "/dev/null",
            "health_attempts": 20,
            "health_interval": 1,
        }

    def cleanup(self) -> None:
        failures = []
        if self.gate:
            self.gate.shutdown()
            self.gate.server_close()
            self.gate_thread.join(timeout=5)
        try:
            self.compose("down", "--remove-orphans", timeout=90)
        except Exception as error:
            failures.append(str(error))
        try:
            command("docker", "volume", "rm", self.volume)
        except Exception as error:
            failures.append(str(error))
        for tag in reversed(self.images):
            try:
                command("docker", "image", "rm", tag)
            except Exception as error:
                failures.append(str(error))
        if not failures:
            shutil.rmtree(self.root)
        if failures:
            raise RuntimeError(f"isolated cleanup failed; inspect {self.root}: {failures}")


class IsolatedUpdater(UPDATE_MODULE.Updater):
    def __init__(self, fixture: DockerFixture, candidate: dict):
        super().__init__(fixture.config())
        self.fixture = fixture
        self.test_candidate = candidate

    def compose(self, *args: str) -> str:
        return self.run(*self.fixture.compose_command(*args))

    def candidate(self) -> dict:
        return self.test_candidate

    def running(self) -> dict:
        container = self.container()
        assert container.get("State", {}).get("Running")
        _, release = self.image_info(container["Image"])
        self.volume()
        return {**release, "image": release["image_id"]}

    def verify_maintenance(self) -> None:
        try:
            urllib.request.urlopen(self.fixture.gate_url, timeout=5).close()
        except urllib.error.HTTPError as error:
            if error.code == 503 and error.headers.get("X-Sayseed-Maintenance") == "1":
                return
        raise RuntimeError("Isolated maintenance gate was not active")


def candidate_release(fixture: DockerFixture, version: str, revision: str, broken: bool = False) -> dict:
    tag = fixture.build_candidate(version, revision, broken)
    info = json.loads(command("docker", "image", "inspect", tag))[0]
    return {"image": info["Id"], "image_id": info["Id"], "version": version, "commit": revision}


def assert_no_marker(fixture: DockerFixture) -> None:
    assert not (fixture.state_dir / "maintenance").exists(), "maintenance gate remained active"
    assert not (fixture.state_dir / "pending.json").exists(), "pending journal remained"


def recover_interruption(
    fixture: DockerFixture, candidate: dict, token: str, note_id: str, secret_hash: str,
    mutation: str,
) -> None:
    interrupted = IsolatedUpdater(fixture, candidate)
    old = interrupted.running()
    interrupted.compose("stop", "-t", "10", "sayseed")
    interrupted.snapshot = interrupted.data_snapshot()
    interrupted.make_backup()
    volume = interrupted.volume()
    journal = {
        "schema": 1,
        "app_dir": str(interrupted.app),
        "volume_name": fixture.volume,
        "project_name": fixture.id,
        "mountpoint": str(volume),
        "candidate": candidate,
        "previous": old,
        "phase": "backed_up",
        "backup": str(interrupted.backup),
    }
    UPDATE_MODULE.write_json(interrupted.pending, journal)
    interrupted.marker.touch()
    (volume / ".secret").write_bytes(b"interrupted-test-key")
    if mutation == "app_deleted":
        for path in fixture.app_dir.iterdir():
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
    elif mutation == "container_removed":
        command("docker", "rm", "--force", interrupted.container()["Id"])
    elif mutation != "key_corrupted":
        raise ValueError("Unknown interruption fixture")
    interrupted.recover()
    fixture.verify_note(token, note_id, secret_hash)
    assert_no_marker(fixture)
    assert interrupted.running()["image_id"] == old["image_id"], "recovery changed release"
    assert interrupted.read_state("failed.json")["image"] == candidate["image"]


def exercise(fixture: DockerFixture) -> None:
    fixture.start_gate()
    fixture.start()
    token = fixture.login()
    note_id = fixture.create_note(token)
    secret_hash = fixture.secret_hash()
    fixture.verify_note(token, note_id, secret_hash)

    major, minor, patch = UPDATE_MODULE.version_tuple(fixture.base_version)
    version = lambda offset: f"{major}.{minor}.{patch + offset}"
    good = candidate_release(fixture, version(1), "1" * 40)
    updater = IsolatedUpdater(fixture, good)
    updater.update()
    fixture.verify_note(token, note_id, secret_hash)
    assert_no_marker(fixture)
    assert updater.running()["image_id"] == good["image_id"], "successful update did not switch image"
    assert (fixture.state_dir / "deployed.json").is_file()
    print("PASS: real Compose image switch, stopped-volume backup, note and encryption key persistence")

    stable_container = fixture.container_id()
    updater.update()
    assert fixture.container_id() == stable_container, "same digest unexpectedly restarted the container"
    fixture.verify_note(token, note_id, secret_hash)
    print("PASS: repeated check does not restart the same digest")

    bad = candidate_release(fixture, version(2), "2" * 40, broken=True)
    failing = IsolatedUpdater(fixture, bad)
    try:
        failing.update()
    except RuntimeError:
        pass
    else:
        raise AssertionError("unhealthy candidate unexpectedly deployed")
    fixture.verify_note(token, note_id, secret_hash)
    assert_no_marker(fixture)
    assert failing.running()["image_id"] == good["image_id"], "failed update did not restore previous image"
    assert failing.read_state("failed.json")["image"] == bad["image"], "failed digest was not recorded"
    after_rollback = fixture.container_id()
    try:
        failing.update()
    except RuntimeError as error:
        assert "previously failed" in str(error), f"unexpected repeated failure: {error}"
    else:
        raise AssertionError("failed digest was attempted a second time")
    assert fixture.container_id() == after_rollback, "failed digest retry unexpectedly restarted container"
    print("PASS: unhealthy candidate rollback and failed-digest suppression")

    for offset, mutation in enumerate(("key_corrupted", "app_deleted", "container_removed"), start=3):
        pending = candidate_release(fixture, version(offset), str(offset) * 40)
        recover_interruption(fixture, pending, token, note_id, secret_hash, mutation)
        print(f"PASS: pending recovery after {mutation} restores application and data")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="pre-existing Sayseed image on this Docker host")
    args = parser.parse_args()
    assert sys.platform == "linux", "run this test on a Linux Docker host"
    command("docker", "image", "inspect", args.image)
    fixture = DockerFixture(args.image)
    try:
        exercise(fixture)
    finally:
        fixture.cleanup()


if __name__ == "__main__":
    main()
