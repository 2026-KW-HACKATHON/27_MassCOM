# Merchant Dual Studio Persistent QA

Generated on 2026-10-08 KST from `27_MassCOM-latest` at `e06c97cd`.

## Local API

- Latest reproducible API base URL: `http://127.0.0.1:3309` (`start-api.ps1`). Browser captures use the earlier 3308 run recorded in `browser-db-result.json`.
- Database: fresh `masscom_showcase_ci_<run>_test` database per run. The latest run name is recorded in `result.json`.
- Credential pattern: `PGPASSWORD` is read from `C:\Hackerton\27_MassCOM\.omx\qa-postgres\db-password.txt` by `start-api.ps1`. Do not paste the password into chat, docs, PRs, or issue comments.
- Start command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File docs\evidence\merchant-dual-studio-2026-10-08\start-api.ps1`
- Public discovery endpoints do not need login. Local demo-only staff/customer calls use `ALLOW_INSECURE_DEMO_ACCOUNT=true` and `x-account-id`; this is not a production auth bypass.

## QA Merchant

- Merchant ID: `qa-wolgye-dalbit-bakery-20261008`
- Name: `QA 가상 월계 달빛빵집`
- Location: `서울 노원구 월계동 월계역 1번 출구 앞 상권 (QA 가상 위치 · 실제 매장 아님)`
- Coordinates: `37.63337, 127.05878`
- Campaign: `qa-wolgye-dalbit-campaign-20261008`
- Goals: `1`, `3`, `5`
- Latest attached photos are persisted as owner photos and exposed through `/v1/discovery/photos/<digest>` as WebP. The campaign collectible was created and published through `PostgresCollectibleProjectService.create/publish` using a QA-only `STAFF` merchant membership and valid PNG grade assets, then linked to the 1·3·5 goals.

## Verification

Fresh run:

```powershell
.\apps\api\node_modules\.bin\tsx.cmd tests/qa/merchant-dual-studio-qa.mts
```

Last pass:

```text
QA_PASS masscom_showcase_ci_202610082fea38_test http://127.0.0.1:3309 qa-wolgye-dalbit-bakery-20261008
```

Verified paths:

- `GET /health`
- `GET /merchants`
- `POST /v1/discovery/search`
- `GET /v1/discovery/merchants/qa-wolgye-dalbit-bakery-20261008`
- `POST /v1/discovery/game-content`
- `GET /v1/discovery/photos/<thumbnail-digest>`
- `PostgresCollectibleProjectService.create/publish` created and linked a publication with reward grades `{1: bronze, 3: custom, 5: gold}`.
- Separate fresh DB integration: `tsx --test apps/api/src/real-world.postgres.integration.ts` on a dedicated `_test` database → `tests 1`, `pass 1`, `fail 0`.
