"""Prepare one private 60-second AAC sidecar for a released SMA catalogue track."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

def prepare(source, root):
    source = source.resolve(strict=True)
    if not 12 <= source.stat().st_size <= 8_000_000:
        raise ValueError("Master must contain 12 to 8,000,000 bytes")
    fmt = {".wav": "wav", ".mp3": "mp3"}[source.suffix.lower()]
    data = source.read_bytes()
    master = hashlib.sha256(data).hexdigest()
    with tempfile.TemporaryDirectory() as tmp:
        original = Path(tmp) / ("source." + fmt)
        original.write_bytes(data)
        args = ["-v", "error", "-protocol_whitelist", "file", "-f", fmt]
        meta = json.loads(subprocess.check_output(
            ["ffprobe", *args, "-show_format", "-show_streams", "-of", "json", str(original)], timeout=30))
        streams = [s for s in meta["streams"] if s["codec_type"] == "audio"]
        if len(streams) != 1 or not 0 < float(meta["format"]["duration"]) <= 600:
            raise ValueError("Expected a single audio track of up to ten minutes")
        audio = subprocess.check_output(["ffmpeg", "-nostdin", *args, "-stream_loop", "-1", "-i", str(original),
            "-map", "0:a:0", "-t", "60.1", "-af", "volume=0.25", "-ar", "48000", "-ac", "2",
            "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "128k", "-threads", "1", "-f", "adts", "pipe:1"], timeout=120)
    if not 12 <= len(audio) <= 1_500_000:
        raise ValueError("Unexpected AAC size")
    path = root / "render" / master / (hashlib.sha256(audio).hexdigest() + ".aac")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    print(path)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("master", type=Path)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    prepare(args.master, args.output_directory)
