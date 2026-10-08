#!/usr/bin/env bash
# MassCOM 운영 일일 DB 백업 작업(Issue #412). 서버의 systemd timer가 하루 한 번 실행한다. 배포 때만 남던 백업(최대 공백 약 65시간)을 매일로 줄인다.
#   0) 정리 작업과 공유하는 잠금을 잡는다: 백업 폴더 자체를 읽기로 열어 그 위에 flock을 건다(잠금 파일이 없다). 정리 작업도 같은 폴더에 걸므로 백업이 쓰는 동안
#      정리가, 정리가 도는 동안 백업이 겹치지 않는다. 최대 20분(1200초) 기다리고, 못 잡으면 BACKUP_LOCK_TIMEOUT(유닛 제한 30분보다 짧아 다음 재시도가 가능하다).
#   1) 실행 중인 Postgres 컨테이너가 연결을 받을 때까지 기다리고(pg_isready), 직전 일일 백업 크기의 2배 이상 디스크가 남았는지 본다.
#   2) 컨테이너 안에서 pg_dump(custom 형식)로 `daily-<UTC 시각>.dump.part`에 받는다.
#   3) 컨테이너의 `pg_restore -f /dev/null`로 아카이브를 끝까지 읽는다(목차와 모든 데이터 블록을 풀어 보므로 깨진·잘린 덤프는 여기서 걸린다).
#      이것은 "읽을 수 있다"는 확인이지 "복원된다"는 보증이 아니다: 실제 복원은 scripts/db-restore-drill.sh --restore-only로 따로 시험한다.
#   4) sha256 파일(`daily-<UTC 시각>.dump.sha256`)을 쓰고, 마지막에 `.part`를 `daily-<UTC 시각>.dump`로 한 번에 바꾼다(mv, 같은 폴더라 원자적).
#   5) 새 파일이 직전 일일 백업(새로 만들기 전의 가장 최근 `daily-*.dump`)의 50% 미만이면 두 파일을 모두 그대로 두고(지우지 않는다) BACKUP_SIZE_DROP을 stderr에 쓰고
#      종료 코드 3으로 끝낸다: 데이터가 갑자기 빠진 백업이 조용히 성공으로 보이지 않게 한다. 유닛은 RestartPreventExitStatus=3이라 다시 시도하지 않는다
#      (다시 받으면 방금의 작은 파일과 비교되어 통과하고 실패가 가려진다). 첫 실행처럼 직전 백업이 없으면 건너뛴다.
# 완성된 `daily-*.dump`만 백업이다. 실패하면 `.part`를 지우고 종료 코드 1로 알린다(유닛은 10분 뒤 두 번까지 다시 시도한다). 이름이 `*.dump`·`*.dump.*`라서
# masscom-retention.sh가 30일 뒤 함께 지운다(가장 최근 일일 백업 3개와 그 sha256은 나이와 상관없이 남긴다). 같은 디스크의 백업이라 서버를 잃으면 함께
# 사라진다: 서버 밖 사본은 소유자 결정 사항이다.
# 출력은 바이트 수와 고정 문구뿐이다(파일 이름·DB 내용을 출력하지 않는다). 소유자만 읽을 수 있다(umask 077). 이미 있는 파일은 `>`로 덮어쓰지 않는다(noclobber).
#
# 아래 MASSCOM_* 재정의는 저장소 시험이 가짜 docker와 임시 폴더로 이 스크립트를 실행하려고 남겨 둔 것이다. 시험이 MASSCOM_BACKUP_TEST=1을
# 명시할 때만 받아들이고, 서버(systemd)에서는 환경에 무엇이 있든 아래 기본값만 쓴다.
set -uo pipefail
set -o noclobber
umask 077

project='masscom'
service='postgres'
db_user='masscom'
db_name='masscom'
backup_dir='/opt/masscom/backups'
lock_wait_seconds=1200
ready_tries=12
ready_wait_seconds=5
min_free_factor=2
docker_bin=docker
df_bin=df
if [[ "${MASSCOM_BACKUP_TEST:-}" == 1 ]]; then
  project="${MASSCOM_COMPOSE_PROJECT:-$project}"
  service="${MASSCOM_POSTGRES_SERVICE:-$service}"
  db_user="${MASSCOM_DB_USER:-$db_user}"
  db_name="${MASSCOM_DB_NAME:-$db_name}"
  backup_dir="${MASSCOM_BACKUP_DIR:-$backup_dir}"
  lock_wait_seconds="${MASSCOM_LOCK_WAIT:-$lock_wait_seconds}"
  ready_tries="${MASSCOM_READY_TRIES:-$ready_tries}"
  ready_wait_seconds="${MASSCOM_READY_WAIT:-$ready_wait_seconds}"
  docker_bin="${MASSCOM_DOCKER:-$docker_bin}"
  df_bin="${MASSCOM_DF:-$df_bin}"
fi

if [[ ! -d "$backup_dir" || -L "$backup_dir" ]]; then echo 'BACKUP_DIR_MISSING' >&2; exit 1; fi

# 0) 정리 작업과 공유하는 잠금: 백업 폴더 자체에 건다(읽기로 열기만 하므로 잠금 파일을 둘 쓰기 가능한 곳이 필요 없다). 프로세스가 끝나면 풀린다.
if ! exec 9<"$backup_dir" || ! flock -w "$lock_wait_seconds" 9; then
  echo 'BACKUP_LOCK_TIMEOUT' >&2
  exit 1
fi

container="$("$docker_bin" ps -q \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=$service" \
  --filter 'label=com.docker.compose.oneoff=False' 2>/dev/null)" || container=''
if [[ -z "$container" || "$container" == *$'\n'* ]]; then
  # 컨테이너가 없거나 둘 이상이면 어느 DB인지 모르므로 받지 않는다.
  echo 'BACKUP_POSTGRES_CONTAINER_NOT_FOUND_OR_AMBIGUOUS' >&2
  exit 1
fi

# 1) 연결을 받을 때까지 기다린다(부팅 직후나 재시작 중이면 몇 번 다시 본다).
ready=false
attempt=1
while (( attempt <= ready_tries )); do
  if "$docker_bin" exec "$container" pg_isready -q -U "$db_user" -d "$db_name" </dev/null; then ready=true; break; fi
  if (( attempt < ready_tries )); then sleep "$ready_wait_seconds"; fi
  attempt=$((attempt + 1))
done
if [[ "$ready" != true ]]; then echo 'BACKUP_POSTGRES_NOT_READY' >&2; exit 1; fi

# 디스크: 직전 일일 백업(이름이 시각순이라 마지막 것) 크기의 2배가 남아 있어야 한다. 첫 실행처럼 직전 백업이 없으면 건너뛴다.
last_daily=''
for candidate in "$backup_dir"/daily-*.dump; do
  if [[ -f "$candidate" && ! -L "$candidate" ]]; then last_daily="$candidate"; fi
done
if [[ -n "$last_daily" ]]; then
  last_size="$(wc -c <"$last_daily" | tr -d ' ')"
  free_kb="$("$df_bin" -Pk "$backup_dir" 2>/dev/null | awk 'NR == 2 { print $4 }')"
  if ! [[ "$free_kb" =~ ^[0-9]+$ && "$last_size" =~ ^[0-9]+$ ]]; then echo 'BACKUP_DISK_CHECK_FAILED' >&2; exit 1; fi
  if (( free_kb * 1024 < last_size * min_free_factor )); then echo 'BACKUP_DISK_SPACE_LOW' >&2; exit 1; fi
fi

final="$backup_dir/daily-$(date -u +%Y%m%dT%H%M%SZ).dump"
part="$final.part"
if [[ -e "$final" || -e "$part" || -e "$final.sha256" ]]; then echo 'BACKUP_TARGET_EXISTS' >&2; exit 1; fi
cleanup() { rm -f "$part" "$final.sha256"; }  # 끝까지 가지 못한 실행은 절반짜리 파일을 남기지 않는다(성공하면 sha256은 이미 짝이 맞는다).
trap cleanup EXIT

# 2) 덤프 --------------------------------------------------------------------------------------------------------------
if ! "$docker_bin" exec "$container" pg_dump --format=custom --no-owner -U "$db_user" -d "$db_name" </dev/null >"$part"; then
  echo 'BACKUP_DUMP_FAILED' >&2
  exit 1
fi
[[ -s "$part" ]] || { echo 'BACKUP_DUMP_EMPTY' >&2; exit 1; }

# 3) 아카이브를 끝까지 읽는다 --------------------------------------------------------------------------------------------
if ! "$docker_bin" exec -i "$container" pg_restore -f /dev/null <"$part" >/dev/null; then
  echo 'BACKUP_VERIFY_FAILED' >&2
  exit 1
fi

# 4) sha256 파일을 쓰고 이름을 바꾼다 -----------------------------------------------------------------------------------
if command -v sha256sum >/dev/null 2>&1; then hash="$(sha256sum <"$part")"; else hash="$(shasum -a 256 <"$part")"; fi
hash="${hash%% *}"
[[ "$hash" =~ ^[0-9a-f]{64}$ ]] || { echo 'BACKUP_CHECKSUM_FAILED' >&2; exit 1; }
# `sha256sum -c`가 백업 폴더에서 그대로 읽을 수 있게 최종 파일 이름을 적는다.
printf '%s  %s\n' "$hash" "${final##*/}" >"$final.sha256" || { echo 'BACKUP_CHECKSUM_FAILED' >&2; exit 1; }
mv "$part" "$final" || { echo 'BACKUP_RENAME_FAILED' >&2; exit 1; }
trap - EXIT
new_size="$(wc -c <"$final" | tr -d ' ')"
# 5) 크기 급감: 직전 백업의 50% 미만(새 크기 x 2 < 직전 크기)이면 파일은 둘 다 두고 눈에 띄게 실패한다. 정확히 50%는 통과한다.
if [[ -n "$last_daily" ]] && (( new_size * 2 < last_size )); then
  printf 'BACKUP_SIZE_DROP\t%s\t%s\n' "$new_size" "$last_size" >&2
  exit 3
fi
echo "BACKUP_OK	$new_size"
