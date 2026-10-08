#!/usr/bin/env bash
# 큰 파일 가드(Issue #412, x5-ops 8a). 사용법: scripts/check-large-files.sh <base-ref>
# <base-ref>...HEAD에서 추가·수정된 파일만 본다(삭제·변경 없는 기존 파일은 보지 않는다). 아래에 걸리면 종료 1이다.
#   - docs/evidence/** 의 바이너리(git이 바이너리로 보는 파일)가 1 MiB 초과
#   - 어떤 파일이든 3 MiB 초과
# 예외는 scripts/large-files-allowlist.txt에 `경로<TAB>이유[<TAB>최대 바이트]` 한 줄씩 적는다(경로는 정확히 일치해야 하고 이유는 비우지 못한다).
# 세 번째 칸(양의 정수)이 있으면 예외 파일도 그 크기까지만 허용한다: 허용된 큰 파일이 조용히 더 커지는 일을 막는다. 없으면 크기 제한이 없다.
# 관례: 증거 영상·원본 크기 이미지는 저장소가 아니라 GitHub Release(evidence-YYYY-MM-DD-<주제>)에 올리고, 증거 JSON에는 자산 이름과 sha256을 적는다.
# Git LFS와 이력 다시 쓰기는 쓰지 않는다. 종료 코드: 0 통과, 1 크기 초과, 2 사용법·기준 오류.
# bash 3.2(macOS)와 GNU에서 같게 돈다. git만 쓴다(rg·jq 없음).
set -uo pipefail

evidence_binary_limit=$((1024 * 1024))
file_limit=$((3 * 1024 * 1024))

base="${1:-}"
[[ -n "$base" && $# -eq 1 ]] || { echo 'usage: check-large-files.sh <base-ref>' >&2; exit 2; }
root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo 'git 저장소 안에서 실행해야 합니다' >&2; exit 2; }
cd "$root" || exit 2
# 기준은 커밋이거나(PR 기준 커밋·origin/main) 트리(첫 push의 빈 트리)다.
git rev-parse --verify --quiet "$base^{tree}" >/dev/null || { echo "기준 참조를 찾을 수 없습니다: $base (git fetch 후 다시, CI는 fetch-depth: 0 필요)" >&2; exit 2; }
# 병합 기준(...)이 있으면 그 이후 변경만, 없으면(트리 기준) 두 점 비교다. HEAD가 앞서간 main을 되돌린 차이는 이 검사의 대상이 아니다.
if git merge-base "$base" HEAD >/dev/null 2>&1; then range=("$base...HEAD"); else range=("$base" HEAD); fi

allow_file="$root/scripts/large-files-allowlist.txt"
allow_paths=()
allow_max=()
if [[ -f "$allow_file" ]]; then
  line_no=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_no=$((line_no + 1))
    [[ -n "${line//[[:space:]]/}" && "$line" != '#'* ]] || continue
    path="${line%%$'\t'*}"
    rest="${line#*$'\t'}"
    reason="${rest%%$'\t'*}"
    max_bytes=''
    if [[ "$rest" == *$'\t'* ]]; then max_bytes="${rest#*$'\t'}"; fi
    if [[ "$line" != *$'\t'* || -z "$path" || -z "${reason//[[:space:]]/}" ]]; then
      echo "scripts/large-files-allowlist.txt:$line_no: 형식은 '경로<TAB>이유[<TAB>최대 바이트]'이고 이유는 비울 수 없습니다" >&2
      exit 2
    fi
    if [[ "$rest" == *$'\t'* && ! "$max_bytes" =~ ^[1-9][0-9]*$ ]]; then
      echo "scripts/large-files-allowlist.txt:$line_no: 세 번째 칸(최대 바이트)은 양의 정수여야 합니다" >&2
      exit 2
    fi
    allow_paths+=("$path")
    allow_max+=("$max_bytes")
  done <"$allow_file"
fi

failures=0
checked=0
# --numstat -z: `추가\t삭제\t경로\0`, 바이너리는 추가가 `-`다. 이름 바꾸기는 감지하지 않는다(옮긴 큰 파일도 새 파일로 센다).
while IFS= read -r -d '' record; do
  added="${record%%$'\t'*}"
  rest="${record#*$'\t'}"
  path="${rest#*$'\t'}"
  # 서브모듈(gitlink)이나 읽을 수 없는 항목은 파일 크기가 없다.
  [[ "$(git cat-file -t "HEAD:$path" 2>/dev/null)" == blob ]] || continue
  size="$(git cat-file -s "HEAD:$path")"
  checked=$((checked + 1))
  rule=''
  if (( size > file_limit )); then
    rule='3 MiB 초과'
  elif (( size > evidence_binary_limit )) && [[ "$path" == docs/evidence/* && "$added" == - ]]; then
    rule='docs/evidence 바이너리 1 MiB 초과'
  fi
  [[ -n "$rule" ]] || continue
  allow_index=0
  allow_found=''
  while (( allow_index < ${#allow_paths[@]} )); do
    if [[ "${allow_paths[allow_index]}" == "$path" ]]; then allow_found="$allow_index"; break; fi
    allow_index=$((allow_index + 1))
  done
  if [[ -n "$allow_found" ]]; then
    max_bytes="${allow_max[allow_found]}"
    if [[ -z "$max_bytes" ]] || (( size <= max_bytes )); then continue; fi
    echo "큰 파일: $path ($size 바이트, 예외 목록의 허용 크기 $max_bytes 바이트 초과)" >&2
    failures=$((failures + 1))
    continue
  fi
  echo "큰 파일: $path ($size 바이트, $rule)" >&2
  failures=$((failures + 1))
done < <(git diff --numstat --no-renames --diff-filter=AM -z "${range[@]}")

if (( failures > 0 )); then
  echo "큰 파일 $failures개. 증거 영상·원본 이미지는 GitHub Release(evidence-YYYY-MM-DD-<주제>)에 올리고 저장소에는 줄인 사본이나 JSON 기록만 둡니다." >&2
  echo '정말 저장소에 둬야 하면 scripts/large-files-allowlist.txt에 `경로<TAB>이유<TAB>최대 바이트`를 추가하세요.' >&2
  exit 1
fi
echo "큰 파일 검사 통과: 추가·수정 파일 $checked개 (docs/evidence 바이너리 1 MiB, 그 밖 3 MiB 이하)"
