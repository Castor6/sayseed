import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sayseed_update', Path(__file__).parent / 'deploy/sayseed-update.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def config(root):
    return {'app_dir': str(root / 'app'), 'state_dir': str(root / 'state'),
            'backup_dir': str(root / 'backups'), 'image_repository': 'registry.example/team/sayseed',
            'volume_name': 'sayseed-test-data', 'health_url': 'http://127.0.0.1:3000/api/health',
            'public_health_url': 'https://example.com/api/health', 'ca_file': '/example/ca.pem'}


class FakeUpdater(module.Updater):
    def __init__(self, root):
        super().__init__(config(root))
        self.app.mkdir()
        self.data = root / 'volume'
        self.data.mkdir()
        self.events = []
        self.failure = None
        self.active = True
        self.old = {'image': self.repo + '@sha256:' + 'a' * 64, 'image_id': 'sha256:' + 'b' * 64,
                    'version': '0.1.1', 'commit': 'c' * 40}
        self.release = {'image': self.repo + '@sha256:' + 'd' * 64, 'image_id': 'sha256:' + 'e' * 64,
                        'version': '0.1.2', 'commit': 'f' * 40}
        self.current = self.old.copy()

    def run(self, *args, **kwargs):
        self.events.append(args[0])
        if args[:2] == ('docker', 'stop'):
            self.active = False
        return ''

    def volume(self):
        return self.data

    def running(self):
        return self.current.copy()

    def container(self, allow_missing=False):
        return {'Id': 'test', 'Image': self.current['image_id'], 'State': {'Running': self.active},
                'Config': {'Labels': {'com.docker.compose.project': 'sayseed-test'}}}

    def candidate(self):
        self.events.append('pull')
        if self.failure == 'pull':
            raise RuntimeError('pull failed')
        return self.release.copy()

    def compose(self, *args):
        self.events.append(args[0])
        if args[0] == 'stop':
            self.active = False
        if args[0] == 'up':
            self.active = True
            image = json.loads(self.overlay.read_text())['services']['sayseed']['image']
            self.current = (self.old if image == self.old['image_id'] else self.release).copy()
        return 'test'

    def verify_maintenance(self):
        self.events.append('maintenance')
        if self.failure == 'maintenance':
            raise RuntimeError('gate failed')

    def wait_healthy(self, release):
        self.events.append('health:' + release['version'])
        if self.failure in ('health', 'restore') and release['version'] == self.release['version']:
            raise RuntimeError('candidate unhealthy')

    def data_snapshot(self):
        return {'ids': {t: ['original'] for t in ('notes', 'connections', 'models', 'cards', 'reviews')},
                'secret_sha256': 'safe-hash'}

    def make_backup(self):
        self.events.append('backup')
        if self.failure == 'backup':
            raise RuntimeError('backup failed')
        self.backup = self.backups / '20260925-120000-123' / 'before-update.tar'

    def verify_image_id(self, image):
        if image != self.old['image_id']:
            raise RuntimeError('wrong image')

    def validate_backup(self, journal):
        self.snapshot = self.data_snapshot()
        return self.data

    def restore(self, journal):
        self.events.append('restore')
        if self.failure == 'restore':
            raise RuntimeError('restore failed')
        self.pin(self.old['image_id'])

    def cleanup(self, dry_run=False):
        self.events.append('cleanup')


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.updater = FakeUpdater(Path(self.tmp.name))

    def test_pull_failure_does_not_interrupt(self):
        self.updater.failure = 'pull'
        with self.assertRaisesRegex(RuntimeError, 'pull failed'):
            self.updater.update()
        self.assertNotIn('stop', self.updater.events)
        self.assertFalse(self.updater.marker.exists())

    def test_gate_failure_does_not_interrupt(self):
        self.updater.failure = 'maintenance'
        with self.assertRaisesRegex(RuntimeError, 'gate failed'):
            self.updater.update()
        self.assertNotIn('stop', self.updater.events)
        self.assertFalse(self.updater.pending.exists())

    def test_backup_failure_restarts_original(self):
        self.updater.failure = 'backup'
        with self.assertRaisesRegex(RuntimeError, 'backup failed'):
            self.updater.update()
        self.assertEqual(self.updater.current, self.updater.old)
        self.assertTrue(self.updater.active)
        self.assertNotIn('restore', self.updater.events)
        self.assertFalse(self.updater.marker.exists())

    def test_candidate_failure_rolls_back_and_blocks_retry(self):
        self.updater.failure = 'health'
        with self.assertRaisesRegex(RuntimeError, 'candidate unhealthy'):
            self.updater.update()
        self.assertEqual(self.updater.current, self.updater.old)
        self.assertIn('restore', self.updater.events)
        self.assertFalse(self.updater.marker.exists())
        with self.assertRaisesRegex(RuntimeError, 'previously failed'):
            self.updater.update()
        self.assertNotIn('cleanup', self.updater.events)

    def test_failed_rollback_remains_recoverable(self):
        self.updater.failure = 'restore'
        with self.assertRaisesRegex(RuntimeError, 'restore failed'):
            self.updater.update()
        self.assertTrue(self.updater.marker.exists())
        self.assertTrue(self.updater.pending.exists())
        self.updater.failure = None
        self.updater.recover()
        self.assertEqual(self.updater.current, self.updater.old)
        self.assertFalse(self.updater.pending.exists())

    def test_finalized_recovery_never_restores_after_gate_opened(self):
        original = self.updater.finalize
        def interrupted(release):
            journal = self.updater.read_state('pending.json')
            journal.update(phase='finalized', final_release=release)
            module.write_json(self.updater.pending, journal)
            self.updater.marker.unlink()
            raise KeyboardInterrupt('power loss after opening gate')
        with patch.object(self.updater, 'finalize', side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.updater.update()
        self.updater.events.clear()
        with patch.object(self.updater, 'verify_data', side_effect=AssertionError('new user data must not be compared')):
            self.updater.recover()
        self.assertEqual(self.updater.current, self.updater.release)
        self.assertNotIn('restore', self.updater.events)
        self.assertNotIn('up', self.updater.events)
        self.assertFalse(self.updater.pending.exists())

    def test_initial_same_digest_creates_overlay_without_restart(self):
        self.updater.release = self.updater.old.copy()
        self.updater.update()
        self.assertTrue(self.updater.overlay.exists())
        self.assertNotIn('stop', self.updater.events)
        self.assertNotIn('up', self.updater.events)

    def test_recovery_with_removed_container_restores_before_up(self):
        self.updater.failure = 'restore'
        with self.assertRaises(RuntimeError):
            self.updater.update()
        original = self.updater.container
        self.updater.failure = None
        with patch.object(self.updater, 'container', side_effect=lambda allow_missing=False: None if allow_missing else original()):
            self.updater.recover()
        self.assertFalse(self.updater.marker.exists())
        self.assertEqual(self.updater.current, self.updater.old)

    def test_success_and_noop(self):
        self.updater.update()
        self.assertEqual(self.updater.current, self.updater.release)
        self.assertEqual(json.loads((self.updater.app / 'release.json').read_text())['version'], '0.1.2')
        self.assertLess(self.updater.events.index('backup'), self.updater.events.index('up'))
        self.updater.events.clear()
        self.updater.update()
        self.assertNotIn('stop', self.updater.events)
        self.assertNotIn('cleanup', self.updater.events)

    def test_dry_run_leaves_no_state(self):
        self.updater.update(dry_run=True)
        self.assertFalse((self.updater.state / 'deployed.json').exists())
        self.assertNotIn('stop', self.updater.events)

    def test_same_version_replacement_and_downgrade_blocked(self):
        for version in ('0.1.1', '0.1.0'):
            self.updater.release['version'] = version
            with self.assertRaisesRegex(RuntimeError, 'downgrade or replace'):
                self.updater.update()
        self.assertNotIn('stop', self.updater.events)

    def test_recorded_image_drift_blocks_pull(self):
        module.write_json(self.updater.state / 'deployed.json', {**self.updater.old, 'image_id': 'other'})
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            self.updater.update()
        self.assertNotIn('pull', self.updater.events)

    def test_cleanup_failure_never_rolls_back(self):
        with patch.object(self.updater, 'cleanup', side_effect=RuntimeError('cleanup refused')):
            self.updater.update()
        self.assertEqual(self.updater.current, self.updater.release)
        self.assertNotIn('restore', self.updater.events)

    def test_missing_existing_id_is_rejected_even_if_count_unchanged(self):
        self.updater.snapshot = self.updater.data_snapshot()
        self.updater.snapshot['ids']['notes'] = ['different']
        with self.assertRaisesRegex(RuntimeError, 'rows disappeared'):
            self.updater.verify_data()

    def test_key_change_rejected(self):
        self.updater.snapshot = self.updater.data_snapshot()
        self.updater.snapshot['secret_sha256'] = 'different'
        with self.assertRaisesRegex(RuntimeError, 'secret changed'):
            self.updater.verify_data()

    def test_volume_mismatch_during_recovery_refused(self):
        self.updater.failure = 'restore'
        with self.assertRaises(RuntimeError):
            self.updater.update()
        journal = self.updater.read_state('pending.json')
        journal['mountpoint'] = '/another-volume'
        module.write_json(self.updater.pending, journal)
        with self.assertRaisesRegex(RuntimeError, 'mountpoint changed'):
            self.updater.recover()
        self.assertTrue(self.updater.marker.exists())


class IdentityAndRetentionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.u = module.Updater(config(self.root))
        self.u.app.mkdir()

    def test_empty_retention_is_noop_but_unknown_entries_refused(self):
        self.assertEqual(self.u.retention_plan()["remove_images"], [])
        (self.u.backups / "unknown").mkdir()
        with self.assertRaises(RuntimeError):
            self.u.retention_plan()

    def test_no_container_recovery_requires_exact_volume_without_other_references(self):
        data = self.root.resolve() / "volume"
        data.mkdir()
        module.write_json(self.u.pending, {"phase": "switching", "project_name": "sayseed-test",
                          "mountpoint": str(data), "volume_name": self.u.config["volume_name"]})
        def run(*args, **kwargs):
            if args[:3] == ("docker", "volume", "inspect"):
                return json.dumps([{"Name": self.u.config["volume_name"], "Mountpoint": str(data)}])
            return ""
        with patch.object(self.u, "run", side_effect=run):
            self.assertEqual(self.u.volume(), data)
        def referenced(*args, **kwargs):
            if args[-1].startswith("volume="):
                return "other-container"
            return run(*args, **kwargs)
        with patch.object(self.u, "run", side_effect=referenced):
            with self.assertRaisesRegex(RuntimeError, "references mismatch"):
                self.u.volume()

    def test_pending_container_lookup_does_not_need_compose_files(self):
        module.write_json(self.u.pending, {"project_name": "sayseed-test", "phase": "switching"})
        info = {"Id": "container", "Config": {"Labels": {"com.docker.compose.service": "sayseed",
                "com.docker.compose.project.working_dir": str(self.u.app)}}}
        with patch.object(self.u, "compose", side_effect=AssertionError("compose unavailable")), patch.object(
                self.u, "run", side_effect=["container", json.dumps([info])]):
            self.assertEqual(self.u.container()["Id"], "container")

    def test_retention_protects_other_containers_and_unrelated_images(self):
        now = 2_000_000_000
        images = []
        latest_archive = None
        for index in range(6):
            directory = self.u.backups / (f"2026010{index + 1}-120000-123")
            directory.mkdir()
            archive = directory / "before-update.tar"
            archive.write_bytes(b"test archive")
            image = "sha256:" + str(index + 1) * 64
            images.append(image)
            digest = module.sha256(archive)
            module.write_json(directory / "manifest.json", {"sha256": digest})
            module.write_json(directory / "retention.json", {"schema": 1, "created_at": now - (60 - index) * 86400,
                              "previous_image_id": image, "archive_sha256": digest, "status": "success"})
            latest_archive = archive
        module.write_json(self.u.state / "deployed.json", {"image": "current", "backup": str(latest_archive)})
        ghcr = "ghcr.io/castor6/sayseed"
        self.u.retained_repositories.add(ghcr)
        inventory = [{"Id": image, "RepoDigests": [self.u.repo + "@sha256:" + "a" * 64],
                      "Config": {"Labels": {"org.opencontainers.image.source":
                          "https://github.com/Castor6/sayseed" if index != 1 else "https://github.com/other/app"}}}
                     for index, image in enumerate(images)]
        inventory[2]["RepoDigests"] = [ghcr + "@sha256:" + "a" * 64]
        def run(*args, **kwargs):
            if args == ("docker", "ps", "-aq"):
                return "another-service"
            if args[:2] == ("docker", "inspect"):
                return json.dumps([{"Image": images[0]}])
            if args[:3] == ("docker", "image", "ls"):
                return " ".join(images)
            if args == ("docker", "image", "inspect", "current"):
                return json.dumps([{"Id": "sha256:" + "f" * 64}])
            if args[:3] == ("docker", "image", "inspect"):
                return json.dumps(inventory)
            raise AssertionError(args)
        with patch.object(self.u, "run", side_effect=run):
            plan = self.u.retention_plan(now)
        self.assertEqual(len(plan["remove_backups"]), 3)
        self.assertEqual(plan["remove_images"], [images[2]])
        self.assertIn(images[0], plan["protected_images"])
        inventory[2]["RepoDigests"].append("unrelated.example/other@sha256:" + "b" * 64)
        with patch.object(self.u, "run", side_effect=run):
            self.assertEqual(self.u.retention_plan(now)["remove_images"], [])


GNU_TAR = 'GNU tar' in subprocess.run(['tar', '--version'], capture_output=True, text=True).stdout


@unittest.skipUnless(GNU_TAR, 'Backup integration requires GNU tar on Linux')
class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.u = module.Updater(config(root))
        self.u.app.mkdir()
        self.data = root / 'volume'
        self.data.mkdir()
        (self.u.app / 'compose.production.yaml').write_text('services: {}\n')
        (self.u.app / '.env').write_text('TEST=private\n')
        (self.data / '.secret').write_text('fictional-secret')
        with sqlite3.connect(self.data / 'sayseed.sqlite') as db:
            for table in ('notes', 'connections', 'models', 'cards', 'reviews'):
                db.execute(f'CREATE TABLE {table} (id TEXT PRIMARY KEY)')
                db.execute(f"INSERT INTO {table} VALUES ('fixture')")
        self.u.volume = lambda: self.data
        self.image = 'sha256:' + 'a' * 64
        self.u.previous_image_id = lambda: self.image
        self.u.verify_image_id = lambda value: self.assertEqual(value, self.image)
        self.u.snapshot = self.u.data_snapshot()
        self.u.make_backup()
        self.journal = {'backup': str(self.u.backup), 'previous': {'image_id': self.image}}

    def test_restore_preserves_mountpoint_and_failed_snapshot(self):
        inode = self.data.stat().st_ino
        (self.data / '.secret').write_text('bad-key')
        with sqlite3.connect(self.data / 'sayseed.sqlite') as db:
            db.execute('DELETE FROM notes')
        self.u.restore(self.journal)
        self.assertEqual(self.data.stat().st_ino, inode)
        self.assertEqual(self.u.data_snapshot(), self.u.snapshot)
        self.assertTrue((self.u.backup.parent / 'failed-state.tar').exists())

    def test_corrupt_archive_refuses_restore(self):
        with self.u.backup.open('ab') as stream:
            stream.write(b'corruption')
        with self.assertRaisesRegex(RuntimeError, 'checksum'):
            self.u.restore(self.journal)
        self.assertTrue((self.u.app / 'compose.production.yaml').exists())

    def test_wrong_volume_metadata_refuses_restore(self):
        path = self.u.backup.parent / 'manifest.json'
        manifest = json.loads(path.read_text())
        manifest['volume_name'] = 'other-app-data'
        module.write_json(path, manifest)
        with self.assertRaisesRegex(RuntimeError, 'volume mismatch'):
            self.u.restore(self.journal)

    def test_restore_can_repeat_after_application_clear_interruption(self):
        original_run = self.u.run
        def interrupt_copy(*args, **kwargs):
            if args[0] == 'cp':
                raise KeyboardInterrupt('simulated process termination')
            return original_run(*args, **kwargs)
        with patch.object(self.u, 'run', side_effect=interrupt_copy):
            with self.assertRaises(KeyboardInterrupt):
                self.u.restore(self.journal)
        self.assertFalse((self.u.app / 'compose.production.yaml').exists())
        self.u.restore(self.journal)
        self.assertEqual(self.u.data_snapshot(), self.u.snapshot)
        self.assertTrue((self.u.app / 'compose.production.yaml').exists())


class ChannelSwitchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.updater = FakeUpdater(root)
        self.acr = self.updater.repo
        self.ghcr = 'ghcr.io/castor6/sayseed'
        self.updater.repositories = {'acr': self.acr, 'ghcr': self.ghcr}
        self.updater.retained_repositories = {self.acr, self.ghcr}
        self.updater.config.update(image_repositories=self.updater.repositories,
                                   retained_image_repositories=[self.acr, self.ghcr])
        self.updater.config_path = root / 'config.json'
        module.write_json(self.updater.config_path, self.updater.config)
        self.updater.release = {**self.updater.old, 'image': self.ghcr + '@sha256:' + 'e' * 64}

    def test_status_is_read_only(self):
        result = self.updater.status()
        self.assertEqual(result['selected_channel'], 'acr')
        self.assertEqual(result['running']['version'], self.updater.old['version'])
        self.assertNotIn('pull', self.updater.events)

    def test_switch_rejects_busy_lock(self):
        argv = ['sayseed-update.py', '--config', str(self.updater.config_path), '--switch-channel', 'ghcr']
        with patch.object(module.sys, 'argv', argv), patch.object(module.fcntl, 'flock', side_effect=BlockingIOError):
            with self.assertRaisesRegex(RuntimeError, 'Another deployment is active'):
                module.main()
        self.assertEqual(json.loads(self.updater.config_path.read_text())['image_repository'], self.acr)

    def test_running_accepts_retained_repository_after_source_change(self):
        module.write_json(self.updater.state / 'deployed.json', self.updater.old)
        info = {'RepoDigests': [self.updater.old['image']]}
        release = {key: self.updater.old[key] for key in ('version', 'commit', 'image_id')}
        self.updater.image_info = lambda image: (info, release)
        self.updater.repo = self.ghcr
        result = module.Updater.running(self.updater)
        self.assertEqual(result['image'], self.updater.old['image'])

    def test_same_image_switch_does_not_stop_or_backup(self):
        self.updater.switch_channel('ghcr')
        self.assertEqual(json.loads(self.updater.config_path.read_text())['image_repository'], self.ghcr)
        self.assertEqual(len(list(self.updater.state.glob('config-before-switch-*.json'))), 1)
        module.write_json(self.updater.state / 'deployed.json', self.updater.old)
        self.updater.update()
        self.assertNotIn('stop', self.updater.events)
        self.assertNotIn('backup', self.updater.events)

    def test_dry_run_pull_failure_and_pending_keep_config(self):
        self.updater.switch_channel('ghcr', dry_run=True)
        self.assertEqual(json.loads(self.updater.config_path.read_text())['image_repository'], self.acr)
        self.updater.failure = 'pull'
        with self.assertRaisesRegex(RuntimeError, 'pull failed'):
            self.updater.switch_channel('ghcr')
        self.assertEqual(json.loads(self.updater.config_path.read_text())['image_repository'], self.acr)
        self.updater.failure = None
        self.updater.pending.write_text('{}')
        with self.assertRaisesRegex(RuntimeError, 'Unfinished deployment'):
            self.updater.switch_channel('ghcr')

    def test_rejects_downgrade_and_failed_release_across_registry(self):
        self.updater.release.update(version='0.1.0', commit='f' * 40, image_id='sha256:' + '9' * 64)
        with self.assertRaisesRegex(RuntimeError, 'downgrade'):
            self.updater.switch_channel('ghcr')
        self.updater.release['version'] = '0.1.2'
        module.write_json(self.updater.state / 'failed.json', {'version': '0.1.2', 'commit': 'f' * 40,
                                                               'image': self.acr + '@sha256:' + '1' * 64})
        with self.assertRaisesRegex(RuntimeError, 'previously failed'):
            self.updater.switch_channel('ghcr')

    def test_config_write_failure_keeps_previous_source_and_backup(self):
        with patch.object(module, 'write_json', side_effect=OSError('write failed')):
            with self.assertRaisesRegex(OSError, 'write failed'):
                self.updater.switch_channel('ghcr')
        self.assertEqual(json.loads(self.updater.config_path.read_text())['image_repository'], self.acr)
        backups = list(self.updater.state.glob('config-before-switch-*.json'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text())['image_repository'], self.acr)
        self.assertEqual(self.updater.repo, self.acr)


if __name__ == '__main__':
    unittest.main()
