# Wolgye Mascot NFT Contract

Phase 3의 첫 양도 제한 NFT 계약입니다. Base Sepolia 배포 전 로컬 Anvil에서 C01~C04를 검증합니다.

## 고정된 도구

- Solidity `0.8.24`
- Foundry `1.8.3` Docker image digest 고정
- OpenZeppelin Contracts `5.7.0`
- forge-std `1.16.2`

호스트에 Foundry가 있으면 이를 사용하고, 없으면 `scripts/forge.sh`가 고정 Docker image를 사용합니다.

```bash
./scripts/forge.sh --version
./scripts/forge.sh fmt --check
./scripts/forge.sh build
./scripts/forge.sh test -vvv
./scripts/forge.sh lint
```

## 로컬 Anvil

Anvil 기본 공개 test account를 unlocked RPC로 사용하므로 private key·mnemonic을 명령이나 증거에 기록하지 않습니다.

```bash
./scripts/anvil.sh --chain-id 31337 --silent
./scripts/forge.sh script script/DeployLocal.s.sol:DeployLocal \
  --rpc-url http://host.docker.internal:8545 \
  --broadcast --unlocked \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

Anvil chain ID `31337`의 결과는 Base Sepolia `84532` 배포 증거가 아닙니다. Base Sepolia는 전용 시험 배포자와 gas가 준비된 뒤 별도 검증합니다.

## 계약 경계

- `DEFAULT_ADMIN_ROLE`: 시리즈 생성·활성화, 역할 관리, 중지 해제
- `MINTER_ROLE`: 활성 시리즈 발행
- `PAUSER_ROLE`: 신규 발행 긴급 중지
- `rewardKey` 한 번만 사용, 디자인별 누적 상한 유지
- 모든 NFT는 ERC-5192 `locked=true`
- 승인·일반 전송·소각·교환·관리자 회수·업그레이드 프록시 없음
