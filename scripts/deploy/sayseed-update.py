#!/usr/bin/env python3
"""Pull a tested release, back up stopped SQLite data, and update one Compose service."""
# Adapted from Castor6/memos scripts/deploy; see LICENSE-MEMOS.

import argparse
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import ssl
import stat
import subprocess
import sys
import time
import tarfile
import urllib.error
import urllib.request


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sync_file(path):
    with Path(path).open("rb") as stream:
        os.fsync(stream.fileno())


def write_json(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w") as stream:
        os.chmod(temp, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)
    sync_directory(path.parent)


def version_tuple(value):
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value):
        raise ValueError("Invalid personal release version")
    return tuple(map(int, value.split(".")))


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class Updater:
    def __init__(self, config):
        self.config = config
        self.app = Path(config["app_dir"]).resolve()
        self.state = Path(config["state_dir"]).resolve()
        self.backups = Path(config["backup_dir"]).resolve()
        self.overlay = self.app / "deployment-image.json"
        self.marker = self.state / "maintenance"
        self.pending = self.state / "pending.json"
        self.repo = config["image_repository"]
        if not re.fullmatch(r"[a-z0-9.-]+/[a-z0-9_./-]+", self.repo):
            raise ValueError("Invalid registry repository")
        for path in (self.app, self.state, self.backups):
            if str(path) in ("/", "/opt", "/etc", "/var", "/var/lib"):
                raise ValueError("Use dedicated application/state/backup directories")
        if any(self.app == path or self.app in path.parents for path in (self.state, self.backups)):
            raise ValueError("State and backup directories must be outside the application")
        self.state.mkdir(mode=0o755, parents=True, exist_ok=True)
        self.backups.mkdir(mode=0o700, parents=True, exist_ok=True)
        roots = (self.app, self.state, self.backups)
        if any(a in b.parents or b in a.parents or a == b for i, a in enumerate(roots) for b in roots[i + 1:]):
            raise ValueError("Application, state and backup directories must be disjoint")
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", config["volume_name"]):
            raise ValueError("Invalid volume name")
        if not config["health_url"].startswith("http://127.0.0.1:") or not config["health_url"].endswith("/api/health"):
            raise ValueError("Health URL must use the local loopback application endpoint")
        if not config["public_health_url"].startswith("https://"):
            raise ValueError("Public maintenance check requires HTTPS")
        self.backup = None
        self.snapshot = None
        self.changed = False

    def run(self, *args, timeout=180):
        result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip()

    def compose(self, *args):
        command = ["docker", "compose", "--project-directory", str(self.app), "-f", str(self.app / "compose.production.yaml")]
        if self.overlay.exists():
            command += ["-f", str(self.overlay)]
        return self.run(*command, *args)

    def image_info(self, image):
        info = json.loads(self.run("docker", "image", "inspect", image))[0]
        labels = info.get("Config", {}).get("Labels") or {}
        version = labels.get("org.opencontainers.image.version", "")
        commit = labels.get("org.opencontainers.image.revision", "")
        version_tuple(version)
        if (labels.get("org.opencontainers.image.source") != "https://github.com/Castor6/sayseed"
                or not re.fullmatch(r"[0-9a-f]{40}", commit)
                or info.get("Architecture") != "amd64" or info.get("Os") != "linux"
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", info.get("Id", ""))):
            raise RuntimeError("Unexpected image identity or platform")
        return info, {"version": version, "commit": commit, "image_id": info["Id"]}

    def container(self, allow_missing=False):
        journal = self.read_state("pending.json")
        if journal.get("project_name"):
            ids = self.run("docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + journal["project_name"],
                           "--filter", "label=com.docker.compose.service=sayseed").split()
        else:
            ids = self.compose("ps", "-a", "-q", "sayseed").split()
        if not ids and allow_missing and journal.get("phase") in ("backed_up", "switching"):
            return None
        if len(ids) != 1:
            raise RuntimeError("Expected exactly one existing Sayseed container")
        info = json.loads(self.run("docker", "inspect", ids[0]))[0]
        labels = info.get("Config", {}).get("Labels") or {}
        if (labels.get("com.docker.compose.service") != "sayseed"
                or labels.get("com.docker.compose.project.working_dir") != str(self.app)):
            raise RuntimeError("Unexpected Compose service identity")
        return info

    def volume(self):
        info = self.container(allow_missing=True)
        if info is None:
            journal = self.read_state("pending.json")
            volume = json.loads(self.run("docker", "volume", "inspect", self.config["volume_name"]))[0]
            path = Path(volume["Mountpoint"])
            references = self.run("docker", "ps", "-aq", "--filter", "volume=" + self.config["volume_name"]).split()
            if (references or volume["Name"] != journal.get("volume_name") or str(path) != journal.get("mountpoint")
                    or path.is_symlink() or not path.is_dir() or not path.is_absolute() or path.resolve() != path):
                raise RuntimeError("Unattached recovery volume identity or references mismatch")
            return path
        mounts = [m for m in info["Mounts"] if m["Destination"] == "/app/data"]
        if (len(mounts) != 1 or mounts[0].get("Type") != "volume"
                or mounts[0].get("Name") != self.config["volume_name"]):
            raise RuntimeError("Container data volume mismatch")
        volume = json.loads(self.run("docker", "volume", "inspect", self.config["volume_name"]))[0]
        path = Path(volume["Mountpoint"])
        if (volume["Name"] != self.config["volume_name"] or str(path) != mounts[0]["Source"]
                or path.is_symlink() or not path.is_dir() or not path.is_absolute()
                or path.resolve() != path or path == Path("/")):
            raise RuntimeError("Docker volume mountpoint mismatch")
        return path

    def running(self):
        container = self.container()
        if not container.get("State", {}).get("Running"):
            raise RuntimeError("Existing service must be running")
        info, release = self.image_info(container["Image"])
        digests = [v for v in info.get("RepoDigests", []) if v.startswith(self.repo + "@sha256:")]
        if len(digests) == 1:
            release["image"] = digests[0]
        else:
            deployed = self.read_state("deployed.json")
            if (digests or deployed.get("image_id") != release["image_id"]
                    or not re.fullmatch(re.escape(self.repo) + r"@sha256:[0-9a-f]{64}", deployed.get("image", ""))):
                raise RuntimeError("Running image digest cannot be verified")
            release["image"] = deployed["image"]
        self.volume()
        return release

    def wait_healthy(self, release):
        base = self.config["health_url"].removesuffix("/api/health")
        for _ in range(self.config.get("health_attempts", 45)):
            try:
                container = self.container()
                _, actual = self.image_info(container["Image"])
                if not container.get("State", {}).get("Running") or any(actual[k] != release[k] for k in actual):
                    raise RuntimeError("Running image identity mismatch")
                if container.get("State", {}).get("Health", {}).get("Status") != "healthy":
                    raise RuntimeError("Container health check is not healthy")
                self.volume()
                for endpoint in ("/api/health", "/login"):
                    with urllib.request.urlopen(base + endpoint, timeout=5) as response:
                        if response.status != 200:
                            raise RuntimeError("HTTP health failed")
                try:
                    urllib.request.urlopen(base + "/api/notes", timeout=5).close()
                except urllib.error.HTTPError as error:
                    if error.code == 401:
                        return
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
                pass
            time.sleep(self.config.get("health_interval", 2))
        raise RuntimeError("Application image, container or HTTP health check failed")

    def verify_maintenance(self):
        context = ssl.create_default_context(cafile=self.config["ca_file"])
        try:
            urllib.request.urlopen(self.config["public_health_url"], context=context, timeout=10).close()
        except urllib.error.HTTPError as error:
            if error.code == 503 and error.headers.get("X-Sayseed-Maintenance") == "1":
                return
        raise RuntimeError("Public maintenance gate is not active; refusing to stop the application")

    def read_state(self, name):
        path = self.state / name
        return json.loads(path.read_text()) if path.exists() else {}

    def candidate(self):
        # Pull happens before maintenance or stopping the old service.
        for attempt in range(3):
            try:
                self.run("docker", "pull", self.repo + ":stable", timeout=300)
                break
            except (subprocess.SubprocessError, OSError):
                if attempt == 2:
                    raise
                time.sleep(5)
        info, release = self.image_info(self.repo + ":stable")
        digests = [value for value in info.get("RepoDigests", []) if value.startswith(self.repo + "@sha256:")]
        if len(digests) != 1 or not re.fullmatch(re.escape(self.repo) + r"@sha256:[0-9a-f]{64}", digests[0]):
            raise RuntimeError("Expected one registry digest")
        return {**release, "image": digests[0]}

    def data_snapshot(self):
        data = self.volume()
        database = data / "sayseed.sqlite"
        secret = data / ".secret"
        if not database.is_file() or not secret.is_file() or secret.is_symlink():
            raise RuntimeError("Missing database or persistent secret")
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise RuntimeError("SQLite integrity check failed")
            ids = {table: [row[0] for row in db.execute(f'SELECT id FROM "{table}" ORDER BY id')]
                   for table in ("notes", "connections", "models", "cards", "reviews")}
        return {"ids": ids, "secret_sha256": sha256(secret)}

    def verify_data(self):
        after = self.data_snapshot()
        if any(not set(values).issubset(after["ids"][table]) for table, values in self.snapshot["ids"].items()):
            raise RuntimeError("Existing data rows disappeared")
        if after["secret_sha256"] != self.snapshot["secret_sha256"]:
            raise RuntimeError("Persistent secret changed")

    def make_backup(self):
        data = self.volume()
        size = 0
        for root in (self.app, data):
            for path in (root, *root.rglob("*")):
                info = path.lstat()
                if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)) or (stat.S_ISREG(info.st_mode) and info.st_nlink != 1):
                    raise RuntimeError("Backup requires regular files/directories without links")
                size += info.st_size
        if shutil.disk_usage(self.backups).free < size * 4 + 512 * 1024 * 1024:
            raise RuntimeError("Insufficient backup/recovery space")
        directory = self.backups / (time.strftime("%Y%m%d-%H%M%S") + "-" + str(os.getpid()))
        directory.mkdir(mode=0o700)
        archive = directory / "before-update.tar"
        self.run("tar", "--acls", "--xattrs", "-cpf", str(archive), "-C", "/",
                 str(self.app).lstrip("/"), str(data).lstrip("/"), timeout=300)
        os.chmod(archive, 0o600)
        self.run("tar", "--compare", "-f", str(archive), "-C", "/", timeout=300)
        sync_file(archive)
        sync_directory(directory)
        sync_directory(self.backups)
        digest = sha256(archive)
        write_json(directory / "manifest.json", {"sha256": digest, "snapshot": self.snapshot,
                   "app_dir": str(self.app), "volume_name": self.config["volume_name"], "mountpoint": str(data)})
        write_json(directory / "retention.json", {"schema": 1, "created_at": time.time(),
                   "previous_image_id": self.previous_image_id(), "archive_sha256": digest, "status": "pending"})
        self.backup = archive

    def previous_image_id(self):
        container = self.compose("ps", "-a", "-q", "sayseed")
        return json.loads(self.run("docker", "inspect", container))[0]["Image"]

    def verify_image_id(self, image):
        if json.loads(self.run("docker", "image", "inspect", image))[0]["Id"] != image:
            raise RuntimeError("Recovery image ID mismatch")

    def finish_backup(self, status):
        try:
            if self.backup and (self.backup.parent / "retention.json").is_file():
                path = self.backup.parent / "retention.json"
                record = json.loads(path.read_text())
                record["status"] = status
                write_json(path, record)
        except (OSError, ValueError) as error:
            # Leave incomplete metadata protected; it must not prevent recovery.
            print("Backup status could not be recorded: " + str(error), file=sys.stderr)

    def retention_plan(self, now=None):
        if self.pending.exists() or self.marker.exists():
            raise RuntimeError("Unfinished deployment; cleanup refused")
        now = time.time() if now is None else now
        keep_count = self.config.get("backup_keep_count", 3)
        keep_days = self.config.get("backup_keep_days", 30)
        if type(keep_count) is not int or keep_count < 3 or type(keep_days) is not int or keep_days < 30:
            raise RuntimeError("Retention must keep at least 3 backups and 30 days")
        deployed = self.read_state("deployed.json")
        if not any(self.backups.iterdir()) and not deployed.get("backup"):
            return {"keep_backups": [], "remove_backups": [], "remove_images": [],
                    "protected_images": [], "retired_images": [],
                    "policy": {"keep_count": keep_count, "keep_days": keep_days}}
        if not deployed.get("image") or not deployed.get("backup"):
            raise RuntimeError("No successful deployment record; cleanup refused")
        records = []
        for directory in self.backups.iterdir():
            if directory.is_symlink() or not directory.is_dir() or not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[0-9]+", directory.name):
                raise RuntimeError("Unknown backup entry; cleanup refused: " + directory.name)
            for name in ("before-update.tar", "manifest.json", "retention.json"):
                path = directory / name
                if path.is_symlink() or not path.is_file():
                    raise RuntimeError("Incomplete/legacy backup; cleanup refused: " + directory.name)
            record = json.loads((directory / "retention.json").read_text())
            manifest = json.loads((directory / "manifest.json").read_text())
            if (record.get("schema") != 1 or record.get("status") not in ("pending", "failed", "success")
                    or type(record.get("created_at")) not in (int, float) or not math.isfinite(record["created_at"])
                    or record["created_at"] <= 0
                    or not re.fullmatch(r"sha256:[0-9a-f]{64}", record.get("previous_image_id", ""))
                    or not re.fullmatch(r"[0-9a-f]{64}", manifest.get("sha256", ""))
                    or record.get("archive_sha256") != manifest["sha256"]):
                raise RuntimeError("Invalid backup metadata; cleanup refused: " + directory.name)
            records.append((directory, record, manifest))
        records.sort(key=lambda entry: (entry[1]["created_at"], entry[0].name), reverse=True)
        keep, remove, protected = [], [], set()
        for index, (directory, record, manifest) in enumerate(records):
            reasons = []
            if index < keep_count:
                reasons.append("latest backups")
            if record["created_at"] >= now - keep_days * 86400:
                reasons.append("within retention days")
            if record["status"] != "success":
                reasons.append("failed or unfinished upgrade")
            if str(directory / "before-update.tar") == deployed["backup"]:
                reasons.append("current recovery point")
            if set(path.name for path in directory.iterdir()) != {"before-update.tar", "manifest.json", "retention.json"}:
                reasons.append("extra recovery or unknown files")
            if not reasons and sha256(directory / "before-update.tar") != manifest["sha256"]:
                reasons.append("archive checksum mismatch")
            item = {"directory": str(directory), "image_id": record["previous_image_id"], "reasons": reasons}
            if reasons:
                keep.append(item)
                protected.add(record["previous_image_id"])
            else:
                remove.append(item)
        if not any(str(d / "before-update.tar") == deployed["backup"] for d, _, _ in records):
            raise RuntimeError("Current recovery point is missing; cleanup refused")
        # Inspect every container, including stopped containers. Never force-remove an image.
        container_ids = self.run("docker", "ps", "-aq").split()
        if container_ids:
            protected.update(item["Image"] for item in json.loads(self.run("docker", "inspect", *container_ids)))
        current = json.loads(self.run("docker", "image", "inspect", deployed["image"]))[0]["Id"]
        protected.add(current)
        retired = self.read_state("retired-images.json").get("images", [])
        if not isinstance(retired, list) or any(not isinstance(i, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", i) for i in retired):
            raise RuntimeError("Invalid retired image journal")
        candidates = set(retired) | {item["image_id"] for item in remove}
        image_ids = sorted(set(self.run("docker", "image", "ls", "-aq", "--no-trunc").split()))
        inventory = json.loads(self.run("docker", "image", "inspect", *image_ids)) if image_ids else []
        images = []
        for info in inventory:
            if info["Id"] not in candidates or info["Id"] in protected:
                continue
            digests = info.get("RepoDigests") or []
            # Only this application and the configured repository are eligible.
            repos = (self.repo,)
            source = (info.get("Config", {}).get("Labels") or {}).get("org.opencontainers.image.source")
            if source != "https://github.com/Castor6/sayseed" or not any(d.startswith(repo + "@sha256:") for d in digests for repo in repos):
                continue
            images.append(info["Id"])
        return {"keep_backups": keep, "remove_backups": remove, "remove_images": images,
                "protected_images": sorted(protected), "retired_images": sorted(candidates),
                "policy": {"keep_count": keep_count, "keep_days": keep_days}}

    def cleanup(self, dry_run=False):
        plan = self.retention_plan()
        if dry_run:
            print(json.dumps(plan, indent=2))
            return plan
        report = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "plan": plan,
                  "deleted_backups": [], "deleted_images": []}
        try:
            # Persist image IDs before deleting their last backup reference, so failed
            # image deletions can be retried after a later successful upgrade.
            write_json(self.state / "retired-images.json", {"images": plan["retired_images"]})
            for item in plan["remove_backups"]:
                shutil.rmtree(item["directory"])
                report["deleted_backups"].append(item["directory"])
                print("Cleanup removed backup: " + item["directory"], flush=True)
            # Re-evaluate references after backup deletion, before touching images.
            for image in self.retention_plan()["remove_images"]:
                self.run("docker", "image", "rm", image)
                report["deleted_images"].append(image)
                print("Cleanup removed image: " + image, flush=True)
            remaining = set(plan["retired_images"]) - set(report["deleted_images"])
            write_json(self.state / "retired-images.json", {"images": sorted(remaining)})
        except Exception as error:
            report["error"] = str(error)
            raise
        finally:
            write_json(self.state / "cleanup-last.json", report)
        print("Cleanup completed: " + str(len(report["deleted_backups"])) + " backups, "
              + str(len(report["deleted_images"])) + " images", flush=True)
        return report

    def validate_backup(self, journal):
        archive = Path(journal["backup"])
        if (archive.name != "before-update.tar" or archive.parent.parent != self.backups
                or archive.is_symlink() or archive.parent.is_symlink()):
            raise RuntimeError("Untrusted backup path")
        manifest = json.loads((archive.parent / "manifest.json").read_text())
        record = json.loads((archive.parent / "retention.json").read_text())
        data = self.volume()
        if (manifest.get("app_dir") != str(self.app) or manifest.get("volume_name") != self.config["volume_name"]
                or manifest.get("mountpoint") != str(data) or record.get("previous_image_id") != journal["previous"]["image_id"]
                or record.get("archive_sha256") != manifest.get("sha256") or sha256(archive) != manifest["sha256"]):
            raise RuntimeError("Backup checksum, image or volume mismatch")
        self.verify_image_id(journal["previous"]["image_id"])
        # Reject links and special files before invoking privileged GNU tar.
        roots = (str(self.app).lstrip("/") + "/", str(data).lstrip("/") + "/")
        with tarfile.open(archive) as tar:
            for member in tar:
                name = member.name.rstrip("/") + "/"
                if (member.name.startswith("/") or ".." in Path(member.name).parts
                        or not any(name.startswith(root) for root in roots)
                        or not (member.isfile() or member.isdir())):
                    raise RuntimeError("Unsafe backup archive member")
        self.backup = archive
        self.snapshot = manifest["snapshot"]
        return data

    @staticmethod
    def clear_contents(directory):
        for path in directory.iterdir():
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink()

    def restore(self, journal):
        data = self.validate_backup(journal)
        stage = self.backup.parent / "restore"
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir(mode=0o700)
        self.run("tar", "--acls", "--xattrs", "-xpf", str(self.backup), "-C", str(stage), timeout=300)
        restored_app = stage / str(self.app).lstrip("/")
        restored_data = stage / str(data).lstrip("/")
        if not (restored_app / "compose.production.yaml").is_file() or not (restored_data / "sayseed.sqlite").is_file() or not (restored_data / ".secret").is_file():
            raise RuntimeError("Backup lacks required application/data files")
        failed = self.backup.parent / "failed-state.tar"
        if not failed.exists():
            self.run("tar", "--acls", "--xattrs", "-cpf", str(failed), "-C", "/",
                     str(self.app).lstrip("/"), str(data).lstrip("/"), timeout=300)
        # Docker owns the volume directory; replace its contents, never rename it.
        self.clear_contents(data)
        self.clear_contents(self.app)
        self.run("cp", "-a", str(restored_data) + "/.", str(data), timeout=300)
        self.run("cp", "-a", str(restored_app) + "/.", str(self.app), timeout=300)
        self.pin(journal["previous"]["image_id"])
        self.verify_data()
        self.run("sync")

    def pin(self, image):
        write_json(self.overlay, {"services": {"sayseed": {"image": image, "pull_policy": "never"}}})

    def finalize(self, release):
        journal = self.read_state("pending.json")
        journal.update(phase="finalized", final_release=release)
        write_json(self.pending, journal)
        # Once the gate opens, recovery must never restore the old data snapshot.
        self.marker.unlink(missing_ok=True)
        sync_directory(self.state)
        self.pending.unlink()
        sync_directory(self.state)

    def recover(self):
        if not self.pending.exists():
            raise RuntimeError("No pending journal; manual inspection required if marker exists")
        journal = self.read_state("pending.json")
        if (journal.get("schema") != 1 or journal.get("app_dir") != str(self.app)
                or journal.get("volume_name") != self.config["volume_name"]
                or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", journal.get("project_name", ""))
                or journal.get("phase") not in ("prepared", "stopping", "stopped", "backed_up", "switching", "finalized")):
            raise RuntimeError("Unrecognized recovery journal")
        if str(self.volume()) != journal.get("mountpoint"):
            raise RuntimeError("Recovery volume mountpoint changed")
        if journal["phase"] == "finalized":
            self.wait_healthy(journal["final_release"])
            self.finalize(journal["final_release"])
            print("Finalized transaction reconciled without restoring data")
            return
        self.verify_image_id(journal["previous"]["image_id"])
        self.marker.touch(mode=0o644)
        os.chmod(self.marker, 0o644)
        self.verify_maintenance()
        if journal["phase"] in ("backed_up", "switching"):
            self.validate_backup(journal)
            container = self.container(allow_missing=True)
            if container is not None:
                self.run("docker", "stop", "-t", "45", container["Id"])
                if self.container().get("State", {}).get("Running"):
                    raise RuntimeError("Container did not stop for recovery")
            self.restore(journal)
        else:
            if self.container()["Image"] != journal["previous"]["image_id"]:
                raise RuntimeError("Unexpected image before backup; refusing ambiguous recovery")
            self.pin(journal["previous"]["image_id"])
        self.compose("up", "-d", "--no-deps", "--pull", "never", "sayseed")
        self.wait_healthy(journal["previous"])
        if self.snapshot:
            self.verify_data()
        self.finish_backup("failed")
        write_json(self.state / "deployed.json", journal["previous"])
        write_json(self.state / "failed.json", journal["candidate"])
        self.finalize(journal["previous"])
        print("Previous application and data recovered")

    def update(self, dry_run=False, retry=False):
        if self.pending.exists() or self.marker.exists():
            raise RuntimeError("Unfinished deployment; inspect and use --recover")
        # Read the actual running image before pulling a movable stable tag.
        old = self.running()
        self.wait_healthy(old)
        deployed = self.read_state("deployed.json")
        if deployed and any(deployed.get(k) != old[k] for k in ("image_id", "version", "commit")):
            raise RuntimeError("Running container differs from recorded deployment")
        if not deployed and not dry_run:
            self.pin(old["image"])
            write_json(self.state / "deployed.json", old)
        candidate = self.candidate()
        if candidate["image"] == old["image"]:
            print("Already running the published digest")
            return
        if version_tuple(candidate["version"]) <= version_tuple(old["version"]):
            raise RuntimeError("Release channel would downgrade or replace an existing version")
        if not retry and self.read_state("failed.json").get("image") == candidate["image"]:
            raise RuntimeError("This digest previously failed; inspect before --retry")
        if dry_run:
            print("Candidate verified: " + candidate["version"])
            return
        container = self.container()
        project = (container.get("Config", {}).get("Labels") or {}).get("com.docker.compose.project", "")
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
            raise RuntimeError("Missing Compose project identity")
        journal = {"schema": 1, "app_dir": str(self.app), "volume_name": self.config["volume_name"],
                   "project_name": project, "mountpoint": str(self.volume()),
                   "candidate": candidate, "previous": {**old, **({"backup": deployed["backup"]} if deployed.get("backup") else {})},
                   "phase": "prepared"}
        write_json(self.pending, journal)
        self.marker.touch(mode=0o644)
        os.chmod(self.marker, 0o644)
        try:
            self.verify_maintenance()
            journal["phase"] = "stopping"
            write_json(self.pending, journal)
            self.compose("stop", "-t", "45", "sayseed")
            if self.container().get("State", {}).get("Running"):
                raise RuntimeError("Container did not stop")
            journal["phase"] = "stopped"
            write_json(self.pending, journal)
            self.snapshot = self.data_snapshot()
            self.make_backup()
            journal.update(phase="backed_up", backup=str(self.backup))
            write_json(self.pending, journal)
            journal["phase"] = "switching"
            write_json(self.pending, journal)
            self.pin(candidate["image"])
            self.compose("up", "-d", "--no-deps", "--pull", "never", "sayseed")
            self.wait_healthy(candidate)
            self.verify_data()
            self.run("sync")
            write_json(self.app / "release.json", {"component": "web", **{k: candidate[k] for k in ("version", "commit", "image")}})
            write_json(self.state / "deployed.json", {**candidate, "backup": str(self.backup), "updated_at": time.time()})
        except Exception:
            # Recovery failures deliberately preserve the journal and public gate.
            if journal["phase"] == "prepared":
                self.finalize(old)
            else:
                self.recover()
            raise
        self.finish_backup("success")
        self.finalize(candidate)
        print("Deployment healthy; maintenance ended")
        try:
            self.cleanup()
        except Exception as error:
            print("Cleanup skipped; healthy deployment retained: " + str(error), file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/sayseed-update/config.json")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--dry-run", action="store_true")
    modes.add_argument("--cleanup-dry-run", action="store_true")
    modes.add_argument("--recover", action="store_true")
    parser.add_argument("--retry", action="store_true")
    args = parser.parse_args()
    if args.retry and (args.recover or args.cleanup_dry_run):
        parser.error("--retry applies only to updates")
    os.umask(0o077)
    updater = Updater(json.loads(Path(args.config).read_text()))
    os.chmod(updater.state, 0o755)
    with (updater.state / "update.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another deployment is active")
            return
        if args.cleanup_dry_run:
            updater.cleanup(dry_run=True)
        elif args.recover:
            updater.recover()
        else:
            updater.update(args.dry_run, args.retry)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Deployment failed: " + str(error), file=sys.stderr)
        sys.exit(1)
