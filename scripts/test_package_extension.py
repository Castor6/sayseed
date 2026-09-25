import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('package_extension', Path(__file__).with_name('package-extension.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtensionPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'input'
        self.source.mkdir()
        self.package = self.root / 'package.json'
        self.package.write_text('{"version":"0.1.1"}')
        (self.root / 'CHANGELOG.md').write_text('# Extension\n\n## 0.1.1\n\n### Patch Changes\n\n- Fix behavior.\n\n## 0.1.0\n\nOld notes.\n')
        (self.source / 'manifest.json').write_text('{"manifest_version":3,"version":"0.1.1"}')
        (self.source / 'background.js').write_text('console.log("test");')

    def build(self, output='output'):
        return module.package_extension(self.source, self.root / output, self.package, 'a' * 40)

    def test_reproducible_archive_and_complete_checksums(self):
        result = self.build('one')
        self.build('two')
        self.assertEqual(result['tag'], 'extension-v0.1.1')
        for path in (self.root / 'one').iterdir():
            self.assertEqual(path.read_bytes(), (self.root / 'two' / path.name).read_bytes())
        lines = (self.root / 'one/SHA256SUMS').read_text().splitlines()
        self.assertEqual(len(lines), 3)
        self.assertNotIn('Old notes', (self.root / 'one/CHANGELOG.md').read_text())
        for line in lines:
            digest, name = line.split('  ')
            self.assertEqual(digest, hashlib.sha256((self.root / 'one' / name).read_bytes()).hexdigest())
        with zipfile.ZipFile(self.root / 'one/sayseed-extension-0.1.1.zip') as archive:
            self.assertEqual(archive.namelist(), ['background.js', 'manifest.json'])

    def test_manifest_version_mismatch(self):
        (self.source / 'manifest.json').write_text('{"manifest_version":3,"version":"0.1.2"}')
        with self.assertRaisesRegex(ValueError, 'does not match'):
            self.build()

    def test_rejects_nonrelease_files_and_secrets(self):
        for name, content in [('script.js.map', '{}'), ('.env', 'SECRET=x'), ('private.key', 'x'), ('token.js', 'ghp_' + 'a' * 30), ('inline.js', '//# sourceMappingURL=data:application/json;base64,e30=')]:
            with self.subTest(name=name):
                path = self.source / name
                path.write_text(content)
                with self.assertRaises(ValueError):
                    self.build()
                path.unlink()

    def test_rejects_symlinks_and_stale_assets(self):
        link = self.source / 'linked.js'
        link.symlink_to(self.source / 'background.js')
        with self.assertRaisesRegex(ValueError, 'Symlinks'):
            self.build()
        link.unlink()
        self.build()
        with self.assertRaisesRegex(ValueError, 'empty'):
            self.build()


if __name__ == '__main__':
    unittest.main()
