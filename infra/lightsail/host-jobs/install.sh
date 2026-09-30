#!/usr/bin/env bash
# 서버에서 한 번, 사람이 실행하는 설치 스크립트(Issue #253). 배포 스크립트는 이것을 실행하지 않는다.
#   설치:  sudo bash <이 폴더>/install.sh
#   제거:  sudo bash <이 폴더>/install.sh --uninstall
# 하는 일: 정리 스크립트를 /usr/local/sbin에, systemd 유닛을 /etc/systemd/system에 복사하고 timer를 켠다.
# 스크립트를 고치면(새 배포로 이 폴더가 바뀌어도) 자동으로 갱신되지 않으므로 이 스크립트를 다시 실행한다.
set -euo pipefail

name='masscom-retention'
[[ "$(id -u)" == 0 ]] || { echo 'run as root: sudo bash install.sh' >&2; exit 1; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sbin="/usr/local/sbin/$name"
unit_dir=/etc/systemd/system

case "${1:-install}" in
  install)
    command -v systemctl >/dev/null || { echo 'systemd is required' >&2; exit 1; }
    install -m 0755 -o root -g root "$here/masscom-retention.sh" "$sbin"
    install -m 0644 -o root -g root "$here/$name.service" "$unit_dir/$name.service"
    install -m 0644 -o root -g root "$here/$name.timer" "$unit_dir/$name.timer"
    systemctl daemon-reload
    systemctl enable --now "$name.timer"
    systemctl list-timers "$name.timer" --no-pager
    echo "installed: $name.timer (first run is the next scheduled time; run once now with: sudo systemctl start $name.service)"
    ;;
  --uninstall)
    systemctl disable --now "$name.timer" 2>/dev/null || true
    rm -f "$unit_dir/$name.timer" "$unit_dir/$name.service" "$sbin"
    systemctl daemon-reload
    echo "removed: $name.timer"
    ;;
  *)
    echo 'usage: install.sh [--uninstall]' >&2
    exit 2
    ;;
esac
