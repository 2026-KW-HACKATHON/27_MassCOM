#!/usr/bin/env python3
"""Build the gacha stamp reveal soundtrack from user-provided OGG effects."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
from argparse import ArgumentParser
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = ROOT / "assets" / "videos"
SOURCE_DIR = ASSET_DIR / "sources" / "gacha-stamp-user-sounds"
MANIFEST_PATH = ASSET_DIR / "gacha-stamp-audio-manifest.json"
IDLE_VIDEO = ASSET_DIR / "gacha-stamp-idle.mp4"
REVEAL_VIDEO = ASSET_DIR / "gacha-stamp-reveal.mp4"

SAMPLE_RATE = 48_000
REVEAL_DURATION = 101 / 24
IDLE_DURATION = 3.0

USED_SOURCES = [
    "maximize_009.ogg",
    "maximize_008.ogg",
    "minimize_006.ogg",
    "glass_001.ogg",
    "glass_002.ogg",
    "drop_002.ogg",
    "drop_003.ogg",
    "drop_004.ogg",
    "select_006.ogg",
    "select_005.ogg",
]


def run(args: list[str | Path]) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(args, check=True, capture_output=True)


def db(value: float) -> float:
    return 20 * math.log10(max(value, 1e-9))


def db_to_amp(value: float) -> float:
    return 10 ** (value / 20)


def decode(path: Path, ffmpeg: Path) -> np.ndarray:
    proc = run(
        [
            str(ffmpeg),
            "-v",
            "error",
            "-i",
            str(path),
            "-f",
            "f32le",
            "-ac",
            "2",
            "-ar",
            str(SAMPLE_RATE),
            "pipe:1",
        ]
    )
    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    return audio.reshape((-1, 2)).copy()


def encode_wav(path: Path, audio: np.ndarray, ffmpeg: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "f32le",
            "-ac",
            "2",
            "-ar",
            str(SAMPLE_RATE),
            "-i",
            "pipe:0",
            str(path),
        ],
        stdin=subprocess.PIPE,
    )
    proc.communicate(audio.astype(np.float32).tobytes())
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed writing {path}")


def filter_fft(audio: np.ndarray, low: float | None = None, high: float | None = None) -> np.ndarray:
    out = np.zeros_like(audio)
    for channel in range(audio.shape[1]):
        spec = np.fft.rfft(audio[:, channel])
        freqs = np.fft.rfftfreq(len(audio), 1 / SAMPLE_RATE)
        mask = np.ones_like(freqs)
        if low is not None:
            width = max(low * 0.25, 80)
            mask *= np.clip((freqs - (low - width)) / width, 0, 1)
        if high is not None:
            width = max(high * 0.25, 250)
            mask *= np.clip(((high + width) - freqs) / width, 0, 1)
        out[:, channel] = np.fft.irfft(spec * mask, n=len(audio))
    return out.astype(np.float32)


def resample_to(audio: np.ndarray, seconds: float) -> np.ndarray:
    target = max(1, int(seconds * SAMPLE_RATE))
    source = np.linspace(0, 1, len(audio), endpoint=False)
    target_x = np.linspace(0, 1, target, endpoint=False)
    return np.column_stack(
        [np.interp(target_x, source, audio[:, channel]) for channel in range(2)]
    ).astype(np.float32)


def envelope(audio: np.ndarray, fade_in: float = 0.0, fade_out: float = 0.0) -> np.ndarray:
    env = np.ones(len(audio), dtype=np.float32)
    if fade_in > 0:
        n = min(len(env), int(fade_in * SAMPLE_RATE))
        env[:n] *= np.linspace(0, 1, n, dtype=np.float32)
    if fade_out > 0:
        n = min(len(env), int(fade_out * SAMPLE_RATE))
        env[-n:] *= np.linspace(1, 0, n, dtype=np.float32)
    return audio * env[:, None]


def gain_to_peak(audio: np.ndarray, target_db: float) -> np.ndarray:
    peak = float(np.max(np.abs(audio)))
    if peak == 0:
        return audio
    return audio * (db_to_amp(target_db) / peak)


def pan(audio: np.ndarray, amount: float) -> np.ndarray:
    left = math.cos((amount + 1) * math.pi / 4)
    right = math.sin((amount + 1) * math.pi / 4)
    mono = audio.mean(axis=1)
    return np.column_stack([mono * left, mono * right]).astype(np.float32)


def place(canvas: np.ndarray, audio: np.ndarray, start: float, gain_db: float = 0.0) -> None:
    offset = int(start * SAMPLE_RATE)
    if offset >= len(canvas):
        return
    chunk = audio * db_to_amp(gain_db)
    end = min(len(canvas), offset + len(chunk))
    canvas[offset:end] += chunk[: end - offset]


def shimmer(sample: np.ndarray, count: int) -> np.ndarray:
    rng = np.random.default_rng(20261009)
    total = np.zeros((int(1.0 * SAMPLE_RATE), 2), dtype=np.float32)
    base = filter_fft(sample, high=5_400)
    for index in range(count):
        start = 0.04 + index * 0.08 + float(rng.uniform(-0.012, 0.012))
        length = float(rng.uniform(0.055, 0.105))
        stretch = resample_to(base, length)
        stretch = envelope(stretch, 0.006, 0.045)
        stretch = pan(stretch, float(rng.uniform(-0.45, 0.45)))
        place(total, stretch, start, -22 - index * 1.6)
    return total


def make_metrics(name: str, audio: np.ndarray) -> dict[str, float | str]:
    mono = audio.mean(axis=1)
    peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
    rms = float(np.sqrt(np.mean(audio * audio))) if len(audio) else 0.0
    window = np.hanning(len(mono)) if len(mono) else np.array([])
    spec = np.abs(np.fft.rfft(mono * window)) if len(mono) else np.array([0.0])
    freqs = np.fft.rfftfreq(len(mono), 1 / SAMPLE_RATE) if len(mono) else np.array([0.0])
    energy = float(np.sum(spec * spec) + 1e-12)
    high = float(np.sum(spec[freqs > 6_000] ** 2) / energy)
    centroid = float(np.sum(freqs * spec) / (np.sum(spec) + 1e-12))
    return {
        "file": name,
        "durationSeconds": round(len(audio) / SAMPLE_RATE, 6),
        "peakDbfs": round(db(peak), 3),
        "rmsDbfs": round(db(rms), 3),
        "highEnergyRatioOver6k": round(high, 6),
        "spectralCentroidHz": round(centroid, 3),
    }


def loudness(audio: np.ndarray) -> dict[str, float]:
    peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
    rms = float(np.sqrt(np.mean(audio * audio))) if len(audio) else 0.0
    clipped = int(np.sum(np.abs(audio) >= 0.999))
    mono = audio.mean(axis=1)
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), 1 / SAMPLE_RATE)
    energy = float(np.sum(spec * spec) + 1e-12)
    high = float(np.sum(spec[freqs > 6_000] ** 2) / energy)
    return {
        "peakDbfs": round(db(peak), 3),
        "rmsDbfs": round(db(rms), 3),
        "clippedSamples": clipped,
        "highEnergyRatioOver6k": round(high, 6),
    }


def mux(video: Path, wav: Path, output: Path, ffmpeg: Path) -> None:
    run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video),
            "-i",
            str(wav),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "2",
            "-shortest",
            "-movflags",
            "+faststart",
            str(output),
        ]
    )


def video_hash(path: Path, ffmpeg: Path) -> str:
    proc = run(
        [
            str(ffmpeg),
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            "0:v:0",
            "-c",
            "copy",
            "-f",
            "hash",
            "-hash",
            "SHA256",
            "-",
        ]
    )
    return proc.stdout.decode("utf-8").strip().split("=", 1)[1]


def probe(path: Path, ffprobe: Path) -> dict:
    proc = run(
        [
            str(ffprobe),
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ]
    )
    return json.loads(proc.stdout)


def relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def parse_args() -> ArgumentParser:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--ffmpeg",
        type=Path,
        default=shutil.which("ffmpeg"),
        help="ffmpeg binary path. Defaults to ffmpeg from PATH.",
    )
    parser.add_argument(
        "--ffprobe",
        type=Path,
        default=shutil.which("ffprobe"),
        help="ffprobe binary path. Defaults to ffprobe from PATH.",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=None,
        help="Directory for temporary wav/mp4 build outputs. Defaults to a temporary directory.",
    )
    return parser


def main() -> None:
    args = parse_args().parse_args()
    if args.ffmpeg is None:
        raise SystemExit("ffmpeg is required. Pass --ffmpeg or add ffmpeg to PATH.")
    if args.ffprobe is None:
        raise SystemExit("ffprobe is required. Pass --ffprobe or add ffprobe to PATH.")

    ffmpeg = Path(args.ffmpeg)
    ffprobe = Path(args.ffprobe)
    tmp_context = None
    if args.work_dir is None:
        tmp_context = tempfile.TemporaryDirectory(prefix="gacha-stamp-audio-")
        work_dir = Path(tmp_context.name)
    else:
        work_dir = args.work_dir
        work_dir.mkdir(parents=True, exist_ok=True)
    output_audio_dir = work_dir / "user-sounds-build"
    output_audio_dir.mkdir(parents=True, exist_ok=True)

    samples: dict[str, np.ndarray] = {}
    source_metrics = []
    for name in USED_SOURCES:
        src = SOURCE_DIR / name
        if not src.exists():
            raise FileNotFoundError(src)
        audio = decode(src, ffmpeg)
        samples[name] = audio
        source_metrics.append(make_metrics(name, audio))

    original_idle_hash = video_hash(IDLE_VIDEO, ffmpeg)
    original_reveal_hash = video_hash(REVEAL_VIDEO, ffmpeg)

    reveal = np.zeros((int(REVEAL_DURATION * SAMPLE_RATE), 2), dtype=np.float32)

    low_swell = resample_to(filter_fft(samples["minimize_006.ogg"], high=850), 1.15)
    low_swell = envelope(gain_to_peak(low_swell, -16), 0.25, 0.18)
    place(reveal, low_swell, 0.95, -15)

    crease = filter_fft(samples["maximize_009.ogg"], high=3_200)
    crease = envelope(gain_to_peak(crease, -15), 0.006, 0.08)
    place(reveal, pan(crease, -0.16), 1.42, -11)

    tear_bed = resample_to(filter_fft(samples["select_006.ogg"], low=250, high=3_800), 0.62)
    tear_bed = envelope(gain_to_peak(tear_bed, -17), 0.03, 0.16)
    place(reveal, pan(tear_bed, 0.12), 1.46, -9)

    for start, source, pan_amount, level in [
        (1.50, "drop_004.ogg", -0.28, -16),
        (1.58, "drop_003.ogg", 0.20, -18),
        (1.69, "glass_002.ogg", -0.08, -21),
        (1.79, "glass_001.ogg", 0.26, -22),
    ]:
        scrape = filter_fft(samples[source], low=180, high=4_500)
        scrape = envelope(gain_to_peak(scrape, -14), 0.004, 0.07)
        place(reveal, pan(scrape, pan_amount), start, level)

    coin_pulse = resample_to(filter_fft(samples["maximize_008.ogg"], high=1_100), 0.34)
    coin_pulse = envelope(gain_to_peak(coin_pulse, -14), 0.01, 0.16)
    place(reveal, coin_pulse, 1.56, -14)

    burst_low = resample_to(filter_fft(samples["minimize_006.ogg"], high=1_200), 0.95)
    burst_low = envelope(gain_to_peak(burst_low, -12), 0.025, 0.62)
    place(reveal, burst_low, 2.30, -10)

    burst_chime = filter_fft(samples["select_005.ogg"], low=450, high=5_200)
    burst_chime = envelope(gain_to_peak(burst_chime, -16), 0.006, 0.27)
    place(reveal, pan(burst_chime, -0.22), 2.39, -9)

    sparkle = shimmer(samples["glass_001.ogg"], 9)
    place(reveal, sparkle, 2.48, -7)

    echo = np.zeros_like(reveal)
    echo_delay = int(0.115 * SAMPLE_RATE)
    echo[echo_delay:] = reveal[:-echo_delay] * 0.18
    reveal += filter_fft(echo, high=3_900)

    reveal = filter_fft(reveal, high=5_600)
    reveal = envelope(reveal, 0.0, 0.55)
    reveal = np.tanh(reveal * 1.15) / 1.15
    reveal = gain_to_peak(reveal, -3.7)

    idle = np.zeros((int(IDLE_DURATION * SAMPLE_RATE), 2), dtype=np.float32)

    idle_wav = output_audio_dir / "gacha-stamp-idle-user.wav"
    reveal_wav = output_audio_dir / "gacha-stamp-reveal-user.wav"
    encode_wav(idle_wav, idle, ffmpeg)
    encode_wav(reveal_wav, reveal, ffmpeg)

    idle_tmp = output_audio_dir / "gacha-stamp-idle-user.mp4"
    reveal_tmp = output_audio_dir / "gacha-stamp-reveal-user.mp4"
    mux(IDLE_VIDEO, idle_wav, idle_tmp, ffmpeg)
    mux(REVEAL_VIDEO, reveal_wav, reveal_tmp, ffmpeg)

    new_idle_hash = video_hash(idle_tmp, ffmpeg)
    new_reveal_hash = video_hash(reveal_tmp, ffmpeg)
    if new_idle_hash != original_idle_hash:
        raise RuntimeError("idle video stream changed while muxing audio")
    if new_reveal_hash != original_reveal_hash:
        raise RuntimeError("reveal video stream changed while muxing audio")

    shutil.copy2(idle_tmp, IDLE_VIDEO)
    shutil.copy2(reveal_tmp, REVEAL_VIDEO)

    manifest = {
        "sourceDir": relative(SOURCE_DIR),
        "usedSources": USED_SOURCES,
        "excludedForSharpness": [
            "switch5.ogg",
            "switch6.ogg",
            "select_007.ogg",
            "select_008.ogg",
            "drop_001.ogg",
            "select_001.ogg",
            "select_002.ogg",
        ],
        "selectionMethod": "Waveform, RMS, peak, FFT high-frequency ratio and spectral-centroid analysis; no subjective listening was available in this environment.",
        "cueTimingSeconds": {
            "crease": 1.42,
            "tear": 1.50,
            "coin": 1.56,
            "burst": 2.39,
            "glitter": [2.48, 3.28],
        },
        "sourceMetrics": source_metrics,
        "outputs": {
            "idle": {
                "path": relative(IDLE_VIDEO),
                "audioMetrics": loudness(idle),
                "videoSha256": video_hash(IDLE_VIDEO, ffmpeg),
                "probe": probe(IDLE_VIDEO, ffprobe),
            },
            "reveal": {
                "path": relative(REVEAL_VIDEO),
                "audioMetrics": loudness(reveal),
                "videoSha256": video_hash(REVEAL_VIDEO, ffmpeg),
                "probe": probe(REVEAL_VIDEO, ffprobe),
            },
        },
    }

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "idleVideoSha256": manifest["outputs"]["idle"]["videoSha256"],
        "revealVideoSha256": manifest["outputs"]["reveal"]["videoSha256"],
        "idleAudio": manifest["outputs"]["idle"]["audioMetrics"],
        "revealAudio": manifest["outputs"]["reveal"]["audioMetrics"],
        "manifest": relative(MANIFEST_PATH),
    }, ensure_ascii=False, indent=2))

    if tmp_context is not None:
        tmp_context.cleanup()


if __name__ == "__main__":
    main()
