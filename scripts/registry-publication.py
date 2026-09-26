#!/usr/bin/env python3
"""Build once and independently publish digest-preserving registry copies."""
import argparse
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import zipfile

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('publish-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
Error = release.PublishError


def run(*args, input=None):
    timeout = 1200 if args[:2] == ('docker', 'build') or args[0] == 'node' else 300
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise Error(f'{args[0]} {args[1]} failed: {result.stderr.strip()}')
    return result.stdout


def repositories():
    repo = release.required('GITHUB_REPOSITORY')
    return {'ghcr': f'ghcr.io/{repo.lower()}', 'acr': release.required('ACR_IMAGE')}


def login(channel):
    registry = 'ghcr.io' if channel == 'ghcr' else release.required('ACR_REGISTRY')
    username = release.required('GITHUB_ACTOR' if channel == 'ghcr' else 'ACR_USERNAME')
    password = release.required('GH_TOKEN' if channel == 'ghcr' else 'ACR_PASSWORD')
    run('skopeo', 'login', registry, '--username', username, '--password-stdin', input=password + '\n')


def copy(source, destination):
    for attempt in range(3):
        try:
            run('skopeo', 'copy', *([] if (destination.startswith('docker-daemon:') or source.startswith('docker-daemon:')) else ['--preserve-digests']), source, destination)
            return
        except (Error, subprocess.TimeoutExpired):
            if attempt == 2:
                raise
            time.sleep(5)


def inspect(ref, missing=False):
    try:
        return json.loads(run('skopeo', 'inspect', ref))
    except Error as error:
        if missing and any(text in str(error).lower() for text in ('manifest unknown', 'name unknown')):
            return None
        raise


def validate(info, metadata):
    expected = {'version': metadata['version'], 'revision': metadata['commit'],
                'source': 'https://github.com/' + release.required('GITHUB_REPOSITORY')}
    if any(info.get('Labels', {}).get('org.opencontainers.image.' + key) != value for key, value in expected.items()):
        raise Error('Unexpected OCI identity')
    if info.get('Architecture') != 'amd64' or info.get('Os') != 'linux':
        raise Error('Expected linux/amd64 image')
    if info.get('Digest') != metadata['digest']:
        raise Error('Image digest differs from trusted metadata')


def trusted(version):
    release.version_tuple(version)
    base = 'repos/' + release.required('GITHUB_REPOSITORY')
    published = release.api(f'{base}/releases/tags/v{version}', missing=True)
    if not published or published['draft'] or published['prerelease']:
        raise Error('Required formal release is missing')
    assets = [asset for asset in published['assets'] if asset['name'] == 'release.json']
    if len(assets) != 1:
        raise Error('Required release metadata is missing')
    raw = release.run('gh', 'api', f"{base}/releases/assets/{assets[0]['id']}", '-H', 'Accept: application/octet-stream', binary=True)
    checksum_assets = [asset for asset in published['assets'] if asset['name'] == 'SHA256SUMS']
    if len(checksum_assets) != 1:
        raise Error('Release checksums are missing')
    sums = release.run('gh', 'api', f"{base}/releases/assets/{checksum_assets[0]['id']}", '-H', 'Accept: application/octet-stream')
    expected = [line.split('  ')[0] for line in sums.splitlines() if line.endswith('  release.json')]
    if expected != [hashlib.sha256(raw).hexdigest()]:
        raise Error('Release metadata checksum mismatch')
    metadata = json.loads(raw)
    digest_assets = [asset for asset in published['assets'] if asset['name'] == 'image-digest.txt']
    if len(digest_assets) != 1:
        raise Error('Release image digest asset is missing')
    digest_raw = release.run('gh', 'api', f"{base}/releases/assets/{digest_assets[0]['id']}", '-H', 'Accept: application/octet-stream', binary=True)
    digest_sums = [line.split('  ')[0] for line in sums.splitlines() if line.endswith('  image-digest.txt')]
    if digest_sums != [hashlib.sha256(digest_raw).hexdigest()] or digest_raw.decode().strip() != metadata.get('image'):
        raise Error('Release digest asset contradicts metadata or checksum')
    if metadata.get('component') != 'web' or metadata.get('version') != version or not re.fullmatch('[0-9a-f]{40}', metadata.get('commit', '')):
        raise Error('Invalid release identity')
    image = metadata.get('image', '')
    if '@' not in image or image.split('@')[0] not in repositories().values() or not re.fullmatch('sha256:[0-9a-f]{64}', image.split('@')[-1]):
        raise Error('Untrusted release image')
    obj = release.api(f'{base}/git/ref/tags/v{version}')['object']
    for _ in range(5):
        if obj['type'] != 'tag':
            break
        obj = release.api(f"{base}/git/tags/{obj['sha']}")['object']
    if obj['type'] != 'commit' or obj['sha'] != metadata['commit']:
        raise Error('Release tag differs from metadata')
    return {**metadata, 'digest': image.split('@')[1]}


def fetch(metadata, destination):
    failures = []
    for channel, repository in repositories().items():
        try:
            login(channel)
            ref = 'docker://' + repository + '@' + metadata['digest']
            validate(inspect(ref), metadata)
            copy(ref, destination)
            return
        except (Error, subprocess.TimeoutExpired) as error:
            failures.append(channel + ': ' + str(error))
    raise Error('No verified source available: ' + '; '.join(failures))


def recover_published(version, commit, archive):
    recovered = None
    inspected = False
    for channel, repository in repositories().items():
        try:
            login(channel)
            existing = [(ref, inspect('docker://' + ref, missing=True)) for ref in
                        (f'{repository}:v{version}', f'{repository}:sha-{commit}')]
            inspected = True
        except (Error, subprocess.TimeoutExpired) as error:
            print(f'Candidate lookup unavailable in {channel}: {error}', file=sys.stderr)
            continue
        for ref, info in existing:
            if info is None:
                continue
            metadata = {'component': 'web', 'version': version, 'commit': commit, 'digest': info['Digest']}
            validate(info, metadata)
            if recovered and recovered['digest'] != metadata['digest']:
                raise Error('Existing version/commit tags disagree across registries')
            recovered = metadata
    if recovered:
        fetch(recovered, archive)
    elif not inspected:
        raise Error('Cannot inspect either registry before building a release')
    return recovered


RECEIPT_CONTEXT = 'sayseed/registry-candidate'


def candidate_receipt(commit):
    base = 'repos/' + release.required('GITHUB_REPOSITORY')
    page = 1
    while True:
        statuses = release.api(f'{base}/commits/{commit}/statuses?per_page=100&page={page}')
        for status in statuses:
            if status.get('context') == RECEIPT_CONTEXT:
                if status.get('state') != 'success' or status.get('creator', {}).get('login') != 'github-actions[bot]':
                    raise Error('Candidate receipt has an unexpected issuer or state')
                return status
        if len(statuses) < 100:
            return None
        page += 1


def restore_receipt(receipt, version, commit, output):
    repo = release.required('GITHUB_REPOSITORY')
    match = re.fullmatch(re.escape(f'https://github.com/{repo}/actions/runs/') + r'(\d+)/artifacts/(\d+)', receipt.get('target_url', ''))
    digest_match = re.fullmatch(re.escape(version) + r' (sha256:[0-9a-f]{64})', receipt.get('description', ''))
    if not match or not digest_match:
        raise Error('Candidate receipt identity or artifact URL is invalid')
    run_id, artifact_id = match.groups()
    base = 'repos/' + repo
    artifact = release.api(f'{base}/actions/artifacts/{artifact_id}')
    if artifact.get('expired') or not re.fullmatch(r'web-candidate-' + re.escape(commit) + r'(?:-\d+-\d+)?', artifact.get('name', '')) or str(artifact.get('workflow_run', {}).get('id')) != run_id:
        raise Error('Recorded candidate artifact is expired or has a different identity; refusing to rebuild')
    workflow = release.api(f'{base}/actions/runs/{run_id}')
    if workflow.get('repository', {}).get('full_name') != repo or workflow.get('path', '').split('@')[0] != '.github/workflows/release.yml' or workflow.get('event') not in ('pull_request', 'workflow_dispatch'):
        raise Error('Candidate artifact came from an untrusted workflow')
    page = 1
    while True:
        jobs = release.api(f'{base}/actions/runs/{run_id}/jobs?filter=all&per_page=100&page={page}')['jobs']
        if any(job.get('name') == 'source' and job.get('conclusion') == 'success' for job in jobs):
            break
        if len(jobs) < 100:
            raise Error('Candidate run did not validate its version PR')
        page += 1
    archive = release.run('gh', 'api', f'{base}/actions/artifacts/{artifact_id}/zip', binary=True)
    if artifact.get('digest') and artifact['digest'] != 'sha256:' + hashlib.sha256(archive).hexdigest():
        raise Error('Candidate artifact checksum differs')
    with zipfile.ZipFile(io.BytesIO(archive)) as contents:
        if sorted(contents.namelist()) != ['CHANGELOG.md', 'candidate.json', 'image.tar']:
            raise Error('Unexpected candidate artifact contents')
        for name in contents.namelist():
            (output / name).write_bytes(contents.read(name))
    metadata = json.loads((output / 'candidate.json').read_text())
    if any(metadata.get(key) != value for key, value in {'component': 'web', 'version': version, 'commit': commit, 'digest': digest_match[1]}.items()):
        raise Error('Candidate artifact contradicts durable receipt')
    validate(inspect('oci-archive:' + str(output / 'image.tar')), metadata)
    return metadata


def record_receipt():
    version, commit, repo = release.identity('web')
    metadata = json.loads(Path('build/release/candidate/candidate.json').read_text())
    if metadata['version'] != version or metadata['commit'] != commit or not re.fullmatch(r'sha256:[0-9a-f]{64}', metadata['digest']):
        raise Error('Cannot record a candidate with a different release identity')
    artifact_id = release.required('CANDIDATE_ARTIFACT_ID')
    run_id = release.required('GITHUB_RUN_ID')
    if not artifact_id.isdigit() or not run_id.isdigit():
        raise Error('Invalid candidate artifact or run ID')
    previous = candidate_receipt(commit)
    description = version + ' ' + metadata['digest']
    if previous and previous.get('description') != description:
        raise Error('Refusing to replace a conflicting durable candidate receipt')
    if previous:
        return
    release.api(f'repos/{repo}/statuses/{commit}', 'POST', {
        'state': 'success', 'context': RECEIPT_CONTEXT,
        'description': description,
        'target_url': f'https://github.com/{repo}/actions/runs/{run_id}/artifacts/{artifact_id}',
    })


def prepare():
    version, commit, repo = release.identity('web')
    output = Path('build/release/candidate')
    output.mkdir(parents=True, exist_ok=True)
    archive = 'oci-archive:' + str(output / 'image.tar')
    current = release.api(f'repos/{repo}/releases/tags/v{version}', missing=True)
    if current and not current.get('draft'):
        metadata = trusted(version)
        if metadata['commit'] != commit:
            raise Error('Existing version belongs to another commit')
        fetch(metadata, archive)
        validate(inspect(archive), metadata)
        (output / 'candidate.json').write_text(json.dumps(metadata, indent=2) + '\n')
        (output / 'CHANGELOG.md').write_text(release.changelog('web', version))
        return
    else:
        receipt = candidate_receipt(commit)
        if receipt:
            restore_receipt(receipt, version, commit, output)
            return
        metadata = recover_published(version, commit, archive)
        if metadata:
            copy(archive, 'docker-daemon:sayseed-candidate:release')
        else:
            run('docker', 'build', '--platform', 'linux/amd64', '--build-arg', f'RELEASE_VERSION={version}', '--build-arg', f'RELEASE_COMMIT={commit}', '--build-arg', f'SOURCE_REPOSITORY=https://github.com/{repo}', '--tag', 'sayseed-candidate:release', '.')
            copy('docker-daemon:sayseed-candidate:release', archive)
            info = inspect(archive)
            metadata = {'component': 'web', 'version': version, 'commit': commit, 'digest': info['Digest']}
    validate(inspect(archive), metadata)
    run('node', 'scripts/docker-smoke.mjs', '--image', 'sayseed-candidate:release')
    previous_version = json.loads(run('git', 'show', 'HEAD^:apps/web/package.json'))['version']
    first_release = False
    if previous_version == '0.1.0' and version == '0.1.1':
        releases = release.api(f'repos/{repo}/releases?per_page=100')
        first_release = len(releases) < 100 and not any(not r.get('draft') and re.fullmatch(r'v\d+\.\d+\.\d+', r.get('tag_name', '')) for r in releases)
    if first_release:
        print('Verified initial 0.1.0 development baseline; no prior formal web release')
    elif previous_version != version:
        previous = trusted(previous_version)
        fetch(previous, 'docker-daemon:sayseed-previous:release')
        run('node', 'scripts/docker-smoke.mjs', '--image', 'sayseed-candidate:release', '--previous-image', 'sayseed-previous:release')
    else:
        raise Error('Version release must identify a previous version')
    (output / 'candidate.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (output / 'CHANGELOG.md').write_text(release.changelog('web', version))


def guard(existing, metadata, stable=False):
    if existing is None:
        return
    if stable:
        if existing.get('Labels', {}).get('org.opencontainers.image.source') != 'https://github.com/' + release.required('GITHUB_REPOSITORY'):
            raise Error('Stable belongs to another source')
        version = existing.get('Labels', {}).get('org.opencontainers.image.version', '')
        if release.version_tuple(version) > release.version_tuple(metadata['version']):
            raise Error('Refusing to downgrade stable')
        if version != metadata['version']:
            return
    if existing['Digest'] != metadata['digest']:
        raise Error('Refusing to overwrite different immutable image')


def publish(channel, source, metadata, promote=True):
    login(channel)
    repository = repositories()[channel]
    validate(inspect(source), metadata)
    refs = [f"{repository}:v{metadata['version']}", f"{repository}:sha-{metadata['commit']}"]
    if promote:
        refs.append(repository + ':stable')
    for ref in refs:
        guard(inspect('docker://' + ref, missing=True), metadata, ref.endswith(':stable'))
    for ref in refs:
        guard(inspect('docker://' + ref, missing=True), metadata, ref.endswith(':stable'))
        copy(source, 'docker://' + ref)
        validate(inspect('docker://' + ref), metadata)
    result = Path('build/release/results')
    result.mkdir(parents=True, exist_ok=True)
    (result / f'{channel}.json').write_text(json.dumps({**metadata, 'image': repository + '@' + metadata['digest']}))


def summarize(directory):
    results = sorted(Path(directory).glob('*.json'))
    summary = '\n'.join(f"- {channel.upper()}: {'success' if any(p.stem == channel for p in results) else 'FAILED (no verified result)'}" for channel in ('acr', 'ghcr'))
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write('## Registry publication\n' + summary + '\n')
    if not results:
        raise Error('Both registry publications failed')
    metadata = json.loads(results[0].read_text())
    for result in results[1:]:
        other = json.loads(result.read_text())
        if any(other[key] != metadata[key] for key in ('version', 'commit', 'digest')):
            raise Error('Registry publication identities differ')
    existing = release.api('repos/' + release.required('GITHUB_REPOSITORY') + '/releases/tags/v' + metadata['version'], missing=True)
    if existing:
        # Preserve an existing immutable release asset even after another channel is repaired.
        trusted_metadata = trusted(metadata['version']) if not existing.get('draft') else None
        if existing.get('draft'):
            assets = [a for a in existing.get('assets', []) if a['name'] == 'release.json']
            if assets:
                trusted_metadata = json.loads(release.run('gh', 'api', 'repos/' + release.required('GITHUB_REPOSITORY') + '/releases/assets/' + str(assets[0]['id']), '-H', 'Accept: application/octet-stream'))
                original_image = trusted_metadata.get('image', '')
                if '@' not in original_image or original_image.split('@')[0] not in repositories().values():
                    raise Error('Draft release has an untrusted image')
                trusted_metadata['digest'] = original_image.split('@')[1]
        if trusted_metadata:
            if any(trusted_metadata[key] != metadata[key] for key in ('version', 'commit', 'digest')):
                raise Error('Existing release identity differs')
            metadata['image'] = trusted_metadata['image']
    output = Path('build/release/web')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'release.json').write_text(json.dumps({key: metadata[key] for key in ('component', 'version', 'commit', 'image')}, indent=2) + '\n')
    (output / 'image-digest.txt').write_text(metadata['image'] + '\n')
    (output / 'CHANGELOG.md').write_text(Path('build/release/candidate/CHANGELOG.md').read_text())
    release.write_checksums(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'publish', 'transfer', 'summarize', 'receipt'])
    parser.add_argument('--channel', choices=['acr', 'ghcr'])
    parser.add_argument('--version')
    parser.add_argument('--advance-stable', action='store_true')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare()
    elif args.command == 'receipt':
        record_receipt()
    elif args.command == 'summarize':
        summarize('build/release/results')
    elif args.command == 'publish':
        publish(args.channel, 'oci-archive:build/release/candidate/image.tar', json.loads(Path('build/release/candidate/candidate.json').read_text()))
    else:
        metadata = trusted(args.version)
        Path('build/release/candidate').mkdir(parents=True, exist_ok=True)
        source = 'oci-archive:build/release/candidate/image.tar'
        fetch(metadata, source)
        if args.advance_stable:
            releases = release.api('repos/' + release.required('GITHUB_REPOSITORY') + '/releases?per_page=100')
            if len(releases) >= 100 or any(not r.get('draft') and not r.get('prerelease') and re.fullmatch(r'v\d+\.\d+\.\d+', r.get('tag_name', '')) and release.version_tuple(r['tag_name'][1:]) > release.version_tuple(metadata['version']) for r in releases):
                raise Error('Only the newest formal version may advance stable')
        publish(args.channel, source, metadata, promote=args.advance_stable)


if __name__ == '__main__':
    try:
        main()
    except (Error, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f'Publication failed: {error}', file=sys.stderr)
        sys.exit(1)
