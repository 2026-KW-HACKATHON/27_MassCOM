# 기존 AWS 서버 SSH 접속

이 Mac에서는 AWS 콘솔 로그인 없이 터미널에서 `ssh masscom` 또는 `ssh masscom-api-seoul`로 서울 리전 기존 Lightsail에 접속할 수 있습니다. 바탕화면의 MassCOM 폴더에 있는 `connect-masscom-server.command`를 더블클릭해도 됩니다. 다른 팀원의 컴퓨터에는 SSH 개인키를 복사해 주지 않았으므로 이 명령이 바로 동작한다고 가정하지 않습니다.

2026-09-26 검증: `ssh -o BatchMode=yes -o ConnectTimeout=5 masscom 'hostname'` 성공. 로컬 `~/.ssh/config`과 전용 개인키는 각각 mode 600이며 `StrictHostKeyChecking yes`를 사용합니다. 서버 호스트키 경고가 뜨면 무시하거나 `known_hosts`를 지우지 말고 운영진과 실제 서버 지문을 비교하세요.

접속 후 셸에서 `exit` 또는 Ctrl+D로 나옵니다. 개인키·비밀번호를 저장소, 이슈, 채팅에 올리지 않습니다. 이 접속은 기존 서버의 관리 셸일 뿐 시연 API 공개나 새 인스턴스 구매를 의미하지 않습니다.
