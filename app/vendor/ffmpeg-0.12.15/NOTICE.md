# FFmpeg browser runtime

The JavaScript files in this directory are unmodified ESM files from the official
npm package `@ffmpeg/ffmpeg@0.12.15`. Wrapper license: MIT; see LICENSE (upstream
blob 3032c67441859d69c3b02d150c5abdfbdef2a919).
Source: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/ffmpeg
Reproduce: `npm ci --prefix tests/media-runtime --ignore-scripts`.

The renderer loads the unmodified single-thread core `@ffmpeg/core@0.12.10`
from jsDelivr, verifies exact byte sizes and SHA-256 hashes before executing it,
and performs media processing locally. No media bytes are sent to jsDelivr.
The core includes FFmpeg and libx264; their licenses apply independently of
the MIT wrapper, including GPL terms for this libx264-enabled build.
Upstream build source, dependencies and license instructions:
https://github.com/ffmpegwasm/ffmpeg.wasm
https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/build
https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/src
https://ffmpeg.org/legal.html
https://www.videolan.org/developers/x264.html

Pinned core hashes and download paths are in `app/assets/media-export-render.mjs`.
The npm lockfile pins package integrity. Do not replace the runtime without
revalidating licensing, hashes, metadata checks and the actual browser export.
