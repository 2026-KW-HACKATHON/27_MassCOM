#!/usr/bin/env bash
# 시연 호스트의 보관 기간 정리 작업 설치 스크립트(Issue #253). 시연에는 배포 스크립트가 없으므로 서버에서 소유자가 실행한다.
#   설치:  sudo bash <이 폴더>/install.sh
#   제거:  sudo bash <이 폴더>/install.sh --uninstall
#   확인:  sudo bash <이 폴더>/install.sh --verify   (읽기 전용: timer가 켜져 있고 스크립트·유닛이 이 폴더와 같은지 본다)
# 하는 일: 정리 스크립트를 /usr/local/sbin에, systemd 유닛을 /etc/systemd/system에 복사하고 timer를 켠다.
# 여러 번 실행해도 같은 결과다(멱등). 시연 API를 새 릴리스로 교체할 때마다 그 릴리스 폴더의 이 스크립트를 다시 실행해 스크립트·유닛을 맞춘다.
set -euo pipefail

name='masscom-showcase-retention'
[[ "$(id -u)" == 0 ]] || { echo 'run as root: sudo bash install.sh' >&2; exit 1; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sbin="/usr/local/sbin/$name"
unit_dir=/etc/systemd/system
backup_dir='/opt/masscom-showcase/backups'

case "${1:-install}" in
  install)
    command -v systemctl >/dev/null || { echo 'systemd is required' >&2; exit 1; }
    # 백업 폴더가 없으면 유닛의 ReadWritePaths가 시작을 막으므로 먼저 만든다(이미 있으면 그대로 둔다).
    install -d -m 0700 -o root -g root "$backup_dir"
    install -m 0755 -o root -g root "$here/masscom-retention.sh" "$sbin"
    install -m 0644 -o root -g root "$here/$name.service" "$unit_dir/$name.service"
    install -m 0644 -o root -g root "$here/$name.timer" "$unit_dir/$name.timer"
    systemctl daemon-reload
    systemctl enable --now "$name.timer"
    systemctl list-timers "$name.timer" --no-pager
    [[ "$(systemctl is-enabled "$name.timer")" == enabled ]] || { echo "$name.timer is not enabled" >&2; exit 1; }
    echo "installed: $name.timer (first run is the next scheduled time; run once now with: sudo systemctl start $name.service)"
    ;;
  --uninstall)
    systemctl disable --now "$name.timer" 2>/dev/null || true
    rm -f "$unit_dir/$name.timer" "$unit_dir/$name.service" "$sbin"
    systemctl daemon-reload
    echo "removed: $name.timer"
    ;;
  --verify)
    [[ "$(systemctl is-enabled "$name.timer" 2>/dev/null)" == enabled ]] || { echo "$name.timer is not enabled" >&2; exit 1; }
    cmp -s "$here/masscom-retention.sh" "$sbin" || { echo "$sbin differs from this release" >&2; exit 1; }
    cmp -s "$here/$name.service" "$unit_dir/$name.service" || { echo "$name.service differs from this release" >&2; exit 1; }
    cmp -s "$here/$name.timer" "$unit_dir/$name.timer" || { echo "$name.timer differs from this release" >&2; exit 1; }
    echo "verified: $name.timer is enabled and matches this release"
    ;;
  *)
    echo 'usage: install.sh [--uninstall|--verify]' >&2
    exit 2
    ;;
esac
