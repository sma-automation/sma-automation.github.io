"""Render or verify a private portal video against the profile's exact media files."""
import argparse
import hashlib
import json
import math
import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage, signal

RATE = 48000


def ffmpeg(*args):
    return subprocess.check_output(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                                    "-filter_threads", "1", "-filter_complex_threads", "1", *map(str, args)])


def digest(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def probe(path):
    data = subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)])
    return json.loads(data)["streams"]


def logo_image(path):
    logo = Image.open(path).convert("RGBA")
    arr = np.array(logo)
    if arr[:, :, 3].min() == 255:
        # Some supplied logos contain a baked white checkerboard outside the artwork.
        # Remove only the light region connected to the image boundary.
        light = arr[:, :, :3].min(axis=2) > 217
        edge = np.zeros_like(light)
        edge[0] = light[0]
        edge[-1] = light[-1]
        edge[:, 0] = light[:, 0]
        edge[:, -1] = light[:, -1]
        arr[ndimage.binary_propagation(edge, mask=light), 3] = 0
        logo = Image.fromarray(arr)
    box = logo.getchannel("A").getbbox()
    if not box:
        raise ValueError("LOGO_EMPTY")
    return logo.crop(box)


def decode_audio(path, rate, channels):
    return np.frombuffer(ffmpeg("-i", path, "-vn", "-map", "0:a:0", "-ac", channels,
                                "-ar", rate, "-f", "f32le", "pipe:1"), dtype="<f4").reshape(-1, channels)


def make_bed(track, duration, dest):
    music = decode_audio(track, RATE, 2)
    if len(music) < RATE // 5 or not np.isfinite(music).all():
        raise ValueError("MUSIC_INVALID")
    rms = float(np.sqrt(np.mean(music ** 2)))
    if rms < .001:
        raise ValueError("MUSIC_SILENT")
    music = music * min(.16 / rms, .88 / max(.001, np.abs(music).max()))
    total = round(duration * RATE)
    overlap = min(round(.4 * RATE), len(music) // 5)
    ramp = np.linspace(0, 1, overlap, dtype=np.float32)[:, None]
    seam = music[-overlap:] * (1 - ramp) + music[:overlap] * ramp
    fade = min(round(.4 * RATE), total // 5)
    with wave.open(str(dest), "wb") as wav:
        wav.setparams((2, 2, RATE, 0, "NONE", ""))
        pos = 0

        def write(part):
            nonlocal pos
            part = part[:total-pos]
            idx = np.arange(pos, pos+len(part))
            gain = np.minimum(1., (total - 1 - idx) / max(1, fade))
            gain = np.minimum(gain, idx / max(1, min(fade, RATE // 50)))
            wav.writeframesraw((part * gain[:, None] * 32767).astype("<i2").tobytes())
            pos += len(part)

        if total <= len(music):
            write(music)
        else:
            write(music[:-overlap])
            while pos < total:
                write(seam)
                write(music[overlap:-overlap])


def frames(path):
    # Normalize rotation and aspect ratio through the decoder. One sample per
    # second keeps the decision tied to the finished pictures throughout the clip.
    width = 256
    streams = probe(path)
    v = next(s for s in streams if s["codec_type"] == "video")
    rotated = any(abs(s.get("rotation", 0)) % 180 == 90 for s in v.get("side_data_list", []))
    w, h = (v["height"], v["width"]) if rotated else (v["width"], v["height"])
    height = max(2, round(h * width / w / 2) * 2)
    if height > 1500:
        raise ValueError("VIDEO_ASPECT_UNSUPPORTED")
    raw = ffmpeg("-i", path, "-vf", f"fps=1:start_time=0:round=up,scale={width}:{height}",
                 "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1")
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 3)


def template(logo, width):
    im = np.asarray(logo.resize((width, max(1, round(width * logo.height/logo.width))), Image.Resampling.LANCZOS))
    mask = im[:, :, 3] > 220
    rgb = im[:, :, :3].astype(np.float32) / 255.
    return rgb, mask


def logo_score(region, colors, mask):
    if mask.sum() < 45 or region.shape != colors.shape:
        return 0.
    a, b = colors[mask], region[mask].astype(np.float32)/255
    if a.std() < .10 or b.std() < .09:
        return 0.
    corr = np.mean((a-a.mean())*(b-b.mean())) / (a.std()*b.std())
    return min(float(corr), 1. - float(np.mean(np.abs(a-b))))


def locate_logo(frame, logo):
    # Find a creator-supplied overlay as well as our fixed-size rendered overlay.
    gray = frame.mean(axis=2).astype(np.float32)/255
    best = None
    for width in range(24, 105, 2):
        colors, mask = template(logo, width)
        h, w = mask.shape
        if h >= frame.shape[0] or mask.sum() < 45:
            continue
        m = mask.astype(np.float32)
        gray_logo = colors.mean(axis=2)
        centered = (gray_logo-gray_logo[mask].mean()) * m
        if (centered**2).sum() < .01:
            continue
        def corr(x,y):
            return signal.fftconvolve(x, y[::-1, ::-1], mode="valid")
        mean_sum = corr(gray,m)
        var = np.maximum(corr(gray**2,m) - mean_sum**2/m.sum(), .0001)
        scores = corr(gray,centered) / np.sqrt(var*(centered**2).sum())
        y, x = np.unravel_index(scores.argmax(), scores.shape)
        score = logo_score(frame[y:y+h, x:x+w], colors, mask)
        if best is None or score > best[0]:
            best = (score, y, x, colors, mask)
    return best


def has_logo(path, logo):
    pictures = frames(path)
    if not len(pictures):
        return False
    match = locate_logo(pictures[0], logo)
    if not match or match[0] < .81:
        return False
    _, y, x, colors, mask = match
    h, w = mask.shape
    return all(logo_score(frame[y:y+h,x:x+w], colors, mask) >= .78 for frame in pictures)


def verify_music(path, bed, duration):
    rate = 8000
    actual = decode_audio(path, rate, 1).ravel()
    ref = decode_audio(bed, rate, 1).ravel()
    if abs(len(actual)/rate-duration) > .12:
        raise ValueError("MUSIC_DURATION_MISMATCH")
    n = min(len(actual), len(ref))
    # Correlation identifies the assigned track even in a mix with speech.
    # Gain and level prevent a mathematically present yet inaudible soundtrack.
    checked = 0
    for a in range(0, n, rate):
        b = min(a+rate, n)
        r, v = ref[a:b], actual[a:b]
        if len(r) < 160 or np.mean(r*r) < .00004:
            continue
        r, v = r-r.mean(), v-v.mean()
        power = float(np.mean(r*r))
        cross = float(np.mean(r*v))
        corr = cross / math.sqrt(max(1e-15, power * np.mean(v*v)))
        if cross / max(power, 1e-12) < .23 or corr < .23 or cross / math.sqrt(max(power,1e-12)) < .006:
            raise ValueError("MUSIC_WRONG_OR_INAUDIBLE")
        checked += 1
    if checked < max(1, math.floor(duration * .65)):
        raise ValueError("MUSIC_INSUFFICIENT")


def verify_existing_music(path, track, duration):
    """A creator's edit may already contain a different excerpt of the same master."""
    rate = 6000
    ref = decode_audio(track, rate, 1).ravel()
    actual = decode_audio(path, rate, 1).ravel()
    if abs(len(actual)/rate-duration) > .12 or len(ref) < rate//4:
        raise ValueError("MUSIC_DURATION_MISMATCH")
    # Look up each consecutive excerpt in the master. Normalize the correlation
    # by the power at each offset to avoid matching just its loudest passage.
    length = min(rate, len(ref), len(actual))
    if length < 100:
        raise ValueError("MUSIC_INSUFFICIENT")
    master = np.r_[ref,ref[:length]]
    energy = np.r_[0.,np.cumsum(master.astype(float)**2)]
    denom = np.sqrt(np.maximum(energy[length:] - energy[:-length], 1e-8))
    starts = list(range(0,len(actual)-length+1,length)) + [len(actual)-length]
    for start in dict.fromkeys(starts):
        clip = actual[start:start+length]
        rms = np.sqrt(np.mean(clip**2))
        values = signal.correlate(master,clip,mode="valid",method="fft") / denom
        score = float(np.max(values)) / max(1e-8,rms*math.sqrt(length))
        if score < .58 or rms*score < .008:
            raise ValueError("MUSIC_WRONG_OR_INAUDIBLE")


def process(source, logo_file, track, portal, output, verify_only, private_preview=False):
    logo = logo_image(logo_file)
    streams = probe(source)
    video = next((s for s in streams if s["codec_type"] == "video" and not s.get("disposition",{}).get("attached_pic")), None)
    if not video:
        raise ValueError("VISUAL_MEDIA_REQUIRED")
    still = source.suffix.lower() in {".png",".jpeg",".jpg",".webp",".bmp"}
    duration = 15. if still else float(video["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("VIDEO_DURATION_UNKNOWN")
    with tempfile.TemporaryDirectory(dir=output.parent if output else None) as tmp:
        tmp = Path(tmp)
        bed = tmp/"music.wav"
        make_bed(track,duration,bed)
        embedded = not still and has_logo(source,logo)
        if verify_only or (portal == "tiktok" and not private_preview):
            if not embedded:
                raise ValueError("CREATOR_LOGO_REQUIRED" if portal == "tiktok" else "LOGO_MISSING")
        if verify_only:
            result = source
        else:
            result = tmp/"render.mp4"
            filters = []
            inputs = ["-loop","1","-framerate","25"] if still else []
            inputs += ["-i",source,"-i",bed]
            if embedded:
                vmap = "0:v:0"
            else:
                width = max(18, round(video["width"] * .22 / 2)*2)
                stamp = logo.resize((width,max(1,round(logo.height*width/logo.width))),Image.Resampling.LANCZOS)
                stamp.save(tmp/"logo.png")
                inputs += ["-i",tmp/"logo.png"]
                filters.append("[0:v:0]scale=trunc(iw/2)*2:trunc(ih/2)*2[base];[base][2:v]overlay=W-w-W*0.035:H*0.035[v]")
                vmap = "[v]"
            original_audio = any(s["codec_type"] == "audio" for s in streams)
            existing_music = False
            if original_audio:
                try:
                    verify_existing_music(source, track, duration)
                    existing_music = True
                except ValueError:
                    pass
            if existing_music:
                fade = min(.4, duration / 5)
                filters.append(f"[0:a:0]afade=t=out:st={duration-fade}:d={fade}[a]")
                amap = "[a]"
            elif original_audio:
                filters.append("[0:a:0]volume=0.58[src];[1:a:0]volume=0.70[bed];[bed][src]amix=inputs=2:duration=first:normalize=0,alimiter=level=0:latency=1[a]")
                amap = "[a]"
            else:
                amap = "1:a:0"
            graph = ["-filter_complex",";".join(filters)] if filters else []
            codec = ["-c:v","copy"] if embedded and video["codec_name"]=="h264" else ["-c:v","libx264","-pix_fmt","yuv420p","-preset","veryfast","-crf","20"]
            ffmpeg(*inputs,*graph,"-map",vmap,"-map",amap,*codec,"-c:a","aac","-b:a","160k","-t",str(duration),"-movflags","+faststart",result)
            if not has_logo(result,logo):
                raise ValueError("LOGO_MISSING_IN_EXPORT")
        verified_duration = float(next(s for s in probe(result) if s["codec_type"]=="video")["duration"])
        if abs(duration-verified_duration) > .10:
            raise ValueError("VIDEO_DURATION_CHANGED")
        if verify_only or existing_music:
            try:
                verify_music(result, bed, verified_duration)
            except ValueError:
                verify_existing_music(result, track, verified_duration)
        else:
            verify_music(result, bed, verified_duration)
        proof = dict(input_sha=digest(source), output_sha=digest(result), logo_sha=digest(logo_file),
                     music_sha=digest(track), duration=verified_duration, creator_logo=embedded,
                     logo_visible=True, music_audible=True)
        if output:
            # Publish the private result on the filesystem only after verification.
            os.link(result,output)
        return proof


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for key in ["source","logo","music"]:
        p.add_argument(key,type=Path)
    p.add_argument("--portal",required=True,choices=["youtube","instagram","facebook","tiktok"])
    dest = p.add_mutually_exclusive_group(required=True)
    dest.add_argument("--output",type=Path)
    dest.add_argument("--verify-only",action="store_true")
    p.add_argument("--private-preview", action="store_true", help="Allow a private TikTok render with an added logo")
    a=p.parse_args()
    print(json.dumps(process(a.source,a.logo,a.music,a.portal,a.output,a.verify_only,a.private_preview)))
