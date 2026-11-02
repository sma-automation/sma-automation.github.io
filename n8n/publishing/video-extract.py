"""Fixed, offline extraction program for a dedicated ephemeral OpenAI container.

The caller supplies SOURCE_ZIP, EXPECTED_SHA256 and EXPECTED_SIZE. No network,
package installation, shell interpolation, original filename, or archive paths.
This is sampled content evidence, not a comprehensive moderation clearance.
"""
import hashlib
import json
import math
import subprocess
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

MAX_BYTES = 24_000_000
MAX_SECONDS = 60
out = Path('/mnt/data/sma_evidence')
out.mkdir(exist_ok=True)
assert 0 < EXPECTED_SIZE <= MAX_BYTES
with zipfile.ZipFile(SOURCE_ZIP) as archive:
    assert archive.namelist() == ['source.mp4']
    info = archive.getinfo('source.mp4')
    assert info.file_size == EXPECTED_SIZE and info.compress_type == zipfile.ZIP_STORED
    raw = archive.read(info)
assert len(raw) == EXPECTED_SIZE
assert hashlib.sha256(raw).hexdigest() == EXPECTED_SHA256
source = out / 'source.mp4'
source.write_bytes(raw)
del raw

def run(args, timeout=40):
    return subprocess.run(args, check=True, capture_output=True, timeout=timeout).stdout

meta = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams',
                       '-of', 'json', str(source)]))
videos = [s for s in meta['streams'] if s.get('codec_type') == 'video']
audios = [s for s in meta['streams'] if s.get('codec_type') == 'audio']
assert len(videos) == 1 and len(audios) <= 1
v = videos[0]
duration = float(v.get('duration') or meta['format']['duration'])
assert math.isfinite(duration) and 0 < duration <= MAX_SECONDS
assert 1 <= int(v['width']) <= 4096 and 1 <= int(v['height']) <= 4096
count = min(21, max(2, math.ceil(duration) + 1))
positions = [round(i * max(0, duration - .15) / (count - 1), 3) for i in range(count)]
sheet = Image.new('RGB', (4 * 320, math.ceil(count / 4) * 352), '#121820')
draw = ImageDraw.Draw(sheet)
frames = []
for i, pos in enumerate(positions):
    frame = out / f'frame-{i:03d}.jpg'
    run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-ss', str(pos), '-i', str(source),
         '-map', '0:v:0', '-frames:v', '1', '-threads', '1',
         '-vf', "scale=w='min(1536,iw)':h='min(1536,ih)':force_original_aspect_ratio=decrease",
         '-q:v', '2', str(frame)])
    with Image.open(frame) as image:
        image.load()
        data = frame.read_bytes()
        assert 0 < len(data) <= 2_000_000
        frames.append({'name': frame.name, 'position_ms': round(pos * 1000),
                       'width': image.width, 'height': image.height,
                       'size_bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        tile = ImageOps.contain(image.convert('RGB'), (320, 320))
        x, y = (i % 4) * 320, (i // 4) * 352
        sheet.paste(tile, (x + (320 - tile.width) // 2, y + (320 - tile.height) // 2))
        draw.text((x + 8, y + 327), f'{pos:.3f} s', fill='white')
sheet.save(out / 'frames.jpg', 'JPEG', quality=90)
audio_status = 'no_audio_stream'
if audios:
    run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', str(source), '-map', '0:a:0',
         '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-threads', '1',
         str(out / 'audio.wav')])
    audio_status = 'extracted'
manifest = {'schema': 'sma-video-evidence-v2', 'sha256': EXPECTED_SHA256,
            'size_bytes': EXPECTED_SIZE, 'duration_ms': round(duration * 1000),
            'width': int(v['width']), 'height': int(v['height']),
            'positions_ms': [round(p * 1000) for p in positions],
            'sampling': 'representative_frames_not_full_moderation',
            'audio_status': audio_status, 'frames': frames}
for name in ['frames.jpg'] + (['audio.wav'] if audios else []):
    data = (out / name).read_bytes()
    manifest[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'size_bytes': len(data)}
(out / 'manifest.json').write_text(json.dumps(manifest))
print(json.dumps(manifest))
