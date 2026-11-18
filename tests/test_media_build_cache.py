from pathlib import Path
import tempfile
import unittest
from unittest import mock

from scripts import media_build_cache as cache


class MediaBuildCacheTests(unittest.TestCase):
    def compiler(self, command, **_kwargs):
        output = Path(command[-1])
        tool = "ffmpeg" if "build_ffmpeg" in command[1] else "untrunc"
        (output / tool).mkdir(parents=True)
        (output / tool / "manifest.json").write_text('{"compiled": true}')
        (output / tool / "program.exe").write_bytes(b"compiled program")
        (output / f"{tool}-corresponding-source.zip").write_bytes(b"matching source")

    def test_cached_binaries_and_corresponding_sources_restore_without_compiling(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(cache, "input_identity", return_value={"input": "locked"}), \
                mock.patch.object(cache.subprocess, "run", side_effect=self.compiler) as compiler:
            root = Path(directory).resolve()
            first = cache.build(root, "windows")
            second = cache.build(root, "windows")
            self.assertEqual(first["cache_hits"], [])
            self.assertEqual(second["cache_hits"], ["ffmpeg", "untrunc"])
            self.assertEqual(compiler.call_count, 2)
            self.assertEqual((root / "build/ffmpeg-windows/ffmpeg-corresponding-source.zip").read_bytes(), b"matching source")

    def test_changed_inputs_or_corrupt_bytes_require_compilation(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(cache, "input_identity", return_value={"input": "one"}) as identity, \
                mock.patch.object(cache.subprocess, "run", side_effect=self.compiler) as compiler:
            root = Path(directory).resolve()
            cache.build(root, "windows", tool="ffmpeg")
            binary = root / "build/media-cache/windows-x86_64/ffmpeg/ffmpeg/program.exe"
            binary.write_bytes(b"corrupt")
            self.assertEqual(cache.build(root, "windows", tool="ffmpeg")["cache_hits"], [])
            identity.return_value = {"input": "two"}
            self.assertEqual(cache.build(root, "windows", tool="ffmpeg")["cache_hits"], [])
            self.assertEqual(compiler.call_count, 3)

    def test_missing_source_archive_is_not_a_cache_hit(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(cache, "input_identity", return_value={"input": "locked"}), \
                mock.patch.object(cache.subprocess, "run", side_effect=self.compiler) as compiler:
            root = Path(directory).resolve()
            cache.build(root, "windows", tool="ffmpeg")
            (root / "build/media-cache/windows-x86_64/ffmpeg/ffmpeg-corresponding-source.zip").unlink()
            self.assertEqual(cache.build(root, "windows", tool="ffmpeg")["cache_hits"], [])
            self.assertEqual(compiler.call_count, 2)

    def test_cache_paths_cannot_delete_outside_the_build_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            protected = root / "media"
            protected.mkdir()
            with self.assertRaises(ValueError):
                cache.remove_owned(root, protected)
            self.assertTrue(protected.is_dir())

    def test_input_identity_distinguishes_architecture_and_sdk(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name in cache.INPUTS:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("input")
            def native_command(command, **_kwargs):
                self.assertNotEqual(command[0], "cmake")
                return "native tool version"
            with mock.patch.object(cache.subprocess, "check_output", side_effect=native_command):
                native = cache.input_identity(root, "macos", "arm64")
            self.assertIn("sdk", native["toolchain"])
            self.assertIn("pkg-config", native["toolchain"])
            first = cache.input_identity(root, "macos", "arm64", toolchain={"sdk": "one"})
            self.assertNotEqual(first, cache.input_identity(root, "macos", "x86_64", toolchain={"sdk": "one"}))
            self.assertNotEqual(first, cache.input_identity(root, "macos", "arm64", toolchain={"sdk": "two"}))
            (root / cache.INPUTS[0]).write_text("different source revision")
            self.assertNotEqual(first, cache.input_identity(root, "macos", "arm64", toolchain={"sdk": "one"}))

    def test_actions_cache_identity_tracks_toolchain_and_source_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name in cache.INPUTS:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("input")
            first = cache.input_identity(root, "macos", "arm64", toolchain={"sdk": "one", "clang": "one"})
            key = cache.github_cache_key(first)
            reordered = cache.input_identity(root, "macos", "arm64", toolchain={"clang": "one", "sdk": "one"})
            self.assertEqual(key, cache.github_cache_key(reordered))
            for target, arch, tools in (("macos", "x86_64", first["toolchain"]),
                                         ("macos", "arm64", {"sdk": "two", "clang": "one"}),
                                         ("windows", "x86_64", first["toolchain"])):
                with self.subTest(target=target, arch=arch, tools=tools):
                    self.assertNotEqual(key, cache.github_cache_key(cache.input_identity(root, target, arch, toolchain=tools)))
            (root / cache.INPUTS[0]).write_text("new source")
            self.assertNotEqual(key, cache.github_cache_key(cache.input_identity(root, "macos", "arm64", toolchain=first["toolchain"])))
