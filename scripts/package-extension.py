#!/usr/bin/env python3
"""Build a reproducible, audited Chrome extension release archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ALLOWED_SUFFIXES = {'.js', '.css', '.html', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.wasm', '.txt'}


def package_extension(source, destination, package, commit):
    source, destination, package = Path(source), Path(destination), Path(package)
    version = json.loads(package.read_text())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Only stable package versions can be released')
    changelog = package.with_name('CHANGELOG.md').read_text()
    section = re.search(r'^## ' + re.escape(version) + r'[ \t]*\r?\n(.*?)(?=^## |\Z)', changelog, re.M | re.S)
    if not section or not section.group(1).strip():
        raise ValueError('Extension changelog must contain release notes for the package version')
    notes = f'## {version}\n\n{section.group(1).strip()}\n'
    if not re.fullmatch(r'[0-9a-f]{40,64}', commit):
        raise ValueError('Release commit must be a full Git SHA')
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Input must be a real directory')
    if destination.resolve().is_relative_to(source.resolve()):
        raise ValueError('Output must be outside the extension input')
    files = []
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source)
        if path.is_symlink():
            raise ValueError(f'Symlinks are forbidden: {relative}')
        if any(part.startswith('.') for part in relative.parts):
            raise ValueError(f'Hidden release content is forbidden: {relative}')
        if path.is_dir():
            continue
        if not path.is_file() or path.suffix.lower() not in ALLOWED_SUFFIXES:
            raise ValueError(f'Unsupported release file: {relative}')
        if any(re.search(r'(?:^|[._-])(?:secret|secrets|credentials|private|id_rsa)(?:$|[._-])', part, re.I) for part in relative.parts):
            raise ValueError(f'Sensitive filename is forbidden: {relative}')
        content = path.read_bytes()
        if b'PRIVATE KEY-----' in content or re.search(rb'\b(?:sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}', content):
            raise ValueError(f'Credential content is forbidden: {relative}')
        if re.search(rb'sourceMappingURL\s*=\s*data:', content):
            raise ValueError(f'Inline source maps are forbidden: {relative}')
        files.append((relative.as_posix(), content))
    manifest = json.loads(dict(files).get('manifest.json', b'null'))
    if not isinstance(manifest, dict) or manifest.get('version') != version:
        raise ValueError('Built manifest version does not match extension package version')
    if manifest.get('manifest_version') != 3 or 'key' in manifest:
        raise ValueError('Expected a Manifest V3 extension without an embedded signing key')
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Output directory must be empty to prevent stale release assets')
    destination.mkdir(parents=True, exist_ok=True)
    filename = f'sayseed-extension-{version}.zip'
    with zipfile.ZipFile(destination / filename, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in files:
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content, compresslevel=9)
    metadata = {'component': 'extension', 'version': version, 'commit': commit,
                'tag': f'extension-v{version}', 'assets': [filename]}
    (destination / 'release.json').write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
    (destination / 'CHANGELOG.md').write_text(notes)
    checksums = ''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n'
                        for path in sorted(destination.iterdir()))
    (destination / 'SHA256SUMS').write_text(checksums)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='apps/extension/.output/chrome-mv3')
    parser.add_argument('--output', default='build/release/extension')
    parser.add_argument('--package', default='apps/extension/package.json')
    args = parser.parse_args()
    commit = os.environ.get('RELEASE_COMMIT') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    print(json.dumps(package_extension(args.input, args.output, args.package, commit)))


if __name__ == '__main__':
    main()
