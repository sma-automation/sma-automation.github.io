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
from fractions import Fraction
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
    result = subprocess.run(args, check=True, capture_output=True, timeout=timeout)
    # Every media command uses -v error. A successful exit with decoder errors
    # is not accepted as a clean technical inspection.
    assert not result.stderr.strip(), 'MEDIA_DECODE_ERROR'
    return result.stdout

meta = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams',
                       '-of', 'json', str(source)]))
videos = [s for s in meta['streams'] if s.get('codec_type') == 'video']
audios = [s for s in meta['streams'] if s.get('codec_type') == 'audio']
assert len(videos) == 1 and len(audios) <= 1
v = videos[0]
duration = float(v.get('duration') or meta['format']['duration'])
assert math.isfinite(duration) and 0 < duration <= MAX_SECONDS
assert 1 <= int(v['width']) <= 4096 and 1 <= int(v['height']) <= 4096
# Decode every video/audio frame, without copying packets or limiting duration.
# Progress must reach EOF; a timeout or any reported error fails closed.
progress = run(['ffmpeg', '-v', 'error', '-nostdin', '-xerror', '-err_detect', 'explode',
                '-threads', '1', '-i', str(source), '-map', '0:v:0', '-map', '0:a:0?',
                '-fps_mode', 'passthrough', '-threads', '1', '-progress', 'pipe:1',
                '-nostats', '-f', 'null', '-'], timeout=120).decode()
end = dict(line.split('=', 1) for line in progress.splitlines() if '=' in line)
assert end.get('progress') == 'end' and 1 <= int(end['frame']) <= 14400
# Inspect all decoded presentation timestamps rather than assuming that the
# container's average rate proves a constant frame rate.
decoded = json.loads(run(['ffprobe', '-v', 'error', '-err_detect', 'explode',
                          '-select_streams', 'v:0', '-show_frames', '-show_entries',
                          'frame=best_effort_timestamp_time,width,height,pix_fmt',
                          '-of', 'json', str(source)], timeout=120))['frames']
assert len(decoded) == int(end['frame'])
assert all(f['width'] == v['width'] and f['height'] == v['height'] and
           f['pix_fmt'] == v['pix_fmt'] for f in decoded)
times = [round(float(f['best_effort_timestamp_time']) * 1000000) for f in decoded]
intervals = [b - a for a, b in zip(times, times[1:])]
assert all(i > 0 for i in intervals)
rate = Fraction(v['avg_frame_rate'])
assert 0 < rate <= 240
assert abs((times[-1] - times[0]) / 1000 - duration * 1000) <= max(200, 2000 / float(rate))
def optional_rate(stream):
    value = stream.get('bit_rate')
    return int(value) if value is not None and str(value).isdigit() and int(value) > 0 else None
a = audios[0] if audios else None
technical = {'schema': 'sma-video-technical-v1', 'decode': 'complete',
             'video_codec': v['codec_name'], 'pixel_format': v['pix_fmt'],
             'width_px': int(v['width']), 'height_px': int(v['height']),
             'frame_rate_num': rate.numerator, 'frame_rate_den': rate.denominator,
             'decoded_frames': len(decoded),
             'min_frame_interval_us': min(intervals) if intervals else None,
             'max_frame_interval_us': max(intervals) if intervals else None,
             'video_bit_rate_bps': optional_rate(v),
             'audio_codec': a['codec_name'] if a else None,
             'audio_sample_rate_hz': int(a['sample_rate']) if a else None,
             'audio_channels': int(a['channels']) if a else None,
             'audio_bit_rate_bps': optional_rate(a) if a else None}
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
manifest = {'schema': 'sma-video-evidence-v3', 'sha256': EXPECTED_SHA256,
            'size_bytes': EXPECTED_SIZE, 'duration_ms': round(duration * 1000),
            'width': int(v['width']), 'height': int(v['height']),
            'positions_ms': [round(p * 1000) for p in positions],
            'sampling': 'representative_frames_not_full_moderation',
            'audio_status': audio_status, 'frames': frames, 'technical': technical}
for name in ['frames.jpg'] + (['audio.wav'] if audios else []):
    data = (out / name).read_bytes()
    manifest[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'size_bytes': len(data)}
(out / 'manifest.json').write_text(json.dumps(manifest))
print(json.dumps(manifest))
