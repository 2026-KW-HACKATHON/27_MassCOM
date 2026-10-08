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

Anvil chain ID `31337`의 결과는 Base Sepolia `84532` 배포 증거가 아닙니다.

## Base Sepolia

배포자는 암호화된 Foundry keystore 계정만 사용합니다. private key를 환경 변수·명령·저장소·증거에 남기지 않으며, 스크립트는 환경에 `PRIVATE_KEY`가 있으면 실행을 거절합니다. keystore 생성과 faucet gas 수령은 계정 소유자가 직접 합니다.

```bash
cast wallet list                                        # 계정이 이미 있으면 새로 만들지 않는다
cast wallet new masscom-base-sepolia                    # 소유자가 직접 실행. 새 시험 전용 키를 암호화 keystore로 저장(숨김 비밀번호 입력, 개인키 미출력)
export BASE_SEPOLIA_ADMIN=0x... BASE_SEPOLIA_MINTER=0x... BASE_SEPOLIA_PAUSER=0x...
./scripts/deploy-base-sepolia.sh masscom-base-sepolia               # 실제 체인 시뮬레이션만, 전송 없음
./scripts/deploy-base-sepolia.sh masscom-base-sepolia --broadcast   # 실제 배포
```

- `cast wallet new`를 **이름 없이** 실행하면 개인키가 화면에 출력되므로 쓰지 않습니다. `cast wallet import <이름> --interactive`는 이미 가진 개인키를 가져올 때만 씁니다(Foundry 1.8.3 `--help`로 확인).
- 공개 주소는 `cast wallet address --account masscom-base-sepolia`로 확인해 faucet에 넣습니다.
- 스크립트는 전송 전에 keystore 계정 존재, RPC chainId 84532, 역할 주소 3개의 형식·상호 구분을 검사하고 키를 만들지 않습니다. `contracts/broadcast/DeployBaseSepolia.s.sol/84532/run-latest.json`이나 커밋된 `docs/evidence/base-sepolia-deployment.json`이 이미 있으면 `--broadcast`를 거절합니다(forge 기록은 gitignore 대상이라 새 clone에서는 사라지므로, 실제 배포 직후 계약 주소·거래 hash·역할 주소·커밋을 이 증거 파일로 커밋합니다). `--account`는 forge 1.8.3에서 `~/.foundry/keystores`만 읽으므로 keystore는 그 위치에 두고, `ETH_KEYSTORE`·`ETH_KEYSTORE_ACCOUNT`가 설정되어 있으면 서명자가 추가되므로 스크립트가 거절합니다. 응답이 끊겼다면 다시 보내지 말고 그 기록의 거래 hash와 계약 주소를 체인에서 먼저 확인하세요. 두 번째 계약이 정말 필요할 때만 `--broadcast --redeploy`를 씁니다.
- 역할 3개(`DEFAULT_ADMIN_ROLE`·`MINTER_ROLE`·`PAUSER_ROLE`)는 계약 생성자가 실제로 받으며 서로 달라야 합니다. 배포자 계정은 gas만 내고 아무 역할도 받지 않습니다.

스크립트는 chain ID가 `84532`가 아니거나 세 역할 주소가 서로 같으면 중단합니다. 2026-09-20 실제 Base Sepolia RPC 시뮬레이션은 PASS(예상 gas 약 0.000026 ETH)이며 실제 배포는 B-012가 해소될 때까지 `NOT_RUN`입니다.

## 계약 경계

- `DEFAULT_ADMIN_ROLE`: 시리즈 생성·활성화, 역할 관리, 중지 해제
- `MINTER_ROLE`: 활성 시리즈 발행
- `PAUSER_ROLE`: 신규 발행 긴급 중지
- `rewardKey` 한 번만 사용. 시리즈 발행 수량 상한은 없음(D-095, `createSeries(seriesId, baseTokenURI)`)
- 모든 NFT는 ERC-5192 `locked=true`
- 승인·일반 전송·소각·교환·관리자 회수·업그레이드 프록시 없음
