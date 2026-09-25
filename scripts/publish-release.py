#!/usr/bin/env python3
"""Publish validated, immutable Sayseed images and GitHub release assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


class PublishError(RuntimeError):
    pass


def run(*args, input=None, binary=False):
    result = subprocess.run(args, input=input, capture_output=True, text=not binary)
    if result.returncode:
        error = result.stderr.decode() if binary else result.stderr
        raise PublishError(f"{args[0]} {args[1]} failed: {error.strip()}")
    return result.stdout


def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise PublishError(f"Missing {name}")
    return value


def version_tuple(value):
    if not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", value):
        raise PublishError(f"Expected stable semantic version: {value}")
    return tuple(map(int, value.split(".")))


def identity(component):
    version, commit = required("RELEASE_VERSION"), required("RELEASE_COMMIT")
    version_tuple(version)
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise PublishError("RELEASE_COMMIT must be a full lowercase commit SHA")
    repo = required("GITHUB_REPOSITORY")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise PublishError("Invalid GITHUB_REPOSITORY")
    if run("git", "rev-parse", "HEAD").strip() != commit:
        raise PublishError("Checkout does not match RELEASE_COMMIT")
    package = json.loads(Path(f"apps/{component}/package.json").read_text())
    if package["version"] != version:
        raise PublishError("Package version does not match RELEASE_VERSION")
    return version, commit, repo


def local_image(ref):
    return json.loads(run("docker", "image", "inspect", ref))[0]


def remote_image(ref):
    result = subprocess.run(["docker", "manifest", "inspect", ref], capture_output=True, text=True)
    if result.returncode:
        error = result.stderr.lower()
        # Only the registry's explicit missing-manifest response permits first publication.
        if "manifest unknown" in error or "no such manifest:" in error:
            return None
        raise PublishError(f"Cannot inspect {ref}: {result.stderr.strip()}")
    run("docker", "pull", ref)
    return local_image(ref)


def labels(image):
    return image.get("Config", {}).get("Labels") or {}


def assert_labels(image, version, commit, repo):
    expected = {"version": version, "revision": commit, "source": f"https://github.com/{repo}"}
    for key, value in expected.items():
        if labels(image).get(f"org.opencontainers.image.{key}") != value:
            raise PublishError(f"Image has unexpected OCI {key}")


def assert_same(existing, candidate, ref):
    if existing and existing["Id"] != candidate["Id"]:
        raise PublishError(f"Refusing to overwrite different image: {ref}")


def assert_stable(previous, candidate, version, repo):
    if not previous:
        return
    previous_labels = labels(previous)
    if previous_labels.get("org.opencontainers.image.source") != f"https://github.com/{repo}":
        raise PublishError("Stable image belongs to another source")
    old_version = previous_labels.get("org.opencontainers.image.version", "")
    if version_tuple(old_version) > version_tuple(version):
        raise PublishError("Refusing to downgrade stable")
    if old_version == version:
        assert_same(previous, candidate, "stable")


def digest_for(image, repository):
    prefix = repository + "@"
    matches = [value for value in image.get("RepoDigests", []) if value.startswith(prefix)]
    if len(matches) != 1 or not re.fullmatch(re.escape(prefix) + r"sha256:[0-9a-f]{64}", matches[0]):
        raise PublishError("Cannot determine registry image digest")
    return matches[0]


def changelog(component, version):
    text = Path(f"apps/{component}/CHANGELOG.md").read_text()
    match = re.search(r"^## " + re.escape(version) + r"\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not match or not match.group(1).strip():
        raise PublishError(f"Missing changelog for {component} {version}")
    return f"# {component} {version}\n\n{match.group(1).strip()}\n"


def write_checksums(directory):
    files = sorted(p for p in directory.iterdir() if p.is_file() and p.name != "SHA256SUMS")
    (directory / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in files))


def publish_image():
    version, commit, repo = identity("web")
    notes = changelog("web", version)
    registry, repository = required("ACR_REGISTRY"), required("ACR_IMAGE")
    if not repository.startswith(registry + "/") or ":" in repository[len(registry):] or "@" in repository:
        raise PublishError("ACR_IMAGE must be a full registry/repository without tag")
    run("docker", "login", registry, "--username", required("ACR_USERNAME"), "--password-stdin", input=required("ACR_PASSWORD") + "\n")
    refs = [f"{repository}:v{version}", f"{repository}:sha-{commit}"]
    existing = {ref: remote_image(ref) for ref in refs}
    candidate_ref = os.environ.get("SAYSEED_CANDIDATE_IMAGE")
    reusable = next((image for image in existing.values() if image), None)
    if candidate_ref:
        candidate = local_image(candidate_ref)
    elif reusable:
        candidate = reusable
    else:
        candidate_ref = f"sayseed-candidate:{commit}"
        run("docker", "build", "--build-arg", f"RELEASE_VERSION={version}", "--build-arg", f"RELEASE_COMMIT={commit}", "--build-arg", f"SOURCE_REPOSITORY=https://github.com/{repo}", "--label", f"org.opencontainers.image.version={version}", "--label", f"org.opencontainers.image.revision={commit}", "--label", f"org.opencontainers.image.source=https://github.com/{repo}", "--tag", candidate_ref, ".")
        candidate = local_image(candidate_ref)
    assert_labels(candidate, version, commit, repo)
    stable_ref = f"{repository}:stable"
    previous = remote_image(stable_ref)
    assert_stable(previous, candidate, version, repo)
    for ref, current in existing.items():
        assert_same(current, candidate, ref)
    smoke = ["node", "scripts/docker-smoke.mjs", "--image", candidate["Id"]]
    run(*smoke)
    if previous:
        run(*smoke, "--previous-image", digest_for(previous, repository))
    for ref in refs:
        # Recheck after validation; workflow concurrency must serialize all publishers.
        assert_same(remote_image(ref), candidate, ref)
        run("docker", "tag", candidate["Id"], ref)
        run("docker", "push", ref)
        assert_same(remote_image(ref), candidate, ref)
    published = remote_image(refs[0])
    digest = digest_for(published, repository)
    output = Path("build/release/web")
    output.mkdir(parents=True, exist_ok=True)
    if any(p.name not in {"release.json", "image-digest.txt", "SHA256SUMS", "CHANGELOG.md"} for p in output.iterdir()):
        raise PublishError("Unexpected files in release directory")
    (output / "release.json").write_text(json.dumps({"component": "web", "version": version, "commit": commit, "image": digest}, indent=2) + "\n")
    (output / "image-digest.txt").write_text(digest + "\n")
    (output / "CHANGELOG.md").write_text(notes)
    write_checksums(output)
    verify_directory(output, "web", version, commit)
    assert_stable(remote_image(stable_ref), candidate, version, repo)
    run("docker", "tag", candidate["Id"], stable_ref)
    run("docker", "push", stable_ref)
    assert_same(remote_image(stable_ref), candidate, stable_ref)


def api(path, method="GET", data=None, missing=False):
    args = ["gh", "api", path, "--method", method]
    if data is not None:
        args += ["--input", "-"]
    result = subprocess.run(args, input=json.dumps(data) if data is not None else None, capture_output=True, text=True)
    if result.returncode:
        if missing and "(HTTP 404)" in result.stderr:
            return None
        raise PublishError(f"GitHub API {method} {path} failed: {result.stderr.strip()}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def verify_directory(directory, component, version, commit):
    files = {p.name: p for p in directory.iterdir()}
    if any(not p.is_file() or p.is_symlink() for p in files.values()):
        raise PublishError("Release directory must contain only regular files")
    metadata = json.loads(files["release.json"].read_text())
    if any(metadata.get(k) != v for k, v in {"component": component, "version": version, "commit": commit}.items()):
        raise PublishError("Release metadata identity mismatch")
    checksums = {}
    for line in files["SHA256SUMS"].read_text().splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        if not match or match[2] in checksums:
            raise PublishError("Invalid checksum manifest")
        checksums[match[2]] = match[1]
    if set(checksums) != set(files) - {"SHA256SUMS"}:
        raise PublishError("Checksum manifest must cover every release file")
    for name, checksum in checksums.items():
        if hashlib.sha256(files[name].read_bytes()).hexdigest() != checksum:
            raise PublishError(f"Checksum mismatch: {name}")
    if "CHANGELOG.md" not in files:
        raise PublishError("Missing release changelog")
    return files


def verify_tag(base, tag, commit):
    ref = api(f"{base}/git/ref/tags/{tag}", missing=True)
    if ref is None:
        api(f"{base}/git/refs", "POST", {"ref": f"refs/tags/{tag}", "sha": commit})
        ref = api(f"{base}/git/ref/tags/{tag}")
    obj = ref["object"]
    for _ in range(5):
        if obj["type"] != "tag":
            break
        obj = api(f"{base}/git/tags/{obj['sha']}")["object"]
    if obj["type"] != "commit" or obj["sha"] != commit:
        raise PublishError("Release tag points to another commit")


def verify_assets(base, release, files, allow_missing):
    # The small, fixed asset set fits one page. Extra assets are always rejected.
    assets = api(f"{base}/releases/{release['id']}/assets?per_page=100")
    seen = set()
    for asset in assets:
        name = asset["name"]
        if name not in files or name in seen:
            raise PublishError(f"Unexpected or duplicated release asset: {name}")
        downloaded = run("gh", "api", f"{base}/releases/assets/{asset['id']}", "-H", "Accept: application/octet-stream", binary=True)
        if downloaded != files[name].read_bytes():
            raise PublishError(f"Published asset differs: {name}")
        seen.add(name)
    missing = set(files) - seen
    if missing and not allow_missing:
        raise PublishError(f"Published release missing assets: {sorted(missing)}")
    return missing


def publish_github(component, directory):
    version, commit, repo = identity(component)
    required("GH_TOKEN")
    files = verify_directory(directory, component, version, commit)
    body = files["CHANGELOG.md"].read_text()
    tag = ("v" if component == "web" else "extension-v") + version
    base = f"repos/{repo}"
    verify_tag(base, tag, commit)
    release = api(f"{base}/releases/tags/{tag}", missing=True)
    if release is None:
        release = api(f"{base}/releases", "POST", {"tag_name": tag, "target_commitish": commit, "name": tag, "body": body, "draft": True, "prerelease": False})
    if release["tag_name"] != tag or release.get("prerelease") or release.get("body", "") != body:
        raise PublishError("Existing release identity or notes differ")
    missing = verify_assets(base, release, files, allow_missing=release["draft"])
    for name in sorted(missing):
        run("gh", "release", "upload", tag, str(files[name]), "--repo", repo)
    verify_assets(base, release, files, allow_missing=False)
    verify_tag(base, tag, commit)
    if release["draft"]:
        api(f"{base}/releases/{release['id']}", "PATCH", {"draft": False, "make_latest": "false"})
    final = api(f"{base}/releases/tags/{tag}")
    if final["draft"]:
        raise PublishError("Release remains a draft")
    verify_assets(base, final, files, allow_missing=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("image")
    github = commands.add_parser("github")
    github.add_argument("--component", required=True, choices=["web", "extension"])
    github.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "image":
            publish_image()
        else:
            publish_github(args.component, args.directory)
    except (PublishError, OSError, ValueError, KeyError) as error:
        print(f"Release aborted: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
