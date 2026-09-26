"""Validate channel isolation, trusted baselines and immutable publication guards."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('registry_publication', Path(__file__).with_name('registry-publication.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
META = {'component': 'web', 'version': '1.2.0', 'commit': 'a' * 40, 'digest': 'sha256:' + 'b' * 64}


def info(version='1.2.0', digest=META['digest']):
    return {'Digest': digest, 'Architecture': 'amd64', 'Os': 'linux', 'Labels': {
        'org.opencontainers.image.version': version,
        'org.opencontainers.image.revision': META['commit'],
        'org.opencontainers.image.source': 'https://github.com/example/sayseed'}}


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'GITHUB_REPOSITORY': 'example/sayseed', 'ACR_IMAGE': 'registry.example/sayseed'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_fallback_uses_same_digest_and_never_skips_missing_baseline(self):
        with patch.object(module, 'login', side_effect=[module.Error('network'), None]) as login, patch.object(module, 'inspect', return_value=info()), patch.object(module, 'copy') as copy:
            module.fetch(META, 'oci-archive:previous.tar')
            self.assertEqual([c.args[0] for c in login.call_args_list], ['ghcr', 'acr'])
            self.assertIn('@' + META['digest'], copy.call_args.args[0])
        with patch.object(module, 'login', side_effect=module.Error('missing')), self.assertRaises(module.Error):
            module.fetch(META, 'oci-archive:previous.tar')

    def test_platform_and_source_mismatch_rejected(self):
        for field, value in [('Architecture', 'arm64'), ('Os', 'windows'), ('Digest', 'wrong')]:
            bad = info()
            bad[field] = value
            with self.subTest(field=field), self.assertRaises(module.Error):
                module.validate(bad, META)

    def test_same_version_cannot_be_replaced_or_stable_downgraded(self):
        for previous, stable in [(info(digest='wrong'), False), (info(digest='wrong'), True), (info('1.3.0'), True)]:
            with self.subTest(previous=previous), self.assertRaises(module.Error):
                module.guard(previous, META, stable)
        module.guard(info('1.1.0'), META, True)
        module.guard(info(), META, True)

    def test_failed_immutable_upload_never_promotes_stable(self):
        with patch.object(module, 'login'), patch.object(module, 'inspect', side_effect=[info(), None, None, None, None]), patch.object(module, 'copy', side_effect=module.Error('unavailable')) as copy:
            with self.assertRaises(module.Error):
                module.publish('acr', 'oci-archive:image.tar', META)
            self.assertFalse(any(c.args[-1].endswith(':stable') for c in copy.call_args_list))

    def test_transfer_never_changes_stable(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(module, 'login'), patch.object(module, 'inspect', side_effect=[info(), None, None, None, info(), None, info()]), patch.object(module, 'copy') as copy:
            old = os.getcwd()
            try:
                os.chdir(tmp)
                module.publish('ghcr', 'oci-archive:image.tar', META, promote=False)
                self.assertTrue(Path('build/release/results/ghcr.json').exists())
                self.assertFalse(any(c.args[-1].endswith(':stable') for c in copy.call_args_list))
            finally:
                os.chdir(old)

    def test_one_success_can_produce_release_but_both_fail_cannot(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(module.release, 'api', return_value=None):
            old = os.getcwd()
            try:
                os.chdir(tmp)
                results = Path('build/release/results')
                results.mkdir(parents=True)
                with self.assertRaises(module.Error):
                    module.summarize(results)
                candidate = Path('build/release/candidate')
                candidate.mkdir()
                (candidate / 'CHANGELOG.md').write_text('notes')
                (results / 'ghcr.json').write_text(json.dumps({**META, 'image': 'ghcr.io/example/sayseed@' + META['digest']}))
                module.summarize(results)
                module.release.verify_directory(Path('build/release/web'), 'web', META['version'], META['commit'])
            finally:
                os.chdir(old)

    def test_missing_formal_release_is_not_first_install(self):
        with patch.object(module.release, 'api', return_value=None), self.assertRaises(module.Error):
            module.trusted('1.1.0')

    def test_retry_recovers_existing_tags_without_rebuilding(self):
        with patch.object(module, 'login'), patch.object(module, 'inspect', side_effect=[info(), None, info(), info()]), patch.object(module, 'fetch') as fetch:
            self.assertEqual(module.recover_published(META['version'], META['commit'], 'archive'), META)
            fetch.assert_called_once_with(META, 'archive')
        with patch.object(module, 'login'), patch.object(module, 'inspect', side_effect=[info(), info(digest='sha256:wrong')]), self.assertRaises(module.Error):
            module.recover_published(META['version'], META['commit'], 'archive')

    def test_acr_lookup_failure_does_not_block_ghcr_recovery(self):
        with patch.object(module, 'login', side_effect=[None, module.Error('unreachable')]), patch.object(module, 'inspect', return_value=info()), patch.object(module, 'fetch') as fetch:
            self.assertEqual(module.recover_published(META['version'], META['commit'], 'archive'), META)
            fetch.assert_called_once()

    def test_trusted_metadata_checksum_and_digest_must_agree(self):
        raw = json.dumps({**META, 'image': 'ghcr.io/example/sayseed@' + META['digest']}).encode()
        digest = b'contradictory image'
        import hashlib
        sums = hashlib.sha256(raw).hexdigest() + '  release.json\n' + hashlib.sha256(digest).hexdigest() + '  image-digest.txt\n'
        published = {'draft': False, 'prerelease': False, 'assets': [{'id': 1, 'name': 'release.json'}, {'id': 2, 'name': 'SHA256SUMS'}, {'id': 3, 'name': 'image-digest.txt'}]}
        with patch.object(module.release, 'api', return_value=published), patch.object(module.release, 'run', side_effect=[raw, sums, digest]), self.assertRaisesRegex(module.Error, 'contradicts'):
            module.trusted('1.2.0')
        with patch.object(module.release, 'api', return_value=published), patch.object(module.release, 'run', side_effect=[raw, 'wrong  release.json']), self.assertRaisesRegex(module.Error, 'checksum mismatch'):
            module.trusted('1.2.0')

    def test_receipt_missing_allows_first_build_but_api_failure_is_not_absence(self):
        with patch.object(module.release, 'api', return_value=[]):
            self.assertIsNone(module.candidate_receipt(META['commit']))
        with patch.object(module.release, 'api', side_effect=module.Error('network')), self.assertRaises(module.Error):
            module.candidate_receipt(META['commit'])

    def test_receipt_cannot_be_replaced_with_a_different_digest(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'CANDIDATE_ARTIFACT_ID': '2', 'GITHUB_RUN_ID': '1'}), patch.object(module.release, 'identity', return_value=(META['version'], META['commit'], 'example/sayseed')), patch.object(module, 'candidate_receipt', return_value={'description': '1.2.0 sha256:other'}), patch.object(module.release, 'api') as api:
            old = os.getcwd()
            try:
                os.chdir(tmp)
                candidate = Path('build/release/candidate')
                candidate.mkdir(parents=True)
                (candidate / 'candidate.json').write_text(json.dumps(META))
                with self.assertRaisesRegex(module.Error, 'conflicting'):
                    module.record_receipt()
                api.assert_not_called()
            finally:
                os.chdir(old)

    def test_recorded_artifact_expiry_blocks_rebuild(self):
        receipt = {'description': META['version'] + ' ' + META['digest'], 'target_url': 'https://github.com/example/sayseed/actions/runs/1/artifacts/2'}
        with tempfile.TemporaryDirectory() as tmp, patch.object(module.release, 'api', return_value={'expired': True}), self.assertRaisesRegex(module.Error, 'refusing to rebuild'):
            module.restore_receipt(receipt, META['version'], META['commit'], Path(tmp))

    def test_receipt_restores_only_verified_original_candidate(self):
        import io
        import zipfile
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as contents:
            contents.writestr('candidate.json', json.dumps(META))
            contents.writestr('image.tar', b'original OCI')
            contents.writestr('CHANGELOG.md', 'notes')
        receipt = {'description': META['version'] + ' ' + META['digest'], 'target_url': 'https://github.com/example/sayseed/actions/runs/1/artifacts/2'}
        api_results = [{'name': 'web-candidate-' + META['commit'], 'expired': False, 'workflow_run': {'id': 1}},
                       {'repository': {'full_name': 'example/sayseed'}, 'path': '.github/workflows/release.yml', 'event': 'workflow_dispatch'},
                       {'jobs': [{'name': 'publish', 'conclusion': 'failure'}] * 100},
                       {'jobs': [{'name': 'source', 'conclusion': 'success'}]}]
        with tempfile.TemporaryDirectory() as tmp, patch.object(module.release, 'api', side_effect=api_results) as api, patch.object(module.release, 'run', return_value=archive.getvalue()), patch.object(module, 'inspect', return_value=info()):
            self.assertEqual(module.restore_receipt(receipt, META['version'], META['commit'], Path(tmp)), META)
            self.assertEqual((Path(tmp) / 'image.tar').read_bytes(), b'original OCI')
            self.assertIn('filter=all&per_page=100&page=2', api.call_args_list[3].args[0])

    def test_prepare_with_recorded_candidate_never_builds_unknown_registry(self):
        receipt = {'context': module.RECEIPT_CONTEXT}
        with tempfile.TemporaryDirectory() as tmp, patch.object(module.release, 'identity', return_value=(META['version'], META['commit'], 'example/sayseed')), patch.object(module.release, 'api', return_value=None), patch.object(module, 'candidate_receipt', return_value=receipt), patch.object(module, 'restore_receipt') as restore, patch.object(module, 'recover_published') as recover, patch.object(module, 'run') as run:
            old = os.getcwd()
            try:
                os.chdir(tmp)
                module.prepare()
                restore.assert_called_once()
                recover.assert_not_called()
                run.assert_not_called()
            finally:
                os.chdir(old)

    def test_workflow_independent_jobs_and_trusted_route(self):
        workflow = Path(__file__).parents[1].joinpath('.github/workflows/release.yml').read_text()
        self.assertIn('fail-fast: false', workflow)
        self.assertIn('statuses: write', workflow)
        self.assertIn('scripts/registry-publication.py receipt', workflow)
        self.assertLess(workflow.index('scripts/registry-publication.py receipt'), workflow.index('  publish:'))
        self.assertIn('channel: [acr, ghcr]', workflow)
        self.assertNotIn('continue-on-error:', workflow)
        self.assertIn("pr.head.ref !== 'changeset-release/main'", workflow)
        self.assertIn("needs.plan.outputs.web == 'true'", workflow)
        self.assertIn("needs.plan.outputs.extension == 'true'", workflow)
        self.assertIn("if: always() && needs.web.result == 'success'", workflow)


if __name__ == '__main__':
    unittest.main()
