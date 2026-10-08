# Android 설치본 용량 분석 (원인 단정 없음)

기준일 2026-10-08 KST, Issue #412. 이 문서는 이 PC에 이미 있는 산출물을 읽기만 해서 얻은 측정값과, 아직 확인하지 못한 **가설**을 나눠 적습니다. 빌드도 내려받기도 하지 않았습니다. 용량이 커진 원인은 아직 단정하지 않습니다.

용량은 세 가지가 서로 다릅니다. 이 문서에서 MB는 1,000,000바이트입니다.

- **APK 파일 크기**: GitHub Release에서 받는 파일의 크기입니다. 운영 test.13은 324,041,973바이트, 시연 Preview 22는 329,670,098바이트입니다(GitHub Release asset 메타데이터. 두 파일은 이 PC에 없습니다).
- **스토어 다운로드 크기**: Play가 AAB에서 기기별로 만들어 내려주는 크기입니다. GitHub 직접 배포에는 해당하지 않습니다.
- **설치 후 디스크 크기**: 기기에 풀린 뒤의 크기입니다. 이번에는 재지 않았습니다.

웹 첫 로딩은 설치 용량과 다른 지표이므로 [별도 절](#웹-첫-로딩-android-설치-용량과-별개)에 둡니다.

## 1. 이 PC에 있는 산출물과 없는 것

| 산출물 | 크기(바이트) | 비고 |
| --- | ---: | --- |
| `apps/mobile/release-artifacts/MassCOM-operating-android-c5cba68.apk` | 148,425,402 | 2026-09-28 운영 universal APK. 지도 SDK 도입 전입니다. |
| 같은 폴더의 `app-release-{f13a283,0d93c49,60d37a7,22283d7,c5cba68}.aab` | 95.6~96.0 MB | 2026-09-22~28 AAB 5개. 모두 지도 SDK 도입 전입니다. |
| 같은 폴더의 `*-universal.apks` 5개 | 148.0~148.4 MB | `universal.apk` 한 개를 담은 묶음이라 APK와 같은 내용입니다. |
| 형제 worktree `.worktrees/pr374-repair/.tmp/` 아래 비공개 arm64 검증 APK | 108,977,445~134,461,519 | 지도 SDK 포함. 디버그 인증서 서명이고 공개 배포가 아닙니다. 읽기만 했습니다. |
| **공개 test.13(324MB)·Preview 22(330MB) APK** | 없음 | 이 PC에 없습니다. 아래 가설은 이 파일을 직접 열어 보기 전에는 확인되지 않습니다. |

`bundletool`이 설치돼 있지 않아 AAB의 `get-size total --dimensions=ABI`는 돌리지 못했습니다. 대신 AAB 안 항목 크기로 근사했습니다(3절).

## 2. 측정 A: 2026-09-28 운영 universal APK (148,425,402바이트)

`unzip -lv`와 `apkanalyzer apk summary/file-size/download-size`로 쟀습니다. 패키지 `kr.masscom.wolgye`, 버전 `0.1.0-test.2`, versionCode 2입니다. `apkanalyzer`의 다운로드 크기 추정은 66,927,733바이트입니다. 항목은 1,423개이고 압축 전 합계는 181,920,015바이트입니다.

| 구성 | 압축 방식 | zip 안 크기(바이트) | APK 파일 대비 |
| --- | --- | ---: | ---: |
| 네이티브 라이브러리 4개 ABI | 모두 Stored(무압축) | 118,719,408 | 80.0% |
| dex 5개 | Deflate | 18,594,368 (압축 전 52,179,304) | 12.5% |
| `assets/` | 대부분 Stored | 6,268,494 | 4.2% |
| `resources.arsc` | Stored | 1,913,496 | 1.3% |
| `res/` 1,021개 | 혼합 | 1,515,474 | 1.0% |
| 기타·`META-INF/` | Deflate | 187,881 | 0.1% |
| zip 구조·정렬 여백·서명 블록 | | 1,226,281 | 0.8% |

ABI별 네이티브 라이브러리입니다. 29개 라이브러리 이름이 네 ABI에 모두 같습니다.

| ABI | 파일 수 | 크기(바이트) | APK 파일 대비 |
| --- | ---: | ---: | ---: |
| `arm64-v8a` | 29 | 31,135,936 | 21.0% |
| `armeabi-v7a` | 29 | 21,335,872 | 14.4% |
| `x86` | 29 | 33,302,968 | 22.4% |
| `x86_64` | 29 | 32,944,632 | 22.2% |

크기가 큰 `.so`입니다(네 ABI 합계). 위 10개가 네이티브 전체의 80%입니다.

| 라이브러리 | 네 ABI 합계(바이트) | arm64 한 벌(바이트) |
| --- | ---: | ---: |
| `libreactnative.so` | 26,305,072 | 6,985,168 |
| `libbarhopper_v3.so` | 20,222,808 | 4,946,720 |
| `libhermesvm.so` | 9,789,288 | 2,477,320 |
| `libuniffi_yttrium_wcpay.so` | 8,698,224 | 2,272,176 |
| `libappmodules.so` | 6,609,108 | 1,739,944 |
| `libreanimated.so` | 5,433,764 | 1,501,072 |
| `libexpo-modules-core.so` | 5,391,636 | 1,487,160 |
| `libc++_shared.so` | 4,672,844 | 1,292,904 |
| `libreact_codegen_rnscreens.so` | 4,525,500 | 1,200,624 |
| `libworklets.so` | 3,856,624 | 1,101,304 |

이름만으로 출처를 짐작하면 `libbarhopper_v3.so`와 `assets/mlkit_barcode_models/`는 ML Kit 바코드 스캔, `libuniffi_yttrium_wcpay.so`는 지갑 연결 쪽으로 보입니다. 의존성 트리로 확인한 것은 아니므로 추정입니다.

`assets/`는 6.27MB이고 그중 `index.android.bundle`(Hermes 바이트코드)이 5,374,460바이트, ML Kit 모델 세 개가 880,888바이트입니다. `res/`에서 가장 큰 것은 Material Symbols 글꼴 430,323바이트(Deflate)이고 이미지 최대는 182,335바이트입니다. 이 시점에는 놀이·수집품 이미지와 음원이 아직 들어 있지 않았습니다.

`apkanalyzer dex packages`의 추정 dex 크기는 26,687,548바이트입니다. 가장 큰 패키지는 `androidx.compose` 7,403,307, `com.google` 4,296,766, `expo.modules` 2,357,396, `com.facebook` 1,942,808, `androidx.camera` 1,799,840입니다.

## 3. 측정 B: AAB와 ABI별 근사

AAB `app-release-c5cba68.aab`는 96,006,748바이트입니다. 이 가운데 `BUNDLE-METADATA/…debugsymbols`가 28,139,716바이트(29%)이고 사용자에게 내려가지 않습니다. 나머지 67,867,032바이트는 위 `apkanalyzer` 다운로드 추정(66,927,733)과 비슷합니다. `apkanalyzer apk file-size/download-size`를 AAB에 쓰면 파일 크기만 나오므로 설치 추정으로 쓰지 않았습니다.

AAB 안에서 라이브러리는 Deflate로 압축돼 있어 ABI별 크기가 APK(무압축)와 다릅니다.

| ABI | AAB 안 압축 크기(바이트) | APK 안 무압축 크기(바이트) |
| --- | ---: | ---: |
| `arm64-v8a` | 10,877,408 | 31,135,936 |
| `armeabi-v7a` | 9,299,608 | 21,335,872 |
| `x86` | 11,887,687 | 33,302,968 |
| `x86_64` | 11,541,055 | 32,944,632 |

arm64 기기 한 대가 받는 크기를 **근사**하면 dex 18,594,368 + assets 2,925,644 + res 1,528,848 + `resources.pb` 583,951 + arm64 라이브러리 10,877,408 = 약 34.5MB입니다. 이는 `bundletool` 실측이 아닙니다. 위 두 표는 같은 라이브러리가 APK에서는 무압축(Stored)이라 파일 크기에 그대로 더해지고, AAB 경로에서는 압축된다는 차이를 보여 줍니다. 이 APK에서 라이브러리가 무압축인 것은 `expo.useLegacyPackaging=false` 때문으로 보입니다. 메인 체크아웃의 9-28 prebuild(`apps/mobile/android/gradle.properties`, git이 추적하지 않는 파일)에 이 값이 있습니다. 같은 파일에서 `reactNativeArchitectures`는 네 ABI 전부이고, `android.enableMinifyInReleaseBuilds`·`android.enableShrinkResourcesInReleaseBuilds`는 지정돼 있지 않아 `app/build.gradle`의 기본값 false가 적용되며, PNG crunch는 true입니다. 저장소의 `scripts/`·`apps/mobile/plugins/`·`app.config.ts`·`package.json`에는 이 값들을 바꾸는 줄이 없고(`grep`으로 확인) 빌드 스크립트가 `expo prebuild --clean`으로 `android/`를 매번 다시 만들므로, 모두 Expo 템플릿 기본값으로 보입니다. 10-08 공개 빌드의 `android/`는 남아 있지 않아 같은 설정이었는지는 확인하지 못했습니다.

## 4. 측정 C: 지도 SDK 이후 비공개 arm64 APK (공개 아님)

형제 worktree의 비공개 검증 APK입니다. arm64 한 ABI만 들어 있고 디버그 인증서로 서명돼 있어 공개 설치본과 **같은 설정이 아닙니다**. 10-06 두 개의 크기는 [`docs/evidence/real-world-2026-10-06/native-builds.json`](evidence/real-world-2026-10-06/native-builds.json)과 일치합니다.

| 항목 | 9-28 운영(4 ABI) | 10-06 운영 arm64 | 10-07 개발 후보 arm64 |
| --- | ---: | ---: | ---: |
| APK 파일 | 148,425,402 | 108,977,445 | 134,461,519 |
| arm64 라이브러리 | 31,135,936 | 40,983,856 | 65,747,592 |
| dex(zip) | 18,594,368 | 21,399,684 | 21,564,822 |
| `res/`(zip) | 1,515,474 | 34,875,209 | 35,348,063 |
| `assets/`(zip) | 6,268,494 | 8,724,377 | 8,746,280 |
| `resources.arsc` | 1,913,496 | 2,316,028 | 2,346,896 |

arm64 라이브러리 증가분은 라이브러리 두 개로 거의 설명됩니다. `libvsmsdk_jni.so`(TMAP) 9,835,520바이트가 10-06부터, `libnavermap.so` 24,763,736바이트가 10-07 후보부터 들어 있습니다. 합 34,599,256바이트이고 증가분 34,611,656바이트와 12,400바이트 차이입니다. `res/`는 1.5MB에서 약 35MB가 됐습니다. 이미지와 음원이 들어왔기 때문으로 보이며, 가장 큰 항목은 `res/d5.mp3` 4,112,413바이트(`draw-loop.mp3`와 같은 크기)와 PNG 여러 개(1.6~2.3MB)입니다. 10-06 이후 빌드의 `res/` 경로가 `d5.mp3`처럼 짧게 바뀌어 있는데, 9-28 빌드는 `drawable-mdpi-v4/assets_images_…`처럼 길었습니다. 두 빌드의 설정이 달랐을 수 있다는 관찰일 뿐 원인은 확인하지 않았습니다.

## 5. 측정 D: 지도 SDK 네이티브 라이브러리의 ABI별 크기

로컬 Gradle 캐시의 Naver `map-sdk-3.24.0.aar`(압축 전 크기)와 TMAP `vsm-tmap-sdk-v2-eaa-2.0.14`의 `jni/`를 읽었습니다.

| ABI | `libnavermap.so` | `libvsmsdk_jni.so` | 합계 |
| --- | ---: | ---: | ---: |
| `arm64-v8a` | 24,763,736 | 9,835,520 | 34,599,256 |
| `armeabi-v7a` | 18,858,132 | 6,855,516 | 25,713,648 |
| `x86` | 25,475,100 | 10,263,196 | 35,738,296 |
| `x86_64` | 26,138,896 | 10,539,456 | 36,678,352 |
| 네 ABI | 95,235,864 | 37,493,688 | 132,729,552 |

## 6. 측정 E: 소스 에셋과 Metro 번들

`apps/mobile/assets`는 파일 87개, 45,033,691바이트(`du` 44,148KiB)입니다.

| 폴더 | 파일 수 | 크기(바이트) |
| --- | ---: | ---: |
| `images/experience-quality` | 16 | 19,093,472 |
| `images/play` | 5 | 8,376,574 |
| `images/collectibles` | 3 | 5,945,550 |
| `images/room` | 3 | 3,552,495 |
| `images/mascot` | 25 | 1,849,032 |
| `images/shop` | 14 | 506,106 |
| `sounds` | 12 | 4,751,457 |

이미지는 PNG 65개 40,144,055바이트이고 대부분 1254×1254(`furniture-atlas.png`는 1536×1024)입니다. 한 장에 1.3~2.4MB입니다. 음원 중 `draw-loop.mp3`가 4,112,413바이트이며 길이 177.6초, 스테레오, 48kHz, 약 184kbps입니다. `draw-intro.mp3`는 508,307바이트입니다.

`npx expo export --platform android --dump-assetmap`을 이 worktree에서 돌렸습니다. 인터넷 없이 29초 걸렸고 기본(개발) variant 기준입니다. Hermes 번들은 9,955,553바이트(`entry-….hbc`)입니다. 자산 지도에는 앱 자산 56개 37,882,384바이트(이미지 33,133,638, 음원 4,748,746)와 `node_modules` 자산 30개 990,649바이트가 있습니다. 소스에는 있으나 지도에 없는 파일은 21개 7,089,089바이트이고, 그중 `collectibles/showcase-{a,b,c}.png` 세 개가 5,945,550바이트입니다. 이 세 파일이 왜 빠졌는지는 확인하지 않았습니다. 시연·운영 variant는 환경 변수가 필요해 돌리지 않았으므로 variant별 차이는 모릅니다.

## 웹 첫 로딩 (Android 설치 용량과 별개)

웹은 APK에 들어가지 않고 네트워크로 전송되는 크기가 문제입니다. 아래는 메인 체크아웃의 2026-10-04 웹 QA 내보내기(`apps/mobile/dist-web-qa`)를 읽은 값입니다. 현재 `/play/` 번들(`5ca98955`, entry `entry-858be2c6…js`)은 이 PC에 없어 **현재 공개 번들의 측정이 아닙니다**.

| 항목 | 값(바이트) |
| --- | ---: |
| 내보내기 전체(파일 67개) | 16,752,806 |
| 첫 화면 스크립트 3개 중 `entry-….js` | 5,815,562 |
| 같은 파일을 gzip -6 / zstd -3 / brotli -q5로 압축한 크기 | 1,555,917 / 1,446,198 / 1,280,532 |
| `_expo/` 스크립트 7개 합계 | 6,077,907 |
| PNG 49개(필요할 때 받는 이미지) | 10,453,597 |

압축 크기는 로컬 명령으로 추정한 값이며 서버(Caddy)가 실제로 어떤 압축을 쓰는지는 재지 않았습니다. 웹의 첫 화면 응답 속도(로딩 그림으로 가리기와 실제 단축)는 이 문서가 다루지 않고 [브라우저 측정 기록](evidence/next-build-2026-10-08/README.md)처럼 따로 잽니다.

## 7. 가설 (모두 미확인)

아래는 위 측정에서 이끌어 낸 **가설**입니다. 공개 test.13 APK를 열어 보기 전에는 맞다고 말할 수 없습니다.

- **가설 1. 지도 SDK 라이브러리가 네 ABI 모두 들어 있어 큰 몫을 차지한다.** 5절의 네 ABI 합계 132,729,552바이트는 324,041,973바이트의 약 41%입니다. 9-28 APK(148,425,402)에 이 값을 더하고, 4절에서 본 `res/`·dex·assets·`resources.arsc` 증가분(10-06 운영 arm64 대비 39,023,466바이트)을 더하면 약 320.2MB로 실제 324.0MB와 1.2% 안에서 맞습니다. 서로 다른 빌드를 합친 산수라 증거가 아니라 **정합성 점검**일 뿐입니다.
- **가설 2. 번들된 이미지·음원이 `res/`에서 약 33MB를 차지한다.** 4절의 `res/` 증가분(약 33.4MB)과 6절의 앱 자산 37.9MB가 비슷합니다. PNG는 1254×1254 한 장이 1.3~2.4MB이고 `draw-loop.mp3`는 177초·184kbps입니다. 무엇이 줄일 수 있는 크기인지는 모릅니다.
- **가설 3. x86·x86_64 라이브러리는 실제 기기에서 쓰이지 않는다.** 이 PC의 실기기(SM-S928N)와 에뮬레이터 둘 다 `ro.product.cpu.abilist`가 `arm64-v8a`뿐입니다(에뮬레이터는 16KB 페이지 이미지). 두 x86 계열의 라이브러리는 9-28 기준 66,247,600바이트에 지도 SDK 72,416,648바이트를 더해 약 138.7MB(324.0MB의 42.8%)입니다. 이 가설은 **소유자가 지원 기기 범위를 정한 뒤에** 의미가 있습니다.
- **가설 4. ML Kit 바코드 스캔이 번들 모델 방식이라 네 ABI에 중복돼 있다.** `libbarhopper_v3.so`가 네 ABI 합계 20,222,808바이트입니다. 어떤 의존성이 이 방식을 끌어오는지는 확인하지 않았습니다.
- **가설 5. R8·`shrinkResources`가 꺼져 있어 dex가 크다.** 9-28 prebuild에서 둘 다 꺼져 있었고(3절) dex는 압축 전 52MB입니다. 저장소에 이를 켜는 설정이 없어 지금도 꺼져 있을 가능성이 높지만, 10-08 빌드에서 직접 확인하지는 못했습니다.
- **가설 6. APK 파일 크기는 무압축 `.so` 때문에 부풀어 있다.** 3절의 비교로는 AAB 안 압축 크기가 APK 안 무압축 크기의 약 35~44%입니다. GitHub 직접 배포는 이 압축 이득을 받지 못하는 것으로 보입니다. `.so`를 APK 안에서 압축하는 선택(E5)이 설치 후 디스크 크기와 시작 시간에 주는 영향은 모릅니다.

## 8. 실험 계획

한 번에 변수 하나만 바꾸고, 같은 소스·같은 variant로 **비공개** 빌드를 만들어 크기를 비교합니다. 공개 설치본은 건드리지 않습니다. 이 문서의 작업은 여기까지 하지 않았습니다.

매 실험에서 재는 값은 같습니다. APK 파일 크기, `apkanalyzer apk download-size`, `unzip -lv` 항목별 합계(`lib/`·dex·`res/`·`assets/`), ELF 16KiB 정렬 검사, 실기기 설치 후 디스크 크기와 `am start -W` 콜드 스타트 시간입니다. 기준선 B0는 test.13과 같은 소스(`5ca98955`)·네 ABI·그대로의 설정입니다. B0를 만들면 324MB가 재현되는지, 그리고 위 가설 1~6이 실제 파일에서 맞는지부터 확인됩니다.

| 번호 | 바꾸는 한 가지 | 무엇을 재는가 | 필요한 설정 | 확인할 위험 |
| --- | --- | --- | --- | --- |
| B0 | 없음(기준선) | 324MB 재현, 항목별 실제 크기 | 없음 | 서명 키는 에이전트가 건드리지 않고 비공개 디버그 서명으로 만듭니다. |
| E1 | arm64-v8a만 | ABI 3개를 뺀 값의 크기와 가설 1·3 | Gradle 속성 `-PreactNativeArchitectures=arm64-v8a`(설정 파일 변경 없이 명령줄로 가능) | 32비트 기기와 x86 에뮬레이터에서 설치 불가. |
| E2 | arm64-v8a + armeabi-v7a | 32비트 지원의 한계 비용 | 같은 속성에 두 ABI | 한계 비용만큼이 소유자 판단 대상. |
| E3 | `splits.abi`로 ABI별 APK + universal | 한 번의 빌드로 ABI별 파일 크기 네 개 | 비공개 실험은 생성된 `app/build.gradle`을 손으로 고쳐 시험. 채택하면 작은 config plugin이 필요합니다. | Release asset이 늘어 사용자가 파일을 고르기 어려워집니다. |
| E4 | R8 minify + `shrinkResources` | dex와 `res/` 감소량(가설 5) | Gradle 속성 `-Pandroid.enableMinifyInReleaseBuilds=true -Pandroid.enableShrinkResourcesInReleaseBuilds=true`(생성된 `app/build.gradle`이 읽음) | Nitro·Reanimated·지갑 연결 라이브러리에 keep 규칙이 없으면 실행 중 크래시 가능. 실기기 실행 시험이 반드시 필요합니다. |
| E5 | `useLegacyPackaging` 전환 | 가설 6: APK 크기 감소와 설치 후 디스크 증가, 시작 시간 | Gradle 속성 `-Pexpo.useLegacyPackaging=true` | 16KiB 정렬 요건을 지켜야 합니다(`zipalign -c -P 16`로 확인). |
| E6 | `draw-loop.mp3` 비트레이트(예: 128·96kbps) | 음원 크기 감소와 청감 차이 | 자산 교체만 | 128kbps이면 약 2.8MB, 96kbps이면 약 2.1MB로 단순 계산됩니다. 음질은 사람이 들어 판정해야 합니다. |
| E7 | 큰 PNG 20개를 WebP로 변환 | `res/` 감소량(가설 2) | 자산 교체만 | 화질 차이는 소유자 눈으로 판정이 필요합니다. 투명도·아틀라스 좌표가 변하지 않는지 확인합니다. |
| E8 | ML Kit 바코드 스캔 방식(번들 vs 비번들) | 가설 4의 감소량 | 의존성 확인 후 설정 | 비번들은 첫 스캔 때 Play 서비스에서 모델을 받아 오프라인 첫 스캔이 안 될 수 있습니다. |

PNG 압축 해제(crunch) 설정은 별도 변수로 두지 않고 E7과 함께 봅니다. 전 항목이 B0와 같은 소스·variant여야 비교가 맞습니다.

## 9. 소유자 결정이 필요한 것

- **지원 기기 범위(기기 행렬).** 가설 3이 가리키는 ABI 제거는 용량을 가장 크게 줄일 수 있는 후보지만, 32비트 기기와 x86 에뮬레이터를 버리는 결정입니다. 이 PC의 두 실기기·에뮬레이터는 모두 arm64입니다. 점주·평가자의 기기를 알지 못하므로 추측하지 않고, 시연에 쓸 기기 목록을 정해 주셔야 합니다.
- **ABI별 Release asset을 낼지.** 파일이 줄지만 사용자가 고르는 일이 생깁니다. 한 개의 universal을 유지하면 설치 안내는 단순하지만 용량은 크게 남습니다.
- **음질·화질의 허용 범위.** E6·E7은 크기와 품질의 교환이라 사람이 판정해야 합니다.
- **설정을 저장소에 영구히 넣을지.** E1·E2·E4·E5는 명령줄 속성만으로 비공개 실험이 가능해 저장소를 바꾸지 않습니다. 채택하려면 `expo prebuild --clean`이 `android/`를 다시 만들기 때문에 로컬 config plugin(기존 `plugins/with-naver-map-repository.cjs`와 같은 방식)이나 새 의존성(`expo-build-properties`)이 필요하고, 새 의존성은 소유자 승인 사항입니다.

## 10. 이번에 하지 않은 것

- 공개 test.13·Preview 22 APK를 열지 않았습니다. 가장 싼 다음 확인은 이 파일의 zip 중앙 디렉터리(수백 KB)만 HTTP Range로 읽어 `unzip -lv`와 같은 표를 얻는 것입니다. 이는 네트워크 요청이므로 승인 후에 합니다. 전체 내려받기(약 324MB)는 B0 빌드를 대신할 수 있습니다.
- 설치 후 디스크 크기, 시작 시간, 실기기 설치는 재지 않았습니다.
- `bundletool get-size`를 돌리지 않았습니다(도구 없음).
- 위 실험 E1~E8과 Expo Atlas(`EXPO_ATLAS=1`)는 하지 않았습니다. 이번에는 `--dump-assetmap`까지만 했습니다.

재현 명령: `unzip -lv <apk>`, `~/Library/Android/sdk/cmdline-tools/latest/bin/apkanalyzer apk {summary,file-size,download-size} <apk>`, `apkanalyzer files list <apk>`, `apkanalyzer dex packages --defined-only <apk>`, `du -sk apps/mobile/assets`, `npx expo export --platform android --dump-assetmap --output-dir <임시 폴더>`(먼저 `npm ci --prefix apps/mobile`).
