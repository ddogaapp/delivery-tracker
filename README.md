# Delivery Tracker (ddogaapp)

택배사 사이트와 API에서 배송 정보를 조회해 GraphQL API로 제공하는 서버입니다.

> 이 저장소는 [shlee322/delivery-tracker](https://github.com/shlee322/delivery-tracker)를 수정한 포크입니다. `3b3d63b`(2025-12-25) 이후의 커밋이 자체 변경 사항입니다.
>
> **주요 변경:** Docker, devcontainer, CLA, 후원 설정과 `packages/cli`를 제거했고, `PORT` 환경변수 지원과 GitHub Actions 및 PM2 기반 EC2 배포를 추가했습니다.

## 먼저 알아 둘 점

- **`main`에 push하면 바로 운영 서버에 배포됩니다.** 별도 승인 단계가 없습니다.
- **자동 테스트가 없습니다.** 배포 시 자동 검증은 택배사 목록을 조회하는 헬스 체크뿐입니다. 택배사 코드를 고쳤다면 실제 송장번호로 직접 확인하세요.
- **서버에 인증과 요청 제한이 없습니다.** 8000번 포트를 인터넷에 직접 공개하면 안 됩니다.
- **로컬에서는 pnpm 8을 써야 합니다.** 상위 버전으로 설치하면 `pnpm-lock.yaml`이 다시 작성되고 의존성 버전이 올라갑니다.
- **라이선스 제한이 있습니다.** [라이선스](#라이선스)를 확인하세요.

## 구조

```
packages/core     택배사별 조회 코드 (src/carriers/<택배사 ID>)
packages/api      GraphQL 스키마와 리졸버
packages/server   GraphQL HTTP 서버 (Apollo)
deploy/           PM2 설정
.github/          배포 워크플로와 배포 스크립트
examples/         API 요청 예시
```

```
main에 push 또는 수동 실행
  └─ build (GitHub 호스팅 runner): 빌드 후 번들(tar.gz) 생성
       └─ deploy (EC2의 self-hosted runner): 번들 해제 → 전환 → PM2 reload → 헬스 체크
```

## 로컬 개발

Node.js 20과 pnpm 8이 필요합니다. `dev` 실행은 Node.js 20에서 확인했고, Node.js 26에서는 실패합니다.

```bash
pnpm install --frozen-lockfile
pnpm --filter @delivery-tracker/server build-with-deps
pnpm --filter @delivery-tracker/server dev
```

서버는 `http://localhost:4000`에서 실행됩니다. `core`나 `api`를 수정한 뒤에는 빌드 명령을 다시 실행해야 합니다.

```bash
curl -s localhost:4000 -H 'Content-Type: application/json' \
  -d '{"query":"{ carriers(first: 3) { edges { node { id } } } }"}'
```

더 많은 쿼리 예시는 [examples/examples.http](examples/examples.http)에 있습니다.

## 환경변수

| 이름 | 설명 | 기본값 |
|---|---|---|
| `PORT` | 서버 포트 | 코드 4000, 배포 8000 |
| `LOG_LEVEL` | 로그 레벨 | 설정 안 함 |
| `DELIVERY_TRACKER_CARRIER_REGISTRY_CONFIG_FILE` | 택배사 설정 YAML 경로 | 없음 |

`.vscode/launch.json`의 `LISTEN_PORT`는 코드에서 읽지 않습니다.

### 택배사 설정 파일

`de.dhl`, `kr.ltl`, `us.fedex`, `us.usps`는 인증 정보가 필요해서 기본적으로 **비활성화**되어 있습니다. 현재 [deploy/ecosystem.config.js](deploy/ecosystem.config.js)에는 설정 파일 경로가 없으므로, 이 네 곳을 쓰려면 파일을 서버에 만들고 경로를 추가해야 합니다. 인증 정보는 저장소에 커밋하지 마세요.

```yaml
carriers:
  us.fedex:
    enabled: true
    clientId: "..."
    clientSecret: "..."
```

| 택배사 | 필요한 값 |
|---|---|
| `de.dhl` | `apiKey` |
| `kr.ltl` | `accessId`, `accessKey` |
| `us.fedex`, `us.usps` | `clientId`, `clientSecret` |

## 운영 환경

| 항목 | 값 |
|---|---|
| 서버 | EC2 `ip-10-0-9-179`, 사용자 `ubuntu` |
| 포트 | 8000 |
| 프로세스 | PM2 앱 `delivery-tracker`, cluster 모드 1개, 메모리 1GB 초과 시 재시작 |
| 런타임 | Node.js 24 |
| 배포 경로 | `/home/ubuntu/apps/delivery-tracker` |
| GitHub runner | `~/actions-runner`, 라벨 `delivery-tracker` |
| 인증 정보 | AWS 자격 증명과 GitHub Secrets 사용 안 함 |

```
/home/ubuntu/apps/delivery-tracker/
  releases/<시각>-<커밋>/   릴리스 (최근 3개 유지)
  current                   현재 릴리스를 가리키는 링크
```

서버에서 자주 쓰는 명령입니다.

```bash
pm2 status
pm2 logs delivery-tracker --lines 50
sudo ss -ltnp 'sport = :8000'
curl -s localhost:8000 -H 'Content-Type: application/json' \
  -d '{"query":"{ carriers(first: 3) { edges { node { id } } } }"}'
```

cluster 모드에서는 8000번 포트의 프로세스가 `PM2 ... God`으로 표시되는 것이 정상입니다.

실제 배송 조회는 아래처럼 합니다.

```bash
curl -s localhost:8000 -H 'Content-Type: application/json' \
  -d '{"query":"{ track(carrierId: \"kr.cjlogistics\", trackingNumber: \"<송장번호>\") { lastEvent { time status { code name } description } } }"}'
```

## 배포

- **자동 배포:** `main`에 push하면 실행됩니다.
- **수동 배포:** Actions → Deploy → Run workflow를 실행합니다.
- **deploy만 재시도:** 실패한 실행에서 Re-run failed jobs를 누릅니다. 빌드 결과는 7일간 보관됩니다.

[deploy.sh](.github/scripts/deploy.sh)는 다음 순서로 동작합니다.

1. PM2가 아닌 프로세스가 포트를 쓰고 있으면 아무것도 바꾸지 않고 중단합니다.
2. 번들을 새 릴리스 폴더에 풀고 `current`를 전환합니다.
3. PM2를 reload합니다.
4. 헬스 체크를 최대 30회 시도합니다. 실패하면 이전 릴리스로 자동 롤백합니다.
5. PM2 프로세스 목록을 저장하고 오래된 릴리스를 정리합니다.

저장소 변수 `PORT`, `DEPLOY_PATH`로 기본값을 바꿀 수 있습니다.

### 수동 롤백

```bash
cd /home/ubuntu/apps/delivery-tracker
ls -1t releases
ln -sfn "$PWD/releases/<릴리스>" current
DEPLOY_PATH=$PWD PORT=8000 pm2 startOrReload current/ecosystem.config.js --update-env
```

이전 코드로 고정되는 것이 아니므로, 다음 `main` push가 다시 최신 코드를 배포합니다.

### 서버를 새로 구성할 때

`ubuntu` 사용자로 진행합니다.

1. Node.js 24와 PM2를 설치합니다(`npm install -g pm2`).
2. 저장소의 Settings → Actions → Runners에서 안내하는 대로 `~/actions-runner`에 runner를 내려받습니다.
3. runner를 등록합니다. `node`와 `pm2`가 잡히는 셸에서 실행하세요.
   ```bash
   cd ~/actions-runner
   ./config.sh --url <저장소 URL> --token <토큰> --labels delivery-tracker
   sudo ./svc.sh install ubuntu
   sudo ./svc.sh start
   ```
4. Actions에서 Deploy를 실행합니다.
5. `pm2 startup`을 실행하고, 출력되는 `sudo` 명령도 실행합니다. 그래야 재부팅 후 서버가 다시 뜹니다.

## 문제 해결

| 증상 | 원인과 조치 |
|---|---|
| `node: command not found`, `pm2: command not found` | runner의 PATH 문제입니다. `node`와 `pm2`가 잡히는 셸에서 `cd ~/actions-runner && ./env.sh && sudo ./svc.sh stop && sudo ./svc.sh start`를 실행하고 deploy를 재시도합니다. Node 설치 경로가 바뀌어도 다시 실행해야 합니다. |
| `Port ... is in use by a process other than PM2` | 다른 프로세스가 포트를 쓰고 있습니다. `sudo ss -ltnp 'sport = :8000'`로 확인하고 정리합니다. |
| API가 `Internal error`를 반환 | 없는 송장번호나 잘못된 형식도 응답에서는 `Internal error`로 바뀝니다. 실제 코드는 `pm2 logs`의 `NOT_FOUND`, `BAD_REQUEST`에서 확인합니다. |
| 일부 택배사가 목록에 없음 | [택배사 설정 파일](#택배사-설정-파일)이 필요한 택배사일 수 있습니다. |
| `pnpm-lock.yaml`이 크게 바뀜 | 상위 버전 pnpm으로 설치한 경우입니다. `git restore pnpm-lock.yaml pnpm-workspace.yaml`로 되돌리고 pnpm 8로 다시 설치합니다. |
| `pnpm deploy`에서 `EACCES` | pnpm 8은 저장소 밖 경로로 deploy하면 경로를 잘못 계산합니다. 번들은 저장소 안(`.bundle`)에 만들어야 합니다. |

## 원본 저장소 변경 가져오기

이 저장소에는 원본 저장소 remote가 등록되어 있지 않습니다.

```bash
git remote add upstream https://github.com/shlee322/delivery-tracker.git
git fetch upstream
git merge upstream/main
```

- 삭제한 파일(`Dockerfile`, `.devcontainer/`, `packages/cli/`, `.github/workflows/cla.yaml`, `.github/FUNDING.yml`)에서 충돌이 나면 삭제 쪽을 선택합니다.
- `pnpm-lock.yaml` 충돌은 pnpm 8의 `pnpm install`로 다시 생성합니다.
- `main`에 push하면 바로 배포되니, 별도 브랜치에서 병합하고 빌드와 실제 조회를 확인한 뒤 반영하세요.

## 인수인계 시 확인할 항목

2026-11-04에 Docker에서 PM2로 전환했습니다. 전환 후 8000번을 PM2가 처리하는 것과 택배사 목록 조회는 확인했지만, 아래 항목은 확인 기록이 없습니다. 확인이 끝나면 이 절을 정리해 주세요.

- [ ] 사용 중인 택배사별 실제 송장번호 조회
- [ ] 외부 호출 경로와 8000번 포트의 공개 범위(보안 그룹, ALB, Nginx 등)
- [ ] 재부팅 후 자동 복구(`pm2 startup` 설정 여부)
- [ ] Docker 제거 완료 여부(`containerd`, `runc`, `/var/lib/docker` 정리)
- [ ] 기존 컨테이너에 있던 환경변수와 택배사 설정 파일을 PM2로 옮겨야 하는지. `de.dhl`, `kr.ltl`, `us.fedex`, `us.usps`를 썼다면 지금은 비활성화 상태입니다.
- [ ] 저장소 공개 범위. 공개 저장소에서 self-hosted runner를 쓰면 외부 코드가 서버에서 실행될 위험이 있어 비공개를 권장합니다.
- [ ] 로컬 개발 환경 교체. Node.js 20은 지원이 종료되었고, `dev` 실행은 다른 지원 버전에서 확인되지 않았습니다.
- [ ] 이 서비스의 담당자와 EC2 접속 방법 기록

## 라이선스

원본과 같은 [Elastic License 2.0](LICENSE)이 적용됩니다.

- 이 소프트웨어의 주요 기능을 제3자에게 호스팅 또는 관리형 서비스로 제공할 수 없습니다. 외부 고객 대상으로 쓸 계획이면 법무 검토가 필요합니다.
- 저작권과 라이선스 고지를 유지해야 합니다. 배포 번들에도 `LICENSE`가 포함됩니다.
- 수정본을 다른 사람에게 제공할 때는 수정 사실을 눈에 띄게 표시해야 합니다. 이 문서 상단의 포크 고지가 그 역할을 하므로 삭제하지 마세요.

원본 프로젝트의 문의처와 문서는 [tracker.delivery](https://tracker.delivery/docs/try)에 있습니다. 이 포크의 운영 문의는 그곳으로 보내면 안 됩니다.
