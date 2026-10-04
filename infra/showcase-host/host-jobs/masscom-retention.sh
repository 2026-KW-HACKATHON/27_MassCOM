#!/usr/bin/env bash
# MassCOM 시연 보관 기간 정리·시드 유지 작업(Issue #253·#365, D-059). 서버의 systemd timer가 하루 한 번 실행한다.
#   1) 실행 중인 API 컨테이너 안에서 보관 기간이 지난 세션·삭제 접수·감사 기록을 지운다(retention-command run).
#   2) 같은 시연 API 컨테이너에서 host seed를 실행해 가상 점포 캠페인 종료를 지금부터 30일 뒤까지 늘린다.
#   3) 백업 폴더에서 수정한 지 30일이 지난 DB 백업(`*.dump`·`*.dump.*`)을 지운다.
# 세 단계는 서로 막지 않는다: 한 단계가 실패해도 다음 단계를 하고, 마지막에 실패를 종료 코드 1로 알린다.
# 출력은 개수와 고정 결과 문구뿐이다(시드 단계의 컨테이너 출력·환경값·파일 이름·계정 식별자를 출력하지 않는다).
#
# 지우는 백업은 백업 폴더 바로 아래의 일반 파일 중 이름이 `*.dump` 또는 `*.dump.*`인 것뿐이다. 하위 폴더·심볼릭 링크는 건드리지 않는다.
# 환경 백업(runtime-before-*.env.*)·Caddyfile 백업(caddyfile-before-*·caddy-rollback-*)은 지우지 않는다: 이름이 `*.dump`·`*.dump.*`가 아니고,
# 롤백 뒤 실행 중인 Caddy가 그 파일을 마운트로 물고 있을 수 있어 지우면 다음 배포의 사전 검사가 깨진다.
#
# 아래 MASSCOM_* 재정의는 저장소 시험이 가짜 docker와 임시 폴더로 이 스크립트를 실행하려고 남겨 둔 것이다. 시험이 MASSCOM_RETENTION_TEST=1을
# 명시할 때만 받아들이고, 서버(systemd)에서는 환경에 무엇이 있든 아래 기본값만 쓴다.
set -uo pipefail

project='masscom-showcase'
service='showcase-api'
backup_dir='/opt/masscom-showcase/backups'
retention_days=30
docker_bin=docker
if [[ "${MASSCOM_RETENTION_TEST:-}" == 1 ]]; then
  project="${MASSCOM_COMPOSE_PROJECT:-$project}"
  service="${MASSCOM_API_SERVICE:-$service}"
  backup_dir="${MASSCOM_BACKUP_DIR:-$backup_dir}"
  retention_days="${MASSCOM_BACKUP_RETENTION_DAYS:-$retention_days}"
  docker_bin="${MASSCOM_DOCKER:-$docker_bin}"
fi

[[ "$retention_days" =~ ^[1-9][0-9]*$ ]] || { echo 'RETENTION_BACKUP_DAYS_INVALID' >&2; exit 2; }
status=0

# 1) DB 기록 정리 -----------------------------------------------------------------------------------------------------
container="$("$docker_bin" ps -q \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=$service" \
  --filter 'label=com.docker.compose.oneoff=False' 2>/dev/null)" || container=''
if [[ -n "$container" && "$container" != *$'\n'* ]]; then
  # 정리 명령의 출력(지운 개수)은 전처럼 그대로 남긴다.
  if ! "$docker_bin" exec "$container" node dist/postgres/retention-command.js run </dev/null; then
    echo 'RETENTION_DB_STEP_FAILED' >&2
    status=1
  fi

  # 2) 시연 시드 유지: 종료 0과 정확한 완료 줄을 모두 확인하고 컨테이너 출력은 공개하지 않는다.
  if seed_output="$("$docker_bin" exec "$container" node dist/showcase/host-seed-command.js </dev/null 2>/dev/null)" \
      && grep -Fxq 'SHOWCASE_HOST_SEEDED' <<<"$seed_output"; then
    echo 'SHOWCASE_SEED_STEP_SUCCEEDED'
  else
    echo 'SHOWCASE_SEED_STEP_FAILED' >&2
    status=1
  fi
else
  # 컨테이너가 없거나 둘 이상이면 어느 DB인지 모르므로 실행하지 않는다.
  echo 'RETENTION_API_CONTAINER_NOT_FOUND_OR_AMBIGUOUS' >&2
  echo 'SHOWCASE_SEED_STEP_SKIPPED' >&2
  status=1
fi

# 3) 30일 지난 DB 백업 삭제 -------------------------------------------------------------------------------------------
if [[ -d "$backup_dir" && ! -L "$backup_dir" ]]; then
  # 찾는 것과 지우는 것을 한 명령으로 한다(find가 고른 이름을 나중에 rm에 넘기지 않아 그 사이 바뀐 경로를 지울 수 없다).
  # 지운 파일마다 NUL 하나만 세어 개수만 얻고, pipefail이라 find가 실패하면 실패로 남는다.
  if deleted="$(find "$backup_dir" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.dump.*' \) \
      -mmin "+$((retention_days * 1440))" -delete -print0 2>/dev/null | tr -cd '\0' | wc -c)"; then
    echo "BACKUPS_DELETED	$((deleted))"
  else
    echo 'RETENTION_BACKUP_DELETE_FAILED' >&2
    status=1
  fi
else
  echo 'RETENTION_BACKUP_DIR_MISSING' >&2
  status=1
fi

exit "$status"
