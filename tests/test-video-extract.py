"""Actual offline ffmpeg integration: synthetic clips only, isolated output paths."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = (Path(__file__).resolve().parents[1] / 'n8n/publishing/video-extract.py').read_text()

class VideoExtraction(unittest.TestCase):
    def extract(self, audio=False, fps='25', corrupt=False):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / 'input.mp4'
            args = ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'color=c=blue:s=640x360:r={fps}:d=1']
            if audio:
                args += ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1']
            args += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1']
            if audio:
                args += ['-c:a', 'aac', '-b:a', '128k']
            subprocess.run(args + ['-movflags', '+faststart', str(source)], check=True, capture_output=True)
            data = source.read_bytes()
            if corrupt:
                # MP4 headers survive; the end of the encoded media is missing.
                data = data[:-max(200, len(data)//8)]
            archive = root / 'source.zip'
            with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as z:
                z.writestr('source.mp4', data)
            code = f'SOURCE_ZIP={str(archive)!r}\nEXPECTED_SIZE={len(data)}\nEXPECTED_SHA256={hashlib.sha256(data).hexdigest()!r}\n'
            # Only relocate the fixed output directory, never alter media logic.
            code += SCRIPT.replace("Path('/mnt/data/sma_evidence')", f'Path({str(root / "evidence")!r})')
            run = subprocess.run(['python', '-c', code], capture_output=True, text=True, timeout=180)
            if corrupt:
                self.assertNotEqual(run.returncode, 0)
                self.assertFalse((root / 'evidence' / 'manifest.json').exists())
                return
            self.assertEqual(run.returncode, 0, run.stderr)
            m = json.loads(run.stdout)
            self.assertEqual(m['schema'], 'sma-video-evidence-v3')
            self.assertEqual(m['sha256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(m['technical']['decode'], 'complete')
            self.assertEqual(m['technical']['video_codec'], 'h264')
            self.assertEqual(m['technical']['width_px'], 640)
            return m

    def test_video_without_audio(self):
        m = self.extract()
        self.assertEqual(m['audio_status'], 'no_audio_stream')
        self.assertEqual(m['technical']['decoded_frames'], 25)
        self.assertEqual(m['technical']['min_frame_interval_us'], 40000)
        self.assertEqual(m['technical']['max_frame_interval_us'], 40000)
        self.assertIsNone(m['technical']['audio_codec'])

    def test_video_with_audio_and_fractional_rate(self):
        m = self.extract(audio=True, fps='30000/1001')
        self.assertEqual(m['audio_status'], 'extracted')
        self.assertEqual(m['technical']['audio_codec'], 'aac')
        self.assertEqual(m['technical']['audio_sample_rate_hz'], 48000)
        self.assertEqual(m['technical']['frame_rate_num'], 30000)
        self.assertEqual(m['technical']['frame_rate_den'], 1001)
        self.assertEqual(m['technical']['decoded_frames'], 30)

    def test_truncated_media_never_produces_success(self):
        self.extract(audio=True, corrupt=True)

if __name__ == '__main__':
    unittest.main()
