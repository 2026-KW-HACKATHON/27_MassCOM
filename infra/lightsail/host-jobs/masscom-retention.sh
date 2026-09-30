#!/usr/bin/env bash
# MassCOM 운영 보관 기간 정리 작업(Issue #253, D-056). 서버의 systemd timer가 하루 한 번 실행한다.
#   1) 실행 중인 API 컨테이너 안에서 보관 기간이 지난 세션·삭제 접수·감사 기록을 지운다(retention-command run).
#   2) 백업 폴더에서 수정한 지 30일이 지난 DB 백업(`*.dump`·`*.dump.*`)을 지운다.
# 두 단계는 서로 막지 않는다: 한 단계가 실패해도 다음 단계를 하고, 마지막에 실패를 종료 코드 1로 알린다.
# 출력은 개수와 고정 문구뿐이다(파일 이름·계정 식별자를 출력하지 않는다).
#
# 지우는 백업은 백업 폴더 바로 아래의 일반 파일 중 이름이 `*.dump` 또는 `*.dump.*`인 것뿐이다. 하위 폴더·심볼릭 링크는 건드리지 않는다.
# 환경 백업(runtime-before-*.env.*)·Caddyfile 백업(caddyfile-before-*·caddy-rollback-*)은 지우지 않는다: 이름이 `*.dump`·`*.dump.*`가 아니고,
# 롤백 뒤 실행 중인 Caddy가 그 파일을 마운트로 물고 있을 수 있어 지우면 다음 배포의 사전 검사가 깨진다.
#
# 아래 MASSCOM_* 값은 저장소 시험이 가짜 docker와 임시 폴더로 이 스크립트를 실행하려고 남겨 둔 것이며 서버에서는 기본값을 쓴다.
set -uo pipefail

project="${MASSCOM_COMPOSE_PROJECT:-masscom}"
service="${MASSCOM_API_SERVICE:-api}"
backup_dir="${MASSCOM_BACKUP_DIR:-/opt/masscom/backups}"
retention_days="${MASSCOM_BACKUP_RETENTION_DAYS:-30}"
docker_bin="${MASSCOM_DOCKER:-docker}"

[[ "$retention_days" =~ ^[1-9][0-9]*$ ]] || { echo 'RETENTION_BACKUP_DAYS_INVALID' >&2; exit 2; }
status=0

# 1) DB 기록 정리 -----------------------------------------------------------------------------------------------------
container="$("$docker_bin" ps -q \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=$service" 2>/dev/null)" || container=''
if [[ -n "$container" && "$container" != *$'\n'* ]]; then
  if ! "$docker_bin" exec "$container" node dist/postgres/retention-command.js run; then
    echo 'RETENTION_DB_STEP_FAILED' >&2
    status=1
  fi
else
  # 컨테이너가 없거나 둘 이상이면 어느 DB인지 모르므로 실행하지 않는다.
  echo 'RETENTION_API_CONTAINER_NOT_FOUND_OR_AMBIGUOUS' >&2
  status=1
fi

# 2) 30일 지난 DB 백업 삭제 -------------------------------------------------------------------------------------------
if [[ -d "$backup_dir" && ! -L "$backup_dir" ]]; then
  deleted=0
  while IFS= read -r -d '' backup; do
    if rm -f -- "$backup"; then deleted=$((deleted + 1)); else status=1; fi
  done < <(find "$backup_dir" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.dump.*' \) -mmin "+$((retention_days * 1440))" -print0)
  echo "BACKUPS_DELETED	$deleted"
else
  echo 'RETENTION_BACKUP_DIR_MISSING' >&2
  status=1
fi

exit "$status"
