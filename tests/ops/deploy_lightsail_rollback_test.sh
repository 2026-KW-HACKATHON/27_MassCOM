#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
scratch="$(mktemp -d -t masscom-full-rollback.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT
old_commit="$(printf '1%.0s' {1..40})"
new_commit="$(printf '2%.0s' {1..40})"
old_release="$scratch/opt/masscom/releases/${old_commit:0:12}"
new_release="$scratch/opt/masscom/releases/${new_commit:0:12}"
showcase_caddyfile="$scratch/opt/masscom-showcase/releases/036f31f/infra/lightsail/Caddyfile"
runtime="$scratch/opt/masscom/runtime.env"
temporary="$scratch/new-runtime.env"
mkdir -p "$old_release/infra/lightsail" "$old_release/site/public" \
  "$new_release/infra/lightsail" "$scratch/opt/masscom/web" "$(dirname "$showcase_caddyfile")"
old_release="$(cd "$old_release" && pwd -P)"
new_release="$(cd "$new_release" && pwd -P)"
touch "$old_release/infra/lightsail/compose.yml" "$new_release/infra/lightsail/compose.yml" \
  "$new_release/infra/lightsail/Caddyfile"
printf 'demo-api.masscom.kr { reverse_proxy showcase-api:3000 }\n' >"$showcase_caddyfile"
ln -s "$old_release" "$scratch/opt/masscom/current"
ln -s "$old_release" "$scratch/opt/masscom/web/current"
printf '%s\n' "$old_commit" >"$scratch/opt/masscom/DEPLOYED_COMMIT"
printf '%s\n' "$old_commit" >"$scratch/opt/masscom/web/DEPLOYED_COMMIT"
printf 'OLD_ENV=1\n' >"$runtime"
printf 'NEW_ENV=1\n' >"$temporary"
candidate_release="$scratch/opt/masscom/releases/candidate-${new_commit:0:12}"

awk '/REMOTE_RELEASE_PREFLIGHT/ { if (found) exit; found=1; next } found { print }' \
  "$repo_root/scripts/deploy-lightsail.sh" >"$scratch/preflight.sh"
[[ -s "$scratch/preflight.sh" ]] || { echo 'missing remote release preflight' >&2; exit 1; }
run_preflight_case() {
  local images="$1"
  status=0
  out="$({
    sudo() { "$@"; }
    docker() {
      [[ "$*" == image\ ls* ]] || return 1
      printf '%s\n' "$images"
    }
    source "$scratch/preflight.sh" "$candidate_release" "${new_commit:0:12}"
  } 2>&1)" || status=$?
}
run_preflight_case ''
[[ "$status" == 0 ]]
mkdir -p "$candidate_release"
run_preflight_case ''
[[ "$status" != 0 ]] || { echo 'existing release path was accepted' >&2; exit 1; }
rmdir "$candidate_release"
run_preflight_case "masscom-api:${new_commit:0:12}"
[[ "$status" != 0 ]] || { echo 'existing API image tag was accepted' >&2; exit 1; }
run_preflight_case "masscom-production-web:${new_commit:0:12}"
[[ "$status" != 0 ]] || { echo 'existing web image tag was accepted' >&2; exit 1; }

awk '/^set -Eeuo pipefail$/ { remote=1 } remote && /^REMOTE$/ { exit } remote { print }' \
  "$repo_root/scripts/deploy-lightsail.sh" |
  sed "s#/opt/masscom#$scratch/opt/masscom#g" >"$scratch/remote.sh"
[[ -s "$scratch/remote.sh" ]]

run_remote_case() {
  local failure="$1"
  status=0
  (
  caddy_mount_source="$showcase_caddyfile"
  site_mount_source="$old_release/site/public"
  showcase_failed=false
  sudo() {
    if [[ "$1" == env ]]; then
      shift
      while [[ "$1" == *=* ]]; do shift; done
    elif [[ "$1" == install && "$2" == -o ]]; then
      shift 5
      command install "$@"
      return
    fi
    "$@"
  }
  docker() {
    printf '%s\n' "$*" >>"$scratch/docker-calls"
    case "$1" in
      image)
        if [[ "$failure" == collision ]]; then echo "masscom-api:${new_commit:0:12}"; fi ;;
      ps)
        case "${*: -1}" in
          *service=api) echo api-id ;;
          *service=production-web) echo web-id ;;
          *service=caddy) echo caddy-id ;;
          *service=postgres) echo postgres-id ;;
        esac ;;
      inspect)
        case "$*" in
          *api-id) echo "masscom-api:${old_commit:0:12}" ;;
          *web-id) echo "masscom-production-web:${old_commit:0:12}" ;;
          *caddy-id)
            if [[ "$*" == *State.Running* ]]; then echo true
            elif [[ "$*" == *NetworkSettings.Networks* ]]; then echo true
            elif [[ "$*" == *Config.Image* ]]; then echo 'caddy:2.10.2-alpine'
            elif [[ "$*" == */etc/caddy/Caddyfile* ]]; then echo "$caddy_mount_source"
            else echo "$site_mount_source"; fi ;;
        esac ;;
      exec)
        if [[ "$*" == *pg_dump* ]]; then printf 'mock archive'
        elif [[ "$*" == *pg_restore* && "$failure" == backup ]]; then return 5
        else cat >/dev/null; fi ;;
      compose)
        if [[ "$*" == *'up -d --no-deps --force-recreate caddy'* ]]; then
          for arg in "$@"; do
            if [[ "$arg" == *caddy-rollback-* ]]; then
              caddy_mount_source="$(awk '/source:/ { source=$2 } /target: \/etc\/caddy\/Caddyfile/ { print source; exit }' "$arg")"
            fi
          done
          site_mount_source="$old_release/site/public"
        elif [[ "$*" == *'up -d --no-deps caddy'* ]]; then
          caddy_mount_source="$new_release/infra/lightsail/Caddyfile"
          site_mount_source="$new_release/site/public"
        fi
        if [[ "$*" == *'run --rm -T migrate'* && "$failure" == migrate ]]; then return 9; fi ;;
    esac
  }
  sleep() { :; }
  curl() {
    printf '%s\n' "$*" >>"$scratch/curl-calls"
    if [[ "$failure" == transient_showcase && "$*" == *https://demo-api.masscom.kr/health* &&
          "$showcase_failed" == false ]]; then
      showcase_failed=true
      return 22
    fi
    if [[ "$failure" == showcase && "$*" == *https://demo-api.masscom.kr/health* &&
          "$caddy_mount_source" == "$new_release/infra/lightsail/Caddyfile" ]]; then return 22; fi
  }
  source "$scratch/remote.sh" "$new_release" "$runtime" "$temporary" \
    "${new_commit:0:12}" "$new_commit" "$old_commit"
  ) >"$scratch/out" 2>&1 || status=$?
  out="$(<"$scratch/out")"
}
run_remote_case migrate
[[ "$status" == 9 ]] || {
  echo "expected migration failure, got $status: $out" >&2
  sed -n '1,80p' "$scratch/docker-calls" >&2
  exit 1
}
grep -q 'DB_MIGRATION_MANUAL_RECOVERY_REQUIRED' <<<"$out"
grep -q 'FULL_DEPLOY_REVERTED' <<<"$out"
grep -qx 'OLD_ENV=1' "$runtime"
grep -qx "$old_commit" "$scratch/opt/masscom/DEPLOYED_COMMIT"
grep -qx "$old_commit" "$scratch/opt/masscom/web/DEPLOYED_COMMIT"
[[ "$(readlink "$scratch/opt/masscom/current")" == "$old_release" ]]
[[ "$(readlink "$scratch/opt/masscom/web/current")" == "$old_release" ]]
grep -q "$old_release/infra/lightsail/compose.yml up -d --no-deps --force-recreate.* api production-web" \
  "$scratch/docker-calls"
grep -q "$new_release/infra/lightsail/compose.yml -f .* up -d --no-deps --force-recreate caddy" \
  "$scratch/docker-calls"
rollback_override="$(find "$scratch/opt/masscom/backups" -name 'caddy-rollback*' -print -quit)"
[[ -n "$rollback_override" ]]
grep -q "source: $old_release/site/public" "$rollback_override"
grep -q 'source: .*caddyfile-before-' "$rollback_override"
caddyfile_backup="$(find "$scratch/opt/masscom/backups" -name 'caddyfile-before-*' -print -quit)"
cmp "$showcase_caddyfile" "$caddyfile_backup"
grep -q 'masscom_showcase_edge' "$scratch/docker-calls"
grep -q 'https://demo-api.masscom.kr/health' "$scratch/curl-calls"
[[ "$(find "$scratch/opt/masscom/backups" -name '*.dump.*' | wc -l | tr -d ' ')" == 1 ]]
printf 'NEW_ENV=1\n' >"$temporary"
: >"$scratch/docker-calls"
run_remote_case backup
[[ "$status" == 5 ]] || { echo "expected backup validation failure, got $status: $out" >&2; exit 1; }
! grep -q 'build api production-web\|run --rm -T migrate' "$scratch/docker-calls"
grep -qx 'OLD_ENV=1' "$runtime"
printf 'NEW_ENV=1\n' >"$temporary"
: >"$scratch/docker-calls"
run_remote_case collision
[[ "$status" == 1 ]] || { echo "existing tag after upload was accepted: $out" >&2; exit 1; }
grep -q 'IMAGE_TAG_ALREADY_EXISTS' <<<"$out"
! grep -q 'build api production-web\|run --rm -T migrate' "$scratch/docker-calls"
grep -qx 'OLD_ENV=1' "$runtime"
printf 'NEW_ENV=1\n' >"$temporary"
: >"$scratch/docker-calls"
run_remote_case showcase
[[ "$status" == 1 ]] || { echo "expected post-Caddy showcase failure, got $status: $out" >&2; exit 1; }
grep -q 'FULL_DEPLOY_REVERTED' <<<"$out"
grep -q 'source: .*caddyfile-before-' "$rollback_override"
grep -qx 'OLD_ENV=1' "$runtime"
grep -q 'https://demo-api.masscom.kr/health' "$scratch/curl-calls"
printf 'NEW_ENV=1\n' >"$temporary"
: >"$scratch/docker-calls"
run_remote_case transient_showcase
[[ "$status" == 0 ]] || { echo "transient showcase failure did not recover: $out" >&2; exit 1; }
grep -qx "$new_commit" "$scratch/opt/masscom/DEPLOYED_COMMIT"
grep -qx "$new_commit" "$scratch/opt/masscom/web/DEPLOYED_COMMIT"
[[ "$(readlink "$scratch/opt/masscom/current")" == "$new_release" ]]
echo 'Lightsail full rollback mock passed'
