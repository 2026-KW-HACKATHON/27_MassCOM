#!/usr/bin/env bash
# Issue #412: scripts/check-large-files.sh를 임시 git 저장소에서 실행해 경계값(1 MiB·3 MiB), 추가·수정만 보는 범위,
# 예외 목록, 공백·한글 파일 이름, 잘못된 기준을 확인한다. 실제 저장소는 건드리지 않는다.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
check="$repo_root/scripts/check-large-files.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
fail() { echo "check-large-files test failed: $1" >&2; exit 1; }

# 사용자의 git 설정·훅이 시험에 끼지 않게 한다.
export HOME="$scratch/home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
mkdir -p "$HOME"
g() { git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name=tester -c user.email=tester@example.invalid -c init.defaultBranch=main "$@"; }

mib=$((1024 * 1024))
binary() { mkdir -p "$(dirname "$1")"; head -c "$2" /dev/zero >"$1"; }                       # NUL이 있어 git이 바이너리로 본다
text() { mkdir -p "$(dirname "$1")"; head -c "$2" /dev/zero | tr '\0' 'a' >"$1"; }          # 한 줄짜리 텍스트

repo="$scratch/repo"
mkdir -p "$repo/docs/evidence" "$repo/scripts" "$repo/assets"
cd "$repo"
g init -q
printf 'base\n' >README.md
binary assets/existing-big.bin $((4 * mib))                        # 기준에 이미 있는 큰 파일
binary assets/existing-edit.bin $((2 * mib))
binary assets/to-delete.bin $((5 * mib))
g add -A && g commit -q -m base

# run <기대 종료 코드> <라벨> [인자...]: 종료 코드와 표준 오류를 $scratch/err에 남긴다.
run() {
  local want="$1" label="$2" code=0
  shift 2
  bash "$check" "$@" >"$scratch/out" 2>"$scratch/err" || code=$?
  [[ "$code" == "$want" ]] || { cat "$scratch/err" >&2; fail "$label: exit $code, wanted $want"; }
}
commit_all() { g add -A && g commit -q -m "$1"; }
reset_branch() { g checkout -q main && g branch -q -D feature 2>/dev/null || true; g checkout -q -b feature; }

# 1. 작은 변경과 경계값(정확히 3 MiB, 정확히 1 MiB 증거 바이너리, 3 MiB 아래 증거 텍스트)은 통과한다. 기준의 기존 큰 파일은 대상이 아니다.
reset_branch
mkdir -p docs && printf 'small\n' >docs/small.md
binary assets/exact-3mib.bin $((3 * mib))
binary docs/evidence/exact-1mib.png "$mib"
text docs/evidence/record-2mib.json $((2 * mib))
binary assets/binary-2mib.bin $((2 * mib))                          # 증거 폴더 밖 바이너리는 3 MiB까지 된다
commit_all boundaries
run 0 boundaries main
grep -q '추가·수정 파일 5개' "$scratch/out" || fail "boundaries: wrong number of checked files: $(cat "$scratch/out")"

# 2. 3 MiB를 1바이트 넘으면 실패한다(텍스트·바이너리 모두), 이름과 크기를 알려 준다.
reset_branch
text assets/over-3mib.txt $((3 * mib + 1))
commit_all over-3mib-text
run 1 over-3mib-text main
grep -q "assets/over-3mib.txt ($((3 * mib + 1)) 바이트, 3 MiB 초과)" "$scratch/err" || fail "over-3mib-text: offender not named: $(cat "$scratch/err")"
reset_branch
binary assets/over-3mib.bin $((3 * mib + 1))
commit_all over-3mib-binary
run 1 over-3mib-binary main

# 3. docs/evidence 바이너리는 1 MiB를 넘으면 실패하고, 같은 크기의 증거 텍스트(JSON)와 증거 밖 바이너리는 통과한다.
reset_branch
binary docs/evidence/shot.png $((mib + 1))
commit_all evidence-binary
run 1 evidence-binary main
grep -q 'docs/evidence/shot.png' "$scratch/err" && grep -q 'docs/evidence 바이너리 1 MiB 초과' "$scratch/err" || fail "evidence-binary: rule not named: $(cat "$scratch/err")"
reset_branch
text docs/evidence/big-record.json $((mib + 1))
commit_all evidence-text
run 0 evidence-text main
reset_branch
text docs/evidence/over-3mib.json $((3 * mib + 1))
commit_all evidence-text-over-3
run 1 evidence-text-over-3 main

# 4. 수정으로 커진 기존 파일은 실패하고, 삭제와 손대지 않은 기존 큰 파일은 대상이 아니다.
reset_branch
binary assets/existing-edit.bin $((4 * mib))
commit_all grow-existing
run 1 grow-existing main
reset_branch
g rm -q assets/to-delete.bin
mkdir -p docs && printf 'x\n' >docs/other.md
commit_all delete-big
run 0 delete-big main

# 5. 옮긴(이름을 바꾼) 큰 파일은 새 파일로 센다.
reset_branch
mkdir -p moved && g mv assets/existing-big.bin moved/existing-big.bin
commit_all rename-big
run 1 rename-big main

# 6. 공백·한글이 든 경로도 이름 그대로 잡고, 여러 개를 한 번에 센다.
reset_branch
binary "assets/큰 파일 하나.bin" $((3 * mib + 5))
binary "assets/another big.bin" $((3 * mib + 5))
commit_all odd-names
run 1 odd-names main
grep -q '큰 파일 하나.bin' "$scratch/err" && grep -q 'another big.bin' "$scratch/err" && grep -q '큰 파일 2개' "$scratch/err" || fail "odd-names: both offenders were not reported: $(cat "$scratch/err")"

# 7. 예외 목록: 정확히 일치하는 경로만 통과하고, 이유가 없거나 형식이 틀리면 검사 자체가 오류(2)다.
reset_branch
binary assets/allowed.bin $((4 * mib))
binary assets/not-allowed.bin $((4 * mib))
mkdir -p scripts
printf '# 주석과 빈 줄은 무시한다\n\nassets/allowed.bin\t시험용 예외\n' >scripts/large-files-allowlist.txt
commit_all allowlist
run 1 allowlist-partial main
grep -q 'assets/not-allowed.bin' "$scratch/err" && ! grep -q 'assets/allowed.bin' "$scratch/err" || fail "allowlist-partial: wrong file allowed: $(cat "$scratch/err")"
printf 'assets/allowed.bin\tx\nassets/not-allowed.bin\t다른 이유\n' >scripts/large-files-allowlist.txt
commit_all allowlist-both
run 0 allowlist-both main
printf 'assets/allowed.bin\n' >scripts/large-files-allowlist.txt
commit_all allowlist-no-reason
run 2 allowlist-no-reason main
grep -q 'large-files-allowlist.txt:1' "$scratch/err" || fail "allowlist-no-reason: line not named: $(cat "$scratch/err")"
printf 'assets/allowed.bin\t   \n' >scripts/large-files-allowlist.txt
commit_all allowlist-blank-reason
run 2 allowlist-blank-reason main
printf 'assets/*\t글롭은 허용하지 않는다\n' >scripts/large-files-allowlist.txt
commit_all allowlist-glob
run 1 allowlist-glob main

# 7b. 예외 목록의 세 번째 칸(최대 바이트): 그 크기까지만 허용하고, 넘으면 예외여도 실패하며, 양의 정수가 아니면 검사 자체가 오류(2)다.
reset_branch
mkdir -p scripts
binary assets/capped.bin $((4 * mib))
printf 'assets/capped.bin\t상한이 있는 예외\t%s\n' $((4 * mib)) >scripts/large-files-allowlist.txt
commit_all allowlist-cap-equal
run 0 allowlist-cap-equal main
binary assets/capped.bin $((4 * mib + 1))
commit_all allowlist-cap-grown
run 1 allowlist-cap-grown main
grep -q "assets/capped.bin ($((4 * mib + 1)) 바이트, 예외 목록의 허용 크기 $((4 * mib)) 바이트 초과)" "$scratch/err" || fail "allowlist-cap-grown: cap not named: $(cat "$scratch/err")"
printf 'assets/capped.bin\t상한을 올린 예외\t%s\n' $((4 * mib + 1)) >scripts/large-files-allowlist.txt
commit_all allowlist-cap-raised
run 0 allowlist-cap-raised main
printf 'assets/capped.bin\t없는 칸은 제한 없음\n' >scripts/large-files-allowlist.txt
commit_all allowlist-cap-absent
run 0 allowlist-cap-absent main
for bad_cap in 0 -5 12abc '' ' 7' '1\t2'; do
  printf 'assets/capped.bin\t이유\t%b\n' "$bad_cap" >scripts/large-files-allowlist.txt
  commit_all "allowlist-bad-cap-$bad_cap"
  run 2 "allowlist-bad-cap-$bad_cap" main
  grep -q 'large-files-allowlist.txt:1.*세 번째 칸' "$scratch/err" || fail "allowlist-bad-cap '$bad_cap': line not named: $(cat "$scratch/err")"
done

# 8. 기준 참조가 없거나 인자가 틀리면 오류(2)다. 빈 트리를 기준으로 하면 모든 파일이 새 파일이다(CI의 첫 push 대비).
run 2 missing-base no-such-ref
run 2 no-args
run 2 two-args main main
empty_tree="$(g hash-object -t tree /dev/null)"
reset_branch
run 1 empty-tree-base "$empty_tree"

# 9. 저장소 밖에서는 오류(2)다.
( cd "$scratch" && code=0 && bash "$check" main >/dev/null 2>&1 || code=$?; [[ "$code" == 2 ]] ) || fail 'running outside a git repository did not exit 2'

# 10. 운영 저장소의 예외 목록 형식과 연결: 목록은 파싱되고, tools/gate.sh와 CI가 이 검사를 부른다.
cd "$repo_root"
awk -F'\t' '!/^#/ && NF > 0 && ($2 == "" || NF < 2 || NF > 3 || (NF == 3 && $3 !~ /^[1-9][0-9]*$/)) { bad = 1 } END { exit bad }' scripts/large-files-allowlist.txt || fail 'scripts/large-files-allowlist.txt has a line that is not path<TAB>reason[<TAB>max bytes]'
# 저장소 예외마다 최대 바이트가 있고 지금 크기 이상이며 +10%를 넘지 않는다(조용히 커지는 것을 막는 상한이 의미 있게 남도록).
while IFS=$'\t' read -r allow_path allow_reason allow_cap; do
  [[ -n "$allow_path" && "$allow_path" != '#'* ]] || continue
  [[ -n "$allow_cap" ]] || fail "$allow_path has no max bytes column"
  allow_size="$(wc -c <"$allow_path" | tr -d ' ')"
  (( allow_cap >= allow_size && allow_cap * 100 <= allow_size * 111 )) || fail "$allow_path: max bytes $allow_cap is not within 0-10% above the current size $allow_size"
done <scripts/large-files-allowlist.txt
grep -q 'bash scripts/check-large-files.sh origin/main' tools/gate.sh || fail 'tools/gate.sh does not run the large-file guard against origin/main'
grep -q 'scripts/check-large-files.sh' .github/workflows/ci.yml || fail 'ci.yml does not run the large-file guard'

echo 'check-large-files tests passed'
