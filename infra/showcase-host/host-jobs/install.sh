#!/usr/bin/env bash
# 시연 호스트의 보관 기간 정리 작업과 일일 백업 작업(Issue #412)의 설치 스크립트(Issue #253). 시연에는 배포 스크립트가 없으므로 서버에서 소유자가 실행한다.
#   설치:  sudo bash <이 폴더>/install.sh [masscom-showcase-backup]
#   제거:  sudo bash <이 폴더>/install.sh [masscom-showcase-backup] --uninstall
#   확인:  sudo bash <이 폴더>/install.sh [masscom-showcase-backup] --verify   (읽기 전용: timer가 켜져 있고 스크립트·유닛이 이 폴더와 같고 한 번 실행했으며 마지막 실행 결과가 success인지 본다)
# 하는 일: 정리 스크립트를 /usr/local/sbin에, systemd 유닛을 /etc/systemd/system에 복사하고 timer를 켠다.
# 여러 번 실행해도 같은 결과다(멱등). 시연 API를 새 릴리스로 교체할 때마다 그 릴리스 폴더의 이 스크립트를 다시 실행해 스크립트·유닛을 맞춘다.
set -euo pipefail

name='masscom-showcase-retention'
backup_name='masscom-showcase-backup'
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sbin_dir=/usr/local/sbin
unit_dir=/etc/systemd/system
systemctl_bin=systemctl
# 아래 재정의는 저장소 시험이 가짜 systemctl과 임시 폴더로 --verify의 실패 경로를 확인하려고 남겨 둔 것이다. MASSCOM_RETENTION_TEST=1(이름은 정리 작업에서 왔지만 두 작업 공통의 시험 표시다)을 명시할 때만 받고,
# 그때도 root 확인을 건너뛰는 것은 읽기 전용인 --verify뿐이다. 서버에서는 환경에 무엇이 있든 고정된 경로와 systemctl만 쓴다.
test_mode=false
if [[ "${MASSCOM_RETENTION_TEST:-}" == 1 ]]; then
  test_mode=true
  sbin_dir="${MASSCOM_SBIN_DIR:-$sbin_dir}"
  unit_dir="${MASSCOM_UNIT_DIR:-$unit_dir}"
  systemctl_bin="${MASSCOM_SYSTEMCTL:-$systemctl_bin}"
fi
# 인자: 작업 이름(일일 백업 작업을 고를 때만)과 동작(install|--uninstall|--verify)을 순서와 상관없이 받는다. 이름이 없으면 정리 작업이다:
# 운영 배포 스크립트가 인자 없이 부르므로 이 동작은 그대로여야 한다. 모르는 인자나 같은 종류의 중복은 아무것도 하지 않고 usage(2)로 멈춘다
# (`--uninstall masscom-backup`이 정리 작업을 지우는 일이 없도록). 스크립트 원본은 폴더의 masscom-<종류>.sh(retention|backup)다.
usage() { echo "usage: install.sh [$backup_name] [install|--uninstall|--verify]" >&2; exit 2; }
default_name="$name"
requested_name=''
action=''
for arg in "$@"; do
  case "$arg" in
    "$default_name"|"$backup_name") [[ -z "$requested_name" ]] || usage; requested_name="$arg" ;;
    install|--uninstall|--verify) [[ -z "$action" ]] || usage; action="$arg" ;;
    *) usage ;;
  esac
done
name="${requested_name:-$default_name}"
action="${action:-install}"
kind="${name##*-}"
job_src="$here/masscom-$kind.sh"
[[ "$(id -u)" == 0 || ( "$test_mode" == true && "$action" == --verify ) ]] || { echo 'run as root: sudo bash install.sh' >&2; exit 1; }
sbin="$sbin_dir/$name"
backup_dir='/opt/masscom-showcase/backups'

case "$action" in
  install)
    command -v "$systemctl_bin" >/dev/null || { echo 'systemd is required' >&2; exit 1; }
    # 백업 폴더가 없으면 유닛의 ReadWritePaths가 시작을 막으므로 먼저 만든다(이미 있으면 그대로 둔다).
    install -d -m 0700 -o root -g root "$backup_dir"
    install -m 0755 -o root -g root "$job_src" "$sbin"
    install -m 0644 -o root -g root "$here/$name.service" "$unit_dir/$name.service"
    install -m 0644 -o root -g root "$here/$name.timer" "$unit_dir/$name.timer"
    "$systemctl_bin" daemon-reload
    "$systemctl_bin" enable --now "$name.timer"
    "$systemctl_bin" list-timers "$name.timer" --no-pager
    [[ "$("$systemctl_bin" is-enabled "$name.timer")" == enabled ]] || { echo "$name.timer is not enabled" >&2; exit 1; }
    echo "installed: $name.timer (first run is the next scheduled time; run once now with: sudo systemctl start $name.service)"
    ;;
  --uninstall)
    "$systemctl_bin" disable --now "$name.timer" 2>/dev/null || true
    rm -f "$unit_dir/$name.timer" "$unit_dir/$name.service" "$sbin"
    "$systemctl_bin" daemon-reload
    echo "removed: $name.timer"
    ;;
  --verify)
    [[ "$("$systemctl_bin" is-enabled "$name.timer" 2>/dev/null)" == enabled ]] || { echo "$name.timer is not enabled" >&2; exit 1; }
    cmp -s "$job_src" "$sbin" || { echo "$sbin differs from this release" >&2; exit 1; }
    # 시연 캠페인의 자동 연장을 빠뜨린 설치를 검증 완료로 세지 않는다(정리 작업만 시드 단계를 가진다).
    if [[ "$kind" == retention ]]; then
      grep -Fq 'node dist/showcase/host-seed-command.js' "$sbin" \
        && grep -Fq "grep -Fxq 'SHOWCASE_HOST_SEEDED'" "$sbin" \
        || { echo 'installed showcase seed step is missing' >&2; exit 1; }
    fi
    cmp -s "$here/$name.service" "$unit_dir/$name.service" || { echo "$name.service differs from this release" >&2; exit 1; }
    cmp -s "$here/$name.timer" "$unit_dir/$name.timer" || { echo "$name.timer differs from this release" >&2; exit 1; }
    # 마지막 실행 결과(systemd의 Result)도 보고한다. 한 번도 실행하지 않은 작업은 Result가 success로 보이므로 마지막 실행 시각(ExecMainStartTimestamp)이
    # 비어 있으면 "실행한 적 없음"으로 실패시킨다: 설치만 하고 돌려 보지 않은 작업을 "확인됨"으로 세지 않는다. (설치 → `systemctl start <이름>.service` → --verify)
    result="$("$systemctl_bin" show -p Result --value "$name.service")"
    started="$("$systemctl_bin" show -p ExecMainStartTimestamp --value "$name.service")"
    echo "last run result: $result"
    [[ "$result" == success ]] || { echo "$name.service last run did not succeed: $result" >&2; exit 1; }
    [[ -n "$started" ]] || { echo "$name.service has not run yet: run 'systemctl start $name.service' once, then verify again" >&2; exit 1; }
    echo "verified: $name.timer is enabled and matches this release"
    ;;
esac
