# UI 효과음

사용자가 제공한 Kenney Interface Sounds 1.0과 UI SFX Set(CC0)에서 짧은 효과음 7개를 골랐다. 원본 라이선스는 이 폴더의 `LICENSE-interface-sounds.txt`와 `LICENSE-ui-audio.txt`에 보관한다.

| 파일 | 원본 팩 / 원본 파일 | 동작 |
| --- | --- | --- |
| `tap.wav` | UI Audio / `click1.ogg` | 공통 버튼과 카드 누르기 |
| `navigate.wav` | UI Audio / `switch2.ogg` | 다른 탭으로 이동 |
| `success.wav` | Interface Sounds / `confirmation_002.ogg` | 방문 수령·쿠폰·수집품 획득 |
| `error.wav` | Interface Sounds / `error_001.ogg` | 방문 코드 확인·수령 오류 |
| `open.wav` | Interface Sounds / `open_001.ogg` | 봉투·보상 상자 열기 |
| `flip.wav` | Interface Sounds / `select_001.ogg` | 수집품 카드 넘기기 |
| `close.wav` | Interface Sounds / `close_001.ogg` | 뒤로 이동·획득 연출 닫기 |
| `draw-intro.mp3` | 사용자 제공 `뽑기 시작 브금.mp3` | 뽑기 화면 진입 인트로 BGM |
| `draw-loop.mp3` | 사용자 제공 `브금.mp3` | 인트로 종료·화면 이탈 뒤 반복 BGM |

Android·iOS·웹에서 같은 자산을 사용하도록 원본 OGG를 mono / 44,100 Hz / PCM 16-bit WAV로 변환했다. 변환 시 메타데이터를 제거했으며 7개 WAV의 합계는 128,026바이트다. 새 npm 의존성은 없다.

변환 명령(FFmpeg 7.1):

```sh
ffmpeg -hide_banner -loglevel error -nostdin -i INPUT.ogg -map_metadata -1 -ac 1 -ar 44100 -c:a pcm_s16le OUTPUT.wav
```

출처: [Kenney](https://kenney.nl/), [CC0](https://creativecommons.org/publicdomain/zero/1.0/). 음원은 앱의 UI 피드백용이며 사장님이 게시한 수집품 음성과 별도다.
