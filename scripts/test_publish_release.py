#!/usr/bin/env python3
"""Exercise publication guards without accessing registries or GitHub."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("publish_release", Path(__file__).with_name("publish-release.py"))
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)
COMMIT = "a" * 40
REPO = "example/sayseed"
IMAGE = "registry.example/sayseed"
DIGEST = IMAGE + "@sha256:" + "b" * 64


def image(version="1.2.0", identifier="sha256:candidate"):
    return {"Id": identifier, "RepoDigests": [DIGEST], "Config": {"Labels": {
        "org.opencontainers.image.version": version,
        "org.opencontainers.image.revision": COMMIT,
        "org.opencontainers.image.source": f"https://github.com/{REPO}",
    }}}


class RegistryTests(unittest.TestCase):
    def test_default_ghcr_uses_lowercase_source_and_job_token(self):
        with patch.dict(os.environ, {"GITHUB_ACTOR": "example", "GH_TOKEN": "job-token"}, clear=True):
            self.assertEqual(publish.registry_credentials("Example/Sayseed"),
                             ("ghcr.io", "ghcr.io/example/sayseed", "example", "job-token"))

    def test_explicit_acr_uses_only_acr_credentials(self):
        env = {"ACR_REGISTRY": "registry.example", "ACR_IMAGE": IMAGE,
               "ACR_USERNAME": "publisher", "ACR_PASSWORD": "registry-token", "GH_TOKEN": "job-token"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(publish.registry_credentials(REPO),
                             ("registry.example", IMAGE, "publisher", "registry-token"))

    def test_partial_acr_configuration_does_not_fall_back(self):
        for key, value in [("ACR_REGISTRY", "registry.example"), ("ACR_IMAGE", IMAGE)]:
            with self.subTest(key=key), patch.dict(os.environ, {key: value, "GITHUB_ACTOR": "example", "GH_TOKEN": "job-token"}, clear=True):
                with self.assertRaises(publish.PublishError):
                    publish.registry_credentials(REPO)


class ImageGuardTests(unittest.TestCase):
    def test_immutable_tag_rejects_different_image(self):
        with self.assertRaises(publish.PublishError):
            publish.assert_same(image(identifier="other"), image(), "v1.2.0")

    def test_stable_rejects_downgrade_and_replacement(self):
        for previous in [image("1.3.0"), image(identifier="other")]:
            with self.subTest(previous=previous), self.assertRaises(publish.PublishError):
                publish.assert_stable(previous, image(), "1.2.0", REPO)
        publish.assert_stable(image("1.1.0"), image(), "1.2.0", REPO)
        publish.assert_stable(image(), image(), "1.2.0", REPO)

    def test_manifest_missing_is_distinct_from_auth_or_network_error(self):
        for error in ["unauthorized", "TLS handshake timeout", "manifest unknown", "no such manifest: x"]:
            with patch.object(publish.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", error)):
                if error in ["manifest unknown", "no such manifest: x"]:
                    self.assertIsNone(publish.remote_image("x"))
                else:
                    with self.assertRaises(publish.PublishError):
                        publish.remote_image("x")

    def simulate(self, failure=None, existing=False, previous=False, ghcr=False):
        calls = []
        pushed = set()
        candidate = image()
        repository = "ghcr.io/" + REPO if ghcr else IMAGE
        candidate["RepoDigests"] = [repository + "@sha256:" + "b" * 64]
        def run(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("node", "scripts/docker-smoke.mjs") and failure == "smoke":
                raise publish.PublishError("smoke failed")
            if args[:2] == ("node", "scripts/docker-smoke.mjs") and failure == "upgrade" and "--previous-image" in args:
                raise publish.PublishError("upgrade failed")
            if args[:2] == ("docker", "push"):
                if failure == "push":
                    raise publish.PublishError("push failed")
                pushed.add(args[2])
            return ""
        def remote(ref):
            if ref in pushed or existing and not ref.endswith(":stable"):
                return candidate
            if previous and ref.endswith(":stable"):
                return image("1.1.0", "sha256:previous")
            return None
        env = {"ACR_REGISTRY": "registry.example", "ACR_IMAGE": IMAGE, "ACR_USERNAME": "fake", "ACR_PASSWORD": "fake"}
        if ghcr:
            env = {"GITHUB_ACTOR": "example", "GH_TOKEN": "job-token"}
        if not existing:
            env["SAYSEED_CANDIDATE_IMAGE"] = "candidate"
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, env, clear=True), patch.object(publish, "identity", return_value=("1.2.0", COMMIT, REPO)), patch.object(publish, "changelog", return_value="# Release\n"), patch.object(publish, "local_image", return_value=candidate), patch.object(publish, "remote_image", side_effect=remote), patch.object(publish, "run", side_effect=run):
            old = os.getcwd()
            try:
                os.chdir(tmp)
                if failure:
                    with self.assertRaises(publish.PublishError):
                        publish.publish_image()
                else:
                    publish.publish_image()
                    publish.verify_directory(Path("build/release/web"), "web", "1.2.0", COMMIT)
                    metadata = json.loads(Path("build/release/web/release.json").read_text())
                    self.assertEqual(metadata["image"], candidate["RepoDigests"][0])
                    self.assertEqual(Path("build/release/web/image-digest.txt").read_text().strip(), metadata["image"])
            finally:
                os.chdir(old)
        return calls

    def test_smoke_failure_never_pushes_any_tag(self):
        calls = self.simulate("smoke")
        self.assertFalse(any(c[:2] == ("docker", "push") for c in calls))

    def test_existing_stable_runs_candidate_fresh_then_upgrade(self):
        calls = self.simulate(previous=True)
        smoke = [c for c in calls if c[:2] == ("node", "scripts/docker-smoke.mjs")]
        self.assertEqual(smoke, [
            ("node", "scripts/docker-smoke.mjs", "--image", "sha256:candidate"),
            ("node", "scripts/docker-smoke.mjs", "--image", "sha256:candidate", "--previous-image", DIGEST),
        ])
        first_push = next(i for i, call in enumerate(calls) if call[:2] == ("docker", "push"))
        self.assertTrue(all(calls.index(call) < first_push for call in smoke))

    def test_fresh_or_upgrade_failure_with_previous_never_pushes(self):
        for failure, expected_checks in [("smoke", 1), ("upgrade", 2)]:
            with self.subTest(failure=failure):
                calls = self.simulate(failure, previous=True)
                self.assertEqual(sum(c[:2] == ("node", "scripts/docker-smoke.mjs") for c in calls), expected_checks)
                self.assertFalse(any(c[:2] in [("docker", "push"), ("docker", "tag")] for c in calls))

    def test_immutable_push_failure_never_promotes_stable(self):
        calls = self.simulate("push")
        self.assertFalse(any(c[:2] == ("docker", "tag") and c[-1].endswith(":stable") for c in calls))

    def test_success_promotes_stable_last(self):
        calls = self.simulate()
        pushes = [c[-1] for c in calls if c[:2] == ("docker", "push")]
        self.assertEqual(pushes, [IMAGE + ":v1.2.0", IMAGE + ":sha-" + COMMIT, IMAGE + ":stable"])

    def test_ghcr_publishes_same_identity_and_promotes_stable_last(self):
        calls = self.simulate(ghcr=True)
        self.assertIn(("docker", "login", "ghcr.io", "--username", "example", "--password-stdin"), calls)
        self.assertEqual([c[-1] for c in calls if c[:2] == ("docker", "push")], [
            f"ghcr.io/{REPO}:v1.2.0", f"ghcr.io/{REPO}:sha-{COMMIT}", f"ghcr.io/{REPO}:stable",
        ])

    def test_retry_reuses_existing_image_without_rebuild(self):
        calls = self.simulate(existing=True)
        self.assertFalse(any(c[:2] == ("docker", "build") for c in calls))


class GitHubGuardTests(unittest.TestCase):
    def test_existing_tag_must_resolve_to_exact_commit(self):
        with patch.object(publish, "api", return_value={"object": {"type": "commit", "sha": "wrong"}}), self.assertRaises(publish.PublishError):
            publish.verify_tag("repos/example/sayseed", "v1.2.0", COMMIT)

    def test_published_assets_are_verified_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "release.json"
            file.write_bytes(b"expected")
            with patch.object(publish, "api", return_value=[{"name": file.name, "id": 1}]), patch.object(publish, "run", return_value=b"different"), self.assertRaises(publish.PublishError):
                publish.verify_assets("repos/example/sayseed", {"id": 1}, {file.name: file}, False)

    def test_published_release_cannot_acquire_missing_assets(self):
        with patch.object(publish, "api", return_value=[]), self.assertRaises(publish.PublishError):
            publish.verify_assets("repos/example/sayseed", {"id": 1}, {"x": Path("x")}, False)

    def test_draft_is_published_only_after_complete_asset_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "CHANGELOG.md"
            note.write_text("notes")
            release = {"id": 7, "tag_name": "v1.2.0", "body": "notes", "draft": True, "prerelease": False}
            events = []
            def api(path, method="GET", data=None, **kwargs):
                events.append((method, path))
                if method == "PATCH":
                    release["draft"] = False
                return dict(release)
            def assets(*args, **kwargs):
                events.append(("VERIFY", kwargs["allow_missing"]))
                return set()
            with patch.dict(os.environ, {"GH_TOKEN": "fake"}), patch.object(publish, "identity", return_value=("1.2.0", COMMIT, REPO)), patch.object(publish, "verify_directory", return_value={note.name: note}), patch.object(publish, "verify_tag"), patch.object(publish, "api", side_effect=api), patch.object(publish, "verify_assets", side_effect=assets):
                publish.publish_github("web", Path(tmp))
            promotion = next(i for i, event in enumerate(events) if event[0] == "PATCH")
            self.assertIn(("VERIFY", False), events[:promotion])

    def test_failed_asset_verification_keeps_release_draft(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "CHANGELOG.md"
            note.write_text("notes")
            release = {"id": 7, "tag_name": "v1.2.0", "body": "notes", "draft": True, "prerelease": False}
            with patch.dict(os.environ, {"GH_TOKEN": "fake"}), patch.object(publish, "identity", return_value=("1.2.0", COMMIT, REPO)), patch.object(publish, "verify_directory", return_value={note.name: note}), patch.object(publish, "verify_tag"), patch.object(publish, "api", return_value=release) as api, patch.object(publish, "verify_assets", side_effect=publish.PublishError("asset mismatch")):
                with self.assertRaises(publish.PublishError):
                    publish.publish_github("web", Path(tmp))
                self.assertFalse(any(call.args[1:2] == ("PATCH",) for call in api.call_args_list))

    def test_checksums_reject_unlisted_files_and_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "release.json").write_text(json.dumps({"component": "web", "version": "1.2.0", "commit": COMMIT}))
            (directory / "CHANGELOG.md").write_text("notes")
            publish.write_checksums(directory)
            publish.verify_directory(directory, "web", "1.2.0", COMMIT)
            (directory / "extra").write_text("surprise")
            with self.assertRaises(publish.PublishError):
                publish.verify_directory(directory, "web", "1.2.0", COMMIT)
            (directory / "extra").unlink()
            (directory / "CHANGELOG.md").write_text("tampered")
            with self.assertRaises(publish.PublishError):
                publish.verify_directory(directory, "web", "1.2.0", COMMIT)


if __name__ == "__main__":
    unittest.main()
