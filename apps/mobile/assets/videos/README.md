# 뽑기 우표 영상

2026-10-09 사용자가 화면을 승인한 뒤 제공한 효과음 후보로 다시 교체한 자산이다. 검은 배경에서 우표 한 장이 들썩이고, 개봉 때 손이나 받침판 없이 종이 자체가 찢어진다. 개봉 영상의 흰 코인에는 실제 보상을 식별하는 문양이 없다.

| 파일 | 용도 | 길이 | 형식 |
| --- | --- | --- | --- |
| `gacha-stamp-idle.mp4` | 구매 전·요청 대기 반복 | 3초 | 1080x1920, H.264, 24fps, silent AAC stereo 48kHz |
| `gacha-stamp-reveal.mp4` | 서버 결과 확정 후 개봉 | 약 4.208초 | 1080x1920, H.264, 24fps, AAC stereo 48kHz |
| `gacha-stamp-poster.png` | 동작 줄이기·재생 불가 대체 | 정지 | 대기 영상의 첫 프레임 |

동영상은 승인본을 재인코딩하지 않고 그대로 복사했다. 효과음은 사용자가 제공한 `sound list`의 OGG 파일을 분석해 고역 비율이 낮은 소스 위주로 다시 합성했다. 이 환경에서는 실제 청음이 불가능해 RMS, peak, spectral centroid, 6kHz 이상 에너지 비율을 기준으로 날카로운 후보를 제외했다.

사용한 소스는 `sources/gacha-stamp-user-sounds/`에 복사해 두었다. 대기 영상은 반복 재생 중 거슬리지 않도록 무음 AAC만 포함한다. 개봉 영상은 짧은 반응음, 우표가 찢기는 질감, 흰 코인 등장, 빛줄기 burst와 잔향을 4.208초 타임라인에 맞췄다.

재현에는 Python과 `numpy`, `ffmpeg`, `ffprobe`가 필요하다. 기본 실행은 repo 안의 OGG 소스와 현재 MP4 영상 스트림만 사용한다.

```powershell
python apps/mobile/scripts/media/build-gacha-stamp-audio.py
```

PATH에 ffmpeg가 없으면 직접 지정한다.

```powershell
python apps/mobile/scripts/media/build-gacha-stamp-audio.py --ffmpeg "C:\Program Files\Shotcut\ffmpeg.exe" --ffprobe "C:\Program Files\Shotcut\ffprobe.exe"
```

빌드 manifest는 `assets/videos/gacha-stamp-audio-manifest.json`에 저장된다.

개봉 사운드 검증값: peak `-3.7 dBFS`, RMS `-21.194 dBFS`, clipping sample `0`, 6kHz 이상 에너지 비율 `0.000044`.

대기 영상 SHA-256(영상 스트림): `c6608d56a7850973c26f5b0e9ede2a2c180a5ae8f346a7b189174442c6ff3dca`.

개봉 영상 SHA-256(영상 스트림): `a15cccd3b5bf0dd50d893233e3e3ade7de706a55686e80a225a4e8e3e8849bb2`.
