"""Offline, byte-bound speech evidence. No public endpoint or publication approval."""
import argparse
import hashlib
import io
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import wave

PROFILE = 'whisper-speech-2026-11-02.1'
MAX_BYTES = 50_000_000
RATE = 16_000


class SpeechError(Exception):
    pass


def fail(code):
    raise SpeechError(code)


def validate_bytes(data, size, sha256):
    if not isinstance(data, bytes) or not 0 < len(data) < MAX_BYTES:
        fail('MEDIA_UNSUPPORTED')
    if type(size) is not int or size != len(data) or not isinstance(sha256, str) or not re.fullmatch('[a-f0-9]{64}', sha256) or hashlib.sha256(data).hexdigest() != sha256:
        fail('FILE_CHANGED')


def model_manifest(directory):
    root = Path(directory)
    if not root.is_absolute() or not root.is_dir():
        fail('SPEECH_MODEL_UNAVAILABLE')
    required = {'config.json', 'model.bin', 'tokenizer.json'}
    vocabulary = {'vocabulary.json', 'vocabulary.txt'}
    files = required | {name for name in vocabulary | {'preprocessor_config.json'} if (root / name).is_file()}
    if not files.intersection(vocabulary):
        fail('SPEECH_MODEL_UNAVAILABLE')
    result = {}
    for name in sorted(files):
        path = root / name
        if path.is_symlink() or not path.is_file():
            fail('SPEECH_MODEL_UNAVAILABLE')
        digest = hashlib.sha256()
        try:
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1_048_576), b''):
                    digest.update(chunk)
        except OSError:
            fail('SPEECH_MODEL_UNAVAILABLE')
        result[name] = digest.hexdigest()
    return result


def process(args, data, limit, timeout):
    try:
        result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False, env={'PATH': os.environ.get('PATH', ''), 'LANG': 'C'}, shell=False)
    except FileNotFoundError:
        fail('SPEECH_DEPENDENCY_UNAVAILABLE')
    except (OSError, subprocess.TimeoutExpired):
        fail('AUDIO_DECODE_FAILED')
    if result.returncode != 0 or len(result.stdout) > limit or result.stderr.strip():
        fail('AUDIO_DECODE_FAILED')
    return result.stdout


def decode_audio(data):
    raw = process(['ffprobe', '-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'pipe', '-format_whitelist', 'wav,mov,matroska', '-show_entries', 'format=format_name,duration:stream=codec_type', '-of', 'json', '-i', 'pipe:0'], data, 262144, 15)
    try:
        facts = json.loads(raw)
        if data[:4] == b'RIFF' and data[8:12] == b'WAVE':
            try:
                with wave.open(io.BytesIO(data), 'rb') as wav:
                    duration = wav.getnframes() / wav.getframerate()
                    if len(wav.readframes(wav.getnframes())) != wav.getnframes() * wav.getnchannels() * wav.getsampwidth():
                        fail('AUDIO_INCOMPLETE')
            except (wave.Error, EOFError, ZeroDivisionError):
                fail('AUDIO_INCOMPLETE')
        else:
            duration = float(facts['format']['duration'])
        streams = facts['streams']
        if not isinstance(streams, list) or len(streams) > 32:
            fail('AUDIO_INCOMPLETE')
        audio_count = sum(s.get('codec_type') == 'audio' for s in streams)
    except (ValueError, KeyError, TypeError, AttributeError):
        fail('AUDIO_INCOMPLETE')
    if not math.isfinite(duration) or not 0 < duration < 60:
        fail('MEDIA_UNSUPPORTED')
    if audio_count == 0:
        fail('AUDIO_MISSING')
    if audio_count != 1:
        fail('AUDIO_AMBIGUOUS')
    pcm = process(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-max_alloc', '67108864', '-protocol_whitelist', 'pipe', '-format_whitelist', 'wav,mov,matroska', '-i', 'pipe:0', '-map', '0:a:0', '-vn', '-ac', '1', '-ar', str(RATE), '-t', '61', '-fs', '3904000', '-f', 'f32le', 'pipe:1'], data, 3_904_000, 20)
    if len(pcm) == 0 or len(pcm) % 4 or len(pcm) / 4 / RATE >= 60 or abs(len(pcm) / 4 / RATE - duration) > .25:
        fail('AUDIO_INCOMPLETE')
    return pcm, len(pcm) / 4 / RATE


def normalize_segments(segments, duration):
    result, chars, previous = [], 0, 0.0
    for segment in segments:
        start, end, text = segment.start, segment.end, segment.text
        if type(start) not in (float, int) or type(end) not in (float, int) or not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= duration + .1 or start < previous or not isinstance(text, str):
            fail('TRANSCRIPT_INCOMPLETE')
        text = text.strip()
        if not text or any(ord(c) < 32 and c not in '\n\t' for c in text):
            fail('TRANSCRIPT_INCOMPLETE')
        metrics = [segment.avg_logprob, segment.no_speech_prob, segment.compression_ratio]
        if any(type(v) not in (float, int) or not math.isfinite(v) for v in metrics) or not 0 <= metrics[1] <= 1 or metrics[2] < 0:
            fail('TRANSCRIPT_INCOMPLETE')
        chars += len(text)
        if chars > 20_000 or len(result) >= 500:
            fail('TRANSCRIPT_LIMIT')
        result.append({'start_ms': round(start * 1000), 'end_ms': round(end * 1000), 'text': text, 'average_log_probability': metrics[0], 'no_speech_probability': metrics[1], 'compression_ratio': metrics[2]})
        previous = end
    return result


def transcribe_bytes(data, size, sha256, directory, language):
    validate_bytes(data, size, sha256)
    if language not in ('de', 'en'):
        fail('SPEECH_LANGUAGE_UNSUPPORTED')
    manifest = model_manifest(directory)
    pcm, duration = decode_audio(data)
    # Required local tokenizer/model files prevent implicit hub lookups. Network
    # must also be disabled by the operator's process/container isolation.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except ImportError:
        fail('SPEECH_DEPENDENCY_UNAVAILABLE')
    engine = {name: importlib.metadata.version(name) for name in ('faster-whisper', 'ctranslate2', 'numpy', 'tokenizers')}
    options = {'language': language, 'task': 'transcribe', 'beam_size': 5, 'temperature': 0, 'condition_on_previous_text': False, 'vad_filter': False, 'word_timestamps': False}
    try:
        model = WhisperModel(str(Path(directory)), device='cpu', compute_type='int8', cpu_threads=2, num_workers=1, local_files_only=True)
        audio = np.frombuffer(pcm, dtype='<f4').copy()
        if not np.isfinite(audio).all():
            fail('AUDIO_INCOMPLETE')
        segments, info = model.transcribe(audio, **options)
        result = normalize_segments(segments, duration)
        if info.language != language or not math.isfinite(info.duration) or abs(info.duration - duration) > .1:
            fail('TRANSCRIPT_INCOMPLETE')
    except SpeechError:
        raise
    except Exception:
        fail('TRANSCRIPTION_FAILED')
    if model_manifest(directory) != manifest:
        fail('SPEECH_MODEL_CHANGED')
    identity = {'profile': PROFILE, 'engine': engine, 'model_files': manifest, 'options': options, 'device': 'cpu', 'compute_type': 'int8', 'sample_rate': RATE}
    return {'schema': 'sma.speech-text.v1', **identity, 'model_profile_sha256': hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'content_sha256': sha256, 'size_bytes': size, 'decoded_duration_ms': round(duration * 1000), 'status': 'text_detected' if result else 'no_speech_detected', 'text': '\n'.join(s['text'] for s in result), 'segments': result, 'needs_review': True, 'untrusted_text': True, 'content_verified': False, 'can_publish': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--language', required=True, choices=['de', 'en'])
    parser.add_argument('--size-bytes', required=True, type=int)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    try:
        data = sys.stdin.buffer.read(MAX_BYTES)
        result = transcribe_bytes(data, args.size_bytes, args.sha256, args.model_dir, args.language)
        print(json.dumps({'ok': True, 'evidence': result}, ensure_ascii=False))
    except SpeechError as error:
        print(json.dumps({'ok': False, 'code': str(error)}))
        return 1
    except Exception:
        print(json.dumps({'ok': False, 'code': 'TRANSCRIPTION_FAILED'}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
