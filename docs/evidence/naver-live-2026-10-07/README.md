# NAVER 실연결과 SDK 실행 순서 복구 — 2026-10-07

[Issue #385](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/385), `fix/naver-sdk-readiness`, 기준 main73284651([PR384](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/384) 병합). [키를 제외한 결과](results.json)·[검사 소스 해시](source-hashes.json). 실제 자격 증명/원본 SDK/인증 응답과 계정 연락처는 저장하지 않는다.

## 확인한 결과

- PASS: 신규 NAVER Maps `masscom` 등록. Dynamic Map·Geocoding만 선택하고 실제 웹 대표 도메인/검증용 로컬4422와 운영/시연/개발 패키지3개 등록. 대표 계정 확인 완료. 발급 값은 Git 밖의 권한600 환경 파일에 저장하며 앱에는 공개 ID만 전달했다. 콘솔 입력·등록은 CUA로 수행했다.
- PASS: 실제 NAVER 주소 후보1건. 실제 TMAP에 의도적 잘못된 검증 키를 넣으면 주소 API403 뒤 NAVER200·후보1건으로 대체됐다. 결과는 NAVER·EXTERNAL_PLACE 출처를 보존한다. 실제 사용자 GPS·점포 DB를 쓰지 않은 공개 서울시청 주소 검증이다.
- PASS: 실제 NAVER 공개 SDK GET200과 등록 출처의 인증 응답200/result=true. 이 응답을 타일 성공으로 해석하지 않는다.
- FAIL(수정 전): 검증 전용 웹 빌드에서 TMAP 인증 실패를 주입한 후 MAP_WEB_SDK_UNAVAILABLE을 확인했다. 실제 NAVER SDK3.10.3 소스는 콜백을 호출한 뒤 namespace를 export하므로 기존 즉시 검사에서 실패한다.
- PASS(수정 코드): 콜백과 script.onload가 모두 도착한 뒤 SDK 객체를 검증하도록 두 파일만 수정했다. 두 순서 회귀, 로더/세션7/7, 모바일 전체1777/1777·타입·lint, 독립 검토 필수 수정0, clear-cache 웹 export가 통과했다.
- NOT_RUN: 수정 후 실제 네이버 타일·마커·경로 표시. 확인 도중 브라우저 연결이 끊겼고 제어 도구가 사용자 이용 불가를 반환했다. 별도 Developers 지역 검색 키는 미발급이다. 지정 Samsung·네이티브 인증/타일·공개 서버/설치본·Play도 미검증이다.

## 재현과 재검증

실제 사용은 TMAP/NAVER 두 환경 파일을 빌드 프로세스에 명시적으로 전달하고 서버 Secret을 앱 환경에서 제외한다. 환경 값을 바꿔 검증할 때 Expo export에 --clear를 적용한다. 이를 생략한 첫 export는 이전 키 변환 캐시를 사용했으며 해당 실행은 대체 검증 성공 근거에서 제외했다. clear 후 검증 번들의 의도적 TMAP 오류 키·NAVER 공개ID 포함과 실제 TMAP 키·NAVER Secret 제외를 값 출력 없이 확인했다.

브라우저 재연결 후 localhost4422 개발 앱의 사용자→탐색→지도를 열어 로딩이 사라지고 네이버 출처·실제 타일을 표시하는지 확인한다. 서버클러스터 선택과 확대, TMAP 정상 보행 응답의 출처/표시를 확인하고 목록/지도 재전환·재진입을 검증한다. 이 private harness의 점포/영업/캠페인은 합성 QA 데이터이며 실제 영업점·혜택·점주 동의가 아니다. 폰 실기나 실제 사용 수용으로 바꾸어 기록하지 않는다.
