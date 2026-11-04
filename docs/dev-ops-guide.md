# 또가 배송추적(delivery-tracker) 개발·운영 가이드

이 문서는 delivery-tracker를 이어받아 **운영하는 사람**의 관점에서 저장소 코드, Dockerfile, `.gitlab-ci.yml`, git 이력, 이 서비스를 호출하는 다른 또가 저장소(ddoga-api, ddoga-scheduler, ddoga-front)를 확인해 정리한 것입니다. 지원 택배사 목록과 로컬 실행은 [README](../README.md)에 있으므로 반복하지 않습니다.

- 직접 조치할 일은 [10. Todo](#10-todo)에, 사람에게 묻거나 정해야 할 일은 [11. 확인사항](#11-확인사항)에 모았습니다.
- 서버 IP, bastion 주소, SSH 접속 정보, 비밀값(API 키·시크릿)은 이 문서에 적지 않습니다. **서버 위치·접속 방법은 노션 「[또가 개발·운영 허브](https://app.notion.com/p/40c4454699e081e4a63ec2b0f574589c)」를 참조**하세요.
- 작성 기준은 2026-11-03, `master` `958c651`(마지막 코드 변경 `b3390d5`, 2026-01-29)입니다. 2026-11-03에 담당 개발자 답변을 반영했습니다.

---

## 1. 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 역할 | 택배 송장의 배송 상태를 택배사 웹사이트에서 읽어 와(스크래핑) 돌려주는 내부 API. 또가 스토어의 "배송 조회" 화면과 "배송완료(수취 확인) 자동 처리"에 씁니다 |
| 출처 | 오픈소스 `tracker.delivery`(Delivery Tracker)를 2026-01-28에 가져와 또가용 REST 엔드포인트와 API 키 인증을 덧붙인 것입니다. 또가가 고친 곳은 `packages/server`뿐이고 택배사 로직(`packages/core`)은 원본 그대로입니다 |
| 스택 | Node.js 20(Docker 이미지 `node:20-alpine`), pnpm 모노레포(`packages/core`, `api`, `server`, `cli`), Express + Apollo Server(GraphQL), winston 로그 |
| 실행 형태 | Docker 컨테이너 1개 `ddoga-container`, 호스트 포트 **8000** → 컨테이너 4000. `ecosystem.config.js`(PM2 cluster, 포트 4000)도 있지만 마지막 배포 방식은 Docker입니다(4장) |
| 호출하는 쪽 | ddoga-api(배송 조회 화면), ddoga-scheduler(배송완료 자동 처리). 5장 |
| 배포 | **현재 배포 파이프라인이 없습니다.** 예전에는 GitLab CI가 이미지를 이전 담당 개발자 개인 Docker Hub 계정에 올리고 서버에서 컨테이너를 바꿨습니다. GitLab·Jenkins는 더 쓰지 않기로 했습니다 |
| 라이선스 | 원본은 **Elastic License 2.0**입니다(README의 MIT 표기는 틀렸던 것이라 고쳤습니다). 사내 사용은 문제없지만, 이 소프트웨어 자체를 제3자에게 호스팅 서비스로 제공하면 안 됩니다 |
| 작성자 | 2026-01-28~29 이전 담당 개발자가 집중적으로 작업(35커밋, GitLab CI 봇 병합 제외). 이후로는 2026-06-26 `.gitlab-ci.yml` 수정 1건뿐 |

---

## 2. 주소

| 환경 | 주소 | 비고 |
| --- | --- | --- |
| 운영(공개 도메인) | `https://delivery.ddoga.co.kr` | ddoga-api 운영 설정(`ddoga.tracker.url`)이 쓰는 주소. ALB를 거치는지, 어느 대상으로 가는지 확인 필요([확인사항 C2](#11-확인사항)) |
| 운영(내부) | `http://<서버 사설 IP>:8000` | ddoga-scheduler 운영 설정(`delivery-tracker.api-url`)이 쓰는 주소. IP는 노션 허브 참조 |
| 서버 안 | `http://127.0.0.1:8000` | 컨테이너 포트 4000을 호스트 8000으로 연결 |
| 개발 | **없습니다** | ddoga-api 개발 설정은 `https://devapi.ddoga.co.kr`(api 자기 자신)을, scheduler 개발 설정은 운영 사설 주소를 가리킵니다([7장](#7-확인된-문제와-주의사항) 4번) |
| 로컬 | `http://localhost:4000` | `pnpm dev` |
| README의 `https://api.ddoga.co.kr:4436/track/...` | 예전 주소로 보임 | 지금 호출하는 코드가 없습니다([확인사항 C2](#11-확인사항)) |

### 엔드포인트 (`packages/server/src/index.ts`)

| 경로 | 인증 | 내용 |
| --- | --- | --- |
| `GET /health-check` | 없음 | `{"message":"OK"}`. 헬스체크용 |
| `GET /track/:carrierId/:trackingNumber` | 필요 | 마지막 상태 + 최근 이벤트 20개. ddoga-api가 호출 |
| `GET /track/last/:carrierId/:trackingNumber` | 필요 | 마지막 상태만. ddoga-scheduler가 호출 |
| `GET /track/carriers` | 필요 | 국내(`kr.`로 시작) 택배사 ID 목록 |
| `POST /graphql` | 필요 | 원본 GraphQL API. 또가 코드는 쓰지 않습니다 |

- 인증은 요청 헤더 `ddoga-tracker-api-key`(client ID)와 `ddoga-tracker-api-secret`(client secret)입니다. 맞지 않으면 401 `UNAUTHENTICATED`를 돌려줍니다(5장).
- 택배사가 "송장 없음"이나 오류를 내도 HTTP 200에 본문 `errors`로 돌려줍니다. 상태 코드만 보고 성공이라고 판단하면 안 됩니다.

---

## 3. 인프라

### 3-1. 운영 서버 (`.gitlab-ci.yml` 마지막 버전 기준)

| 항목 | 내용 |
| --- | --- |
| 서버 | AWS EC2(Ubuntu, `ubuntu` 사용자). 이미지를 `linux/arm64`로 빌드했으므로 **ARM(Graviton) 인스턴스**입니다. bastion을 거쳐 사설 IP로 접속합니다(노션 허브). 2026-01-28 커밋 `2acf1b4 new ec2`에서 지금 서버로 옮겼습니다 |
| 어느 서버인지 | 다른 서비스와 같은 서버인지 전용 서버인지 코드로는 알 수 없습니다([확인사항 C1](#11-확인사항)) |
| 실행 | `docker run -d --name ddoga-container -p 8000:4000 <이미지>` |
| 재시작 정책 | **없음**(`--restart` 옵션을 주지 않았음). 서버가 재부팅되면 컨테이너가 자동으로 뜨지 않습니다 → [Todo T2](#10-todo) |
| 이미지 | `<이전 담당 개발자 개인 Docker Hub 계정>/ddoga-tracker:<GitLab 파이프라인 번호>` |
| 앱 경로 | 서버에 소스 경로가 없습니다(이미지로만 배포). 컨테이너 안 `/app/packages/server`에서 `pnpm start` |
| 환경변수 | 따로 넘기지 않습니다. 이미지의 `NODE_ENV=production`, 기본 포트 4000만 씁니다 |
| 앞단 | 또가의 다른 서비스는 모두 ALB + ACM(인증서 자동 갱신)입니다. `delivery.ddoga.co.kr`도 같은지는 [확인사항 C2](#11-확인사항) |
| 로그 | 콘솔(stdout)로만 남깁니다. `docker logs`로 봅니다(4-5) |

- 서버 초기 설정은 README "운영 서버 설정"대로 `docker.io` 설치 후 `ubuntu`를 `docker` 그룹에 넣은 것이 전부입니다.
- 서버에 PM2로 띄운 흔적이 있는지도 함께 확인합니다(4-1). `ecosystem.config.js`는 Docker 전환 이전 것으로 보입니다.

### 3-2. 설정과 비밀값

| 항목 | 위치 | 비고 |
| --- | --- | --- |
| API 키(client ID/secret) 3쌍 | `packages/server/src/index.ts`의 `USABLE_KEYS`에 **코드로 박혀 있음** | 이름 `ADMIN`, `API`, `IMS`. 값은 문서에 적지 않습니다 → [Todo T4](#10-todo) |
| 택배사 설정 파일 | 환경변수 `DELIVERY_TRACKER_CARRIER_REGISTRY_CONFIG_FILE`(YAML) | 운영에서는 지정하지 않음. 기본값으로 `de.dhl`, `kr.ltl`, `us.fedex`, `us.usps`는 꺼져 있습니다 |
| 로그 레벨 | 환경변수 `LOG_LEVEL` | 지정하지 않음(winston 기본 `info`) |
| 포트 | 환경변수 `PORT` | 지정하지 않음(4000) |

- 또가가 쓰는 국내 택배사는 **모두 별도 API 키가 필요 없습니다**(택배사 공개 웹페이지를 읽음). API 키가 필요한 것은 꺼져 있는 DHL(`apiKey`), FedEx·USPS(`clientId`/`clientSecret`), 합동택배 LTL(`accessId`/`accessKey`)뿐이고, 이 값들은 택배사 설정 파일에 넣게 되어 있습니다. 지금은 설정 파일이 없습니다.

### 3-3. 확인된 인프라 정보 (2026-11-03)

| 항목 | 내용 |
| --- | --- |
| HTTPS 앞단 | 또가 모든 서비스가 ALB + ACM입니다. 인증서는 ACM이 자동 갱신합니다(DNS 검증 레코드 유지 필요) |
| 도메인 | `ddoga.co.kr`은 후이즈에서 관리합니다(만료 2033-10-26) |
| DB | **쓰지 않습니다.** 상태를 저장하지 않는 서비스라 컨테이너를 바꿔도 잃는 데이터가 없습니다 |
| 모니터링 | 별도 계획이 없습니다. api의 Prometheus(`ops.ddoga.co.kr`)는 있지만 이 서비스는 지표를 내보내지 않습니다 |

---

## 4. 배포·재기동·롤백·로그

### 4-1. 서버에서 지금 무엇이 떠 있는지 확인하기

bastion을 거쳐 서버에 접속한 뒤 실행합니다(접속 정보는 노션 허브). 조회만 하는 명령입니다.

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'      # 컨테이너, 이미지 태그, 포트
docker inspect ddoga-container --format \
  'image={{.Config.Image}} created={{.Created}} restart={{.HostConfig.RestartPolicy.Name}} log={{.HostConfig.LogConfig.Type}}'
docker images | grep -i tracker                                              # 서버에 남은 이전 이미지(롤백용)
curl -s http://127.0.0.1:8000/health-check                                   # {"message":"OK"}
sudo ss -ltnp | grep -E ':(8000|4000)\b'                                     # 포트를 잡은 프로세스
command -v pm2 && pm2 ls                                                     # PM2로 띄운 것이 있는지
uname -m                                                                     # aarch64 이면 ARM
```

| 볼 것 | 기대값 |
| --- | --- |
| 컨테이너 이름 | `ddoga-container` |
| 이미지 | `<개인 Docker Hub 계정>/ddoga-tracker:<번호>` |
| 포트 | `0.0.0.0:8000->4000/tcp` |
| 재시작 정책 | `no`(→ [Todo T2](#10-todo)) |
| PM2 | 없거나 delivery-tracker 프로세스가 없어야 함. 있으면 포트 4000 충돌 여부를 봅니다 |

- 결과는 노션 허브의 서버 표에 적습니다([Todo T1](#10-todo)).

### 4-2. 배포 방식 (현재 상태)

| 구분 | 내용 |
| --- | --- |
| 예전(~2026-06) | 옛 사내 GitLab의 `.gitlab-ci.yml`. `master` push → GitLab runner가 `docker build --platform linux/arm64` → **이전 담당 개발자 개인 Docker Hub 계정**에 push → bastion을 거쳐 서버에 SSH → `docker pull` → 기존 `ddoga-container` 정지·삭제 → 새로 `docker run` |
| 예전 동기화 | 같은 파일의 `sync-with-github` 작업이 GitLab 예약 실행(README 기준 매주 화요일 02시)으로 **이전 담당 개발자 개인 GitHub 포크**를 `-X theirs`로 병합해 `master`에 push. 실제 병합 기록은 2026-01-28 1건(`fc6c462`)뿐입니다 |
| 지금 | GitLab·Jenkins는 쓰지 않기로 했습니다. GitHub `ddogaapp/delivery-tracker`에는 배포 workflow가 없습니다(`.github/workflows/cla.yaml`은 원본 프로젝트의 CLA 봇이라 무관). **`master`에 push해도 아무것도 배포되지 않습니다** |
| 이미지 위치 | 운영 이미지는 이전 담당 개발자 개인 Docker Hub 계정에만 있습니다. 회사가 통제할 수 없으므로, 다음 배포부터는 서버에서 직접 빌드하거나 회사 Docker Hub `ddoga` 조직으로 옮깁니다 → [Todo T3](#10-todo) |

- 요청 처리 흐름(확정)은 `develop` → 개발 서버 배포 → 개발자 검수 → 요청자 검수 → `master` 반영 → 운영 배포입니다. 이 저장소는 개발 서버도, `develop` 브랜치도 없어 **로컬에서 검수**합니다(4-3의 확인 명령).
- 파이프라인을 만들기 전까지는 아래 4-3 수동 배포를 씁니다. 장기적으로는 다른 저장소처럼 GitHub Actions self-hosted runner 배포로 바꿉니다([Todo T3](#10-todo)).

### 4-3. 수동 배포 (제안, `.gitlab-ci.yml`과 같은 결과)

> 아직 실행해 본 절차가 아닙니다. 처음 한 번은 사용량이 적은 시간(scheduler 배송완료 작업이 쉬는 22:00~08:00)에 하고, 결과를 이 절에 반영합니다([Todo T1](#10-todo)).

**방법 A: 서버에서 직접 빌드(권장, Docker Hub 불필요)**

```bash
# 서버에서. 소스 경로는 정해서 노션 허브에 적습니다(예: ~/delivery-tracker)
git clone https://github.com/ddogaapp/delivery-tracker.git ~/delivery-tracker   # 처음 한 번(저장소가 비공개면 deploy key 필요)
cd ~/delivery-tracker && git fetch origin && git checkout <배포할 커밋>
TAG=$(git rev-parse --short HEAD)
docker build -t ddoga/delivery-tracker:$TAG .                                   # ARM 서버라 --platform 불필요

docker stop ddoga-container && docker rename ddoga-container ddoga-container-prev
docker run -d --name ddoga-container --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=10 \
  -p 8000:4000 ddoga/delivery-tracker:$TAG
sleep 5 && curl -s http://127.0.0.1:8000/health-check                          # {"message":"OK"}
docker rm ddoga-container-prev                                                  # 4-6 확인이 끝난 뒤
```

**방법 B: 로컬에서 빌드해 옮기기(서버에 git을 두기 어려울 때)**

```bash
docker buildx build --platform linux/arm64 -t ddoga/delivery-tracker:<커밋> --load .
docker save ddoga/delivery-tracker:<커밋> | gzip > tracker.tar.gz
# bastion을 거쳐 서버로 복사(노션 허브의 접속 방법) → 서버에서:
gunzip -c tracker.tar.gz | docker load
# 이후는 방법 A의 docker stop 줄부터 같음
```

- 빌드 중 `pnpm install --frozen-lockfile`이 실패하면 Dockerfile의 `pnpm@latest`가 바뀐 탓일 수 있습니다. pnpm 버전 고정 → [Todo T7](#10-todo)
- 컨테이너를 바꾸는 동안(수 초) 요청이 실패합니다. ddoga-scheduler는 실패를 "배송 중"으로 보고 다음 회차(15분 뒤)에 다시 확인하므로 데이터 문제는 없습니다.

### 4-4. 재기동

```bash
docker ps -a --filter name=ddoga-container            # 상태 확인
docker restart ddoga-container                         # 재시작
curl -s http://127.0.0.1:8000/health-check             # {"message":"OK"}
docker logs --since 2m ddoga-container                 # "Server ready at http://localhost:4000" 확인
```

- 상태를 저장하지 않으므로 언제 재시작해도 됩니다. 재시작 시간은 수 초입니다.
- 서버 재부팅 후에는 컨테이너가 **자동으로 뜨지 않습니다.** `docker start ddoga-container`로 띄웁니다. 재시작 정책을 넣으면(`docker update --restart unless-stopped ddoga-container`) 해결됩니다 → [Todo T2](#10-todo)

### 4-5. 롤백

| 상황 | 방법 |
| --- | --- |
| 4-3 직후 문제 발견 | `ddoga-container-prev`가 남아 있으면: `docker rm -f ddoga-container && docker rename ddoga-container-prev ddoga-container && docker start ddoga-container` |
| 이미 이전 컨테이너를 지움 | `docker images | grep -i tracker`로 이전 태그를 찾아 4-3의 `docker run` 줄을 그 태그로 다시 실행 |
| 서버에 이전 이미지도 없음 | 이전 커밋을 checkout해 4-3 방법 A로 다시 빌드 |

- 지금 떠 있는 개인 Docker Hub 이미지는 서버에 캐시되어 있습니다. **새 이미지로 바꾸기 전 이 이미지를 지우지 않습니다.** 첫 수동 배포가 실패하면 이 이미지가 유일한 복구 수단입니다. 가능하면 먼저 `docker tag <기존 이미지> ddoga/delivery-tracker:legacy-gitlab`으로 회사 이름의 태그를 붙여 둡니다.

### 4-6. 배포 후 확인 체크리스트

1. `curl -s http://127.0.0.1:8000/health-check` → `{"message":"OK"}`
2. `docker inspect ddoga-container --format '{{.HostConfig.RestartPolicy.Name}}'` → `unless-stopped`
3. 인증·조회 확인(키 값은 `index.ts`에서 확인하고 셸 이력에 남지 않게 주의):
   `curl -s -H "ddoga-tracker-api-key: <ID>" -H "ddoga-tracker-api-secret: <SECRET>" http://127.0.0.1:8000/track/carriers` → `["kr.chunilps", ...]`
4. 실제 송장 한 건: `/track/last/kr.cjlogistics/<최근 송장번호>` → `data.track.lastEvent.status.code`가 나오는지
5. 사용자 경로: 또가 스토어 마이페이지 → 주문 → 배송 조회 화면이 열리는지(ddoga-api 경유)
6. 다음 15분 회차 이후 scheduler 로그에 `[Naver] 수취 완료 체크: ... delivered=true`가 한 건이라도 있는지(scheduler 가이드 4-6)

### 4-7. 로그 보는 방법

별도 로그 수집 시스템이 없고 파일 로그도 없습니다. 콘솔 출력만 Docker가 보관합니다.

| 순서 | 무엇 | 어디서 |
| --- | --- | --- |
| 1 | 컨테이너가 살아 있는지 | `docker ps`, `/health-check` |
| 2 | 누가 어떤 송장을 조회했고 몇 ms 걸렸는지 | `docker logs`. 한 요청에 `[<호출자 이름>] /track/... - start`와 `... - <N>ms` 두 줄 |
| 3 | 택배사 쪽 오류 | `docker logs`의 `"level":"error"` 줄(`internal error response`) |
| 4 | scheduler가 배송완료를 판정했는지 | scheduler 로그 `[Naver] 수취 완료 체크` |
| 5 | 사용자 배송 조회 화면 오류 | ddoga-api 로그(`TrackingClient`) |

```bash
docker logs --since 1h ddoga-container                                  # 최근 1시간
docker logs --since 24h ddoga-container 2>&1 | grep '"level":"error"'   # 하루치 오류
docker logs --since 24h ddoga-container 2>&1 | grep -c "\[ADMIN\]"      # scheduler 호출 수
docker logs --since 24h ddoga-container 2>&1 | grep -c "\[API\]"        # ddoga-api 호출 수
docker logs ddoga-container 2>&1 | grep "<송장번호>"                     # 특정 송장
sudo du -sh /var/lib/docker/containers/$(docker inspect -f '{{.Id}}' ddoga-container)   # 로그 용량
```

- 로그는 JSON 한 줄 형식이고 시각은 UTC(`timestamp`)입니다.
- 호출자 이름은 API 키 이름입니다. **scheduler는 `ADMIN` 키를 씁니다.** 인증에 실패한 요청은 로그가 남지 않습니다.

#### 남지 않는 로그

- **파일 로그**: 없습니다(`logger.ts`에 `TODO : file mode`). 컨테이너를 지우면(`docker rm`) 그 컨테이너의 로그도 사라집니다. 4-3에서 `-prev`를 지우기 전에 필요한 로그를 확인합니다.
- **로그 회전**: 예전 `docker run`에 로그 옵션이 없어 Docker 기본(json-file, 무제한)일 가능성이 큽니다. 송장번호가 로그에 계속 쌓입니다 → [Todo T2](#10-todo)
- **401 거절 요청**: 기록이 없습니다.
- **ALB 액세스 로그**: 켜져 있는지 확인하지 못했습니다(admin 가이드 확인사항 C5와 같음).

---

## 5. 호출하는 서비스와 API 키

### 5-1. 누가 호출하나

| 호출자 | 설정 | 주소 | 경로 | 쓰는 키 | 용도 |
| --- | --- | --- | --- | --- | --- |
| ddoga-scheduler | `application-*.yml`의 `ddoga.scheduler.delivery-tracker.api-url`·`client-id`·`client-secret` | 운영 사설 IP `:8000` | `/track/last/...` | `ADMIN` | 작업 `SCH_DELIVERED_UPDATE`(매일 08:00~21:59, 15분 간격): Shopby "배송 중" 주문의 송장을 조회해 `DELIVERED`면 Shopby에 수취 확인 처리 |
| ddoga-api | `application-*.yml`의 `ddoga.tracker.url`·`api-key`·`api-secret`(운영은 환경변수 참조) | `https://delivery.ddoga.co.kr` | `/track/...` | `API`로 추정 | `GET /tracking?carrierId=&trackingNumber=`(로그인 없이 호출 가능) → ddoga-front 마이페이지 배송 조회 화면 |
| (없음) | - | - | - | `IMS` | 로컬 저장소에서 쓰는 곳을 찾지 못했습니다([확인사항 C3](#11-확인사항)) |

- scheduler는 조회 실패(타임아웃, 401, 5xx)를 모두 "배송완료 아님"으로 처리하고 **오류 로그를 남기지 않습니다.** 이 서비스가 죽어도 scheduler 쪽에서는 `delivered=false`만 찍힙니다(8장).

### 5-2. 또가가 실제로 쓰는 택배사

Shopby의 택배사 코드(`deliveryCompanyType`)를 택배사 ID로 바꿔 호출합니다.

| Shopby 코드 | 택배사 ID | scheduler | front(배송 조회) |
| --- | --- | --- | --- |
| `CJ` | `kr.cjlogistics` | ○ | ○ |
| `LOTTE` | `kr.lotte` | ○ | ○ |
| `HANJIN` | `kr.hanjin` | ○ | ○ |
| `LOGEN` | `kr.logen` | ○ | ○ |
| `DAESIN` | `kr.daesin` | ○ | ○ |
| `CHUNIL` | `kr.chunilps` | ○ | ○ |
| `KUNYOUNG` | `kr.kunyoung` | ○ | ○ |
| `ILYANG` | `kr.ilyanglogis` | ○ | ○ |
| `KDEXP` / `KGB` | `kr.kdexp` | ○ (`KDEXP`) | 배송 조회 ID 없음(`KGB`는 링크만) |

- 출처: scheduler `NaverSchedulerService.CARRIER_IDS`, front `src/const/shopBy/delivery.ts`
- 이 9개 모두 API 키가 필요 없고 택배사 웹페이지를 읽습니다. **택배사가 홈페이지를 바꾸면 조회가 깨집니다**(6-2).
- 표에 없는 택배사(`ETC` 등)는 scheduler가 조회하지 않습니다.

### 5-3. API 키 발급·회수

1. 새 키 만들기: `pnpm --filter @delivery-tracker/server gen-keys` → client ID(32자), secret(64자) 출력
2. `packages/server/src/index.ts`의 `USABLE_KEYS`에 `{ clientId, clientSecret, name }` 추가(이름은 로그에 찍힘)
3. 배포(4-3) → 호출하는 쪽 설정에 새 값 반영 → 호출하는 쪽 배포
4. 예전 키를 `USABLE_KEYS`에서 빼고 다시 배포

- 지금은 키가 코드에 있으므로 키를 바꾸려면 배포가 필요합니다. 환경변수로 옮기는 것은 [Todo T4](#10-todo).
- 키 교체는 담당 개발자가 직접 합니다. 범위는 노션 「[비밀값 관리와 키 교체](https://app.notion.com/p/40c4454699e08117be99f9e0cc943886)」를 따릅니다.

### 5-4. 접근·계정

| 대상 | 용도 | 받음 |
| --- | --- | --- |
| GitHub `ddogaapp/delivery-tracker` | 코드 | ☑ `ddogaapp` 관리자 |
| AWS 콘솔 | EC2, ALB, 보안그룹 | ☑ |
| 서버 접속(bastion 경유) | 재기동·로그·수동 배포 | ☑ 키 파일. 서버별 개발자용 운영 계정은 문의 중([C4](#11-확인사항)) |
| 이전 담당 개발자 개인 Docker Hub 계정 | 지금 떠 있는 이미지 보관처 | ☐ 받지 않음. 회사 Docker Hub와 함께 문의 중([C4](#11-확인사항)). 받지 않아도 4-3 방법 A로 배포할 수 있습니다 |
| 옛 사내 GitLab, 이전 담당 개발자 개인 GitHub 포크 | 예전 배포·동기화 | 필요 없음(쓰지 않기로 함) |

---

## 6. 운영 업무

### 6-1. 운영팀이 물어볼 만한 것

| 문의 | 확인할 곳 |
| --- | --- |
| 배송 조회 화면에 아무것도 안 나온다 | `/health-check` → `docker logs`에서 그 송장번호 → 택배사 홈페이지에서 직접 조회해 비교. 특정 택배사만 안 되면 6-2 |
| 배송이 끝났는데 주문이 "배송 중"이다 | scheduler 로그 `[Naver] 수취 완료 체크: ... invoiceNo=<송장>`의 `delivered` 값. `false`가 계속이면 이 서비스 로그에서 같은 송장 조회 결과 확인. 택배사가 표에 없으면(5-2) 자동 처리 대상이 아닙니다 |
| 경동택배(`KGB`) 조회가 안 된다 | front는 `KGB`를 배송 조회 ID로 바꾸지 않습니다(5-2). 링크만 있습니다 |

### 6-2. 택배사 사이트가 바뀌어 조회가 깨질 때 (원본 동기화)

- 택배사 로직은 원본 오픈소스의 2025-12-25 커밋(`3b3d63b`)에서 멈춰 있습니다. 원본 프로젝트는 택배사 사이트 변경에 맞춰 꾸준히 고칩니다(예: 2025-12 쿠팡, 2025-11 경동, 2025-08 롯데).
- 예전 자동 동기화는 이전 담당 개발자 개인 GitHub 포크를 거쳤고 GitLab 예약 작업이었으므로 **지금은 멈췄습니다.**
- 또가가 바꾼 곳은 `packages/server`, `Dockerfile`, `README.md`, `ecosystem.config.js`, `.gitlab-ci.yml`, `package.json`뿐이라 원본 변경(`packages/core`)과 거의 겹치지 않습니다. 수동 병합이 어렵지 않습니다.
- 앞으로 동기화를 계속할지, 어떤 주기로 할지 → [확인사항 C5](#11-확인사항). 계속한다면 절차는 [Todo T6](#10-todo).
- 특정 택배사가 갑자기 전부 실패하면: 원본 저장소에 그 택배사(`packages/core/src/carriers/<ID>`) 수정 커밋이 있는지 먼저 보고, 있으면 그 커밋만 가져와(cherry-pick) 배포합니다.

---

## 7. 확인된 문제와 주의사항

| # | 내용 | 조치 |
| --- | --- | --- |
| 1 | **배포 파이프라인이 없고, 운영 이미지가 이전 담당 개발자 개인 Docker Hub 계정에만 있습니다.** 그 계정이 지워지거나 비공개로 바뀌면 같은 이미지를 다시 받을 수 없습니다 | [Todo T3](#10-todo) |
| 2 | **API 키 3쌍(client ID·secret)이 `packages/server/src/index.ts`에 그대로 커밋돼 있습니다.** scheduler yml에도 같은 `ADMIN` 키가 있습니다. 저장소가 공개라면 누구나 이 API를 쓸 수 있습니다 | [Todo T4](#10-todo), [확인사항 C6](#11-확인사항) |
| 3 | 컨테이너에 재시작 정책과 로그 크기 제한이 없습니다. 서버 재부팅 시 서비스가 멈추고, 로그(송장번호 포함)가 무제한으로 쌓입니다 | [Todo T2](#10-todo) |
| 4 | 개발 환경이 없습니다. ddoga-api 개발 설정은 `devapi.ddoga.co.kr`(api 자신)을 가리켜 개발 서버의 배송 조회는 실패하고, scheduler 개발·스테이징 설정은 운영 사설 주소를 가리킵니다 | [Todo T8](#10-todo), scheduler 가이드 Todo T7 |
| 5 | 이 서비스가 죽어도 아무도 모릅니다. 알림이 없고, scheduler는 실패를 "배송 중"으로 조용히 처리합니다 | [Todo T5](#10-todo) |
| 6 | ddoga-api `/tracking`은 로그인 없이 호출할 수 있어, 외부에서 또가를 거쳐 이 서비스를 쓸 수 있습니다(택배사 쪽 차단 위험) | [Todo T9](#10-todo) |
| 7 | 원본 프로젝트의 CLA 봇 workflow(`.github/workflows/cla.yaml`, `pull_request_target`, 쓰기 권한)가 남아 있습니다. 또가에는 필요 없습니다 | [Todo T7](#10-todo) |
| 8 | `.gitlab-ci.yml`에 이전 담당 개발자 개인 Docker Hub 계정 이름, 개인 GitHub 포크 주소, 옛 사내 GitLab 주소가 있습니다. 비밀값 자체는 GitLab 변수로 넘겨서 파일에는 없습니다. git 이력(`2acf1b4` 이전)에는 예전 서버 IP가 남아 있습니다 | [Todo T7](#10-todo) |
| 9 | Dockerfile이 `pnpm@latest`를 설치해 빌드할 때마다 pnpm 버전이 달라질 수 있습니다. 테스트·lint를 돌리는 CI도 없습니다 | [Todo T7](#10-todo) |

---

## 8. 장애 발견·대응

| 항목 | 내용 |
| --- | --- |
| 헬스체크 | 서버 안 `http://127.0.0.1:8000/health-check`. 외부는 `https://delivery.ddoga.co.kr/health-check`(이번 검토에서 직접 호출해 보지 못함). 택배사 조회가 되는지까지는 보지 않습니다 |
| 알림 | **없습니다**(컨테이너 다운, 택배사 조회 실패 모두) → [Todo T5](#10-todo) |
| 임시 점검 | 정식 알림을 만들 때까지 하루 한 번 4-7의 "하루치 오류" 명령을 실행하고, scheduler 로그에서 `delivered=true`가 나오는지 봅니다 |
| 긴급 대응 방식 | 아직 설계 전입니다(admin 가이드 Todo T14와 같은 성격). 서버 재기동 방법·장애 대응 프로세스는 개발팀장 문의 중([C4](#11-확인사항)) → [Todo T10](#10-todo) |

| 증상 | 확인 / 조치 |
| --- | --- |
| 컨테이너 다운(재부팅 후 등) | `docker ps -a` → `docker start ddoga-container` → 헬스체크. 놓친 배송완료 처리는 scheduler 다음 회차에 자동으로 다시 확인합니다 |
| 헬스체크는 OK인데 조회가 전부 실패 | `docker logs`의 error 줄. 서버에서 택배사 사이트로 나가는 통신(아웃바운드)이 막히지 않았는지 `curl -sI https://www.cjlogistics.com` |
| 특정 택배사만 실패 | 택배사 사이트 변경 가능성. 6-2 |
| 401만 돌아옴 | 호출하는 쪽 키 설정이 `USABLE_KEYS`와 맞는지(5-3) |
| 디스크 부족 | `df -h`, `docker system df`, 4-7의 로그 용량 명령. 오래된 이미지 정리(현재·직전 것은 남김) |

---

## 9. 운영팀과 일하는 방식

| 항목 | 내용 |
| --- | --- |
| 요청 흐름 | `develop` → 개발 서버 배포 → 개발자 검수 → 요청자(운영팀) 검수 → `master` 반영 → 운영 배포. 정기 배포일 없이 검수가 끝나면 바로 반영합니다 |
| 이 저장소의 차이 | 개발 서버와 `develop` 브랜치가 없고 자동 배포도 없습니다. 로컬에서 검수하고 `master`에 반영한 뒤 4-3으로 수동 배포합니다 |
| 요청 채널 | 사내 메신저, Teams(바뀔 수 있음). 요청 양식은 없습니다 |
| 운영팀 담당자 | 따로 없습니다. 팀 단위로 요청을 받습니다 |
| 개발 담당 | 개발자 1인이 모든 저장소를 직접 작업합니다. 키나 주소를 바꾸면 ddoga-api, ddoga-scheduler 설정도 같이 고칩니다 |
| 스테이징·파트너스 | 폐기됐습니다. ddoga-api의 `application-stg.yml` 배송추적 설정은 정리 대상입니다 |

### 인수인계 체크리스트

| # | 항목 | 받음 |
| --- | --- | --- |
| 1 | GitHub `ddogaapp` 관리자 계정 | ☑ |
| 2 | AWS 콘솔 계정 | ☑ |
| 3 | 서버 접속(bastion 경유)용 키 파일 | ☑ |
| 4 | 서버 위치와 실제 실행 상태(4-1 결과) | ☐ [Todo T1](#10-todo) |
| 5 | Docker Hub(회사 `ddoga` 조직, 이전 담당 개발자 개인 계정 이미지) | ☐ 개발팀장 문의 중([C4](#11-확인사항)) |
| 6 | 서버 재기동 방법·장애 대응 프로세스 | ☐ 개발팀장 문의 중([C4](#11-확인사항)) |
| 7 | 진행 중이던 요청이나 미반영 작업 목록 | ☑ 없음 |

---

## 10. Todo

직접 조치하거나 만들어야 하는 일입니다. 끝나면 ☑로 바꾸고 날짜를 적습니다.

| # | 할 일 | 내용 | 완료 |
| --- | --- | --- | --- |
| T1 | 서버 실제 상태 확인·기록 | 4-1 명령으로 어느 서버(인스턴스 이름), 컨테이너·이미지 태그, 포트, 재시작 정책, PM2 유무를 확인해 노션 허브에 적습니다. 지금 이미지에 `docker tag ... ddoga/delivery-tracker:legacy-gitlab`을 붙여 둡니다. 4-3 수동 배포를 한 번 실제로 해 보고 이 문서를 고칩니다 | ☐ |
| T2 | 재시작 정책·로그 제한 | `docker update --restart unless-stopped ddoga-container`. 로그 크기 제한은 컨테이너를 다시 만들 때(`--log-opt max-size=10m --log-opt max-file=10`, 4-3에 반영됨) 넣거나 서버 `/etc/docker/daemon.json`에 기본값으로 넣습니다 | ☐ |
| T3 | GitHub Actions 배포 만들기 | 다른 저장소처럼 서버에 self-hosted runner(예: 라벨 `delivery-tracker`)를 설치하고, `master` push 또는 수동 실행 시 서버에서 `docker build` → 컨테이너 교체 → `/health-check` 확인 → 실패 시 이전 컨테이너 복구까지 하는 workflow를 만듭니다(scheduler `deploy.sh` 참고). 이미지를 저장소에 올려야 하면 회사 Docker Hub `ddoga` 조직을 씁니다. 개인 Docker Hub 의존을 끊고 `paths-ignore: ['**.md', 'docs/**']`를 넣습니다 | ☐ |
| T4 | API 키를 코드에서 빼기 | `USABLE_KEYS`를 환경변수(예: `TRACKER_CLIENTS` JSON)나 서버의 파일에서 읽게 바꿉니다. 키를 새로 발급해 ddoga-api·scheduler 설정을 바꾼 뒤 예전 키를 지웁니다. 노션 「비밀값 관리와 키 교체」에 이 서비스 항목을 추가합니다 | ☐ |
| T5 | 장애 감지 | 최소한 서버 cron으로 `/health-check`를 확인합니다. 더 나아가 scheduler `DeliveryTrackerClient`가 예외를 삼키지 않고 경고 로그를 남기게 고칩니다(지금은 실패가 `delivered=false`로만 보임). 알림 채널은 scheduler 배치 실패 알림(scheduler 가이드 C6)과 함께 정합니다 | ☐ |
| T6 | 원본 오픈소스 동기화 절차 | C5에서 계속하기로 하면: `git remote add upstream <원본 저장소>` → `git fetch upstream` → 변경 확인(`git log HEAD..upstream/main -- packages/core`) → **`-X theirs` 없이** 병합하거나 필요한 택배사 커밋만 cherry-pick → 로컬에서 `pnpm build`와 주요 택배사 조회 확인 → 배포. 원본 저장소 주소와 주기를 이 문서 6-2에 적습니다 | ☐ |
| T7 | 저장소 정리 | `.gitlab-ci.yml` 삭제(개인 계정 이름, 개인 포크·GitLab 주소 포함), `.github/workflows/cla.yaml`·`.github/FUNDING.yml` 삭제, Dockerfile의 `pnpm@latest`를 lockfile과 맞는 버전으로 고정, 쓰지 않으면 `ecosystem.config.js` 삭제. README의 `api.ddoga.co.kr:4436` 주소는 C2 확인 후 고칩니다 | ☐ |
| T8 | 개발 환경 정리 | 개발용 배송추적이 필요한지 정합니다. 필요 없으면 ddoga-api 개발 설정도 운영 주소(별도 키)로, 필요하면 개발 서버에 컨테이너를 하나 띄웁니다. scheduler 개발·스테이징 설정(scheduler Todo T7)과 함께 정리합니다 | ☐ |
| T9 | ddoga-api `/tracking` 보호 | 로그인 사용자만 쓰게 하거나 호출 횟수 제한을 넣습니다. 택배사가 또가 서버 IP를 차단하면 모든 조회가 멈춥니다 | ☐ |
| T10 | 긴급 대응 방식 설계 | 누가 먼저 알게 되는지, 연락 경로, 업무시간 외 범위, 첫 조치(헬스체크 → 로그 → 재기동 → 롤백)를 정해 8장에 적습니다. admin Todo T14와 함께 정합니다 | ☐ |

## 11. 확인사항

사람에게 묻거나 정해야 하는 일입니다.

| # | 확인할 것 | 내용 | 결과 |
| --- | --- | --- | --- |
| C1 | 운영 서버 위치 | delivery-tracker가 어느 EC2에 있는지(전용인지, 다른 서비스와 함께인지). 노션 허브 서버 표에 있는지 | |
| C2 | 공개 주소와 앞단 | `delivery.ddoga.co.kr`이 ALB를 거쳐 이 서버 8000으로 가는지, 보안그룹에서 8000을 어디까지 여는지. README의 `api.ddoga.co.kr:4436/track/...`이 아직 살아 있는지 | |
| C3 | `IMS` 키 사용처 | `IMS` 이름의 키를 쓰는 시스템(IMS 관련 저장소 등)이 있는지. 없으면 T4 때 지웁니다 | |
| C4 | 서버 운영 계정·재기동·장애 대응, Docker Hub | 서버별 개발자용 운영 계정, 재기동 방법, 장애 발견·대응 프로세스, 회사 Docker Hub(`ddoga` 조직) 계정, 이전 담당 개발자 개인 Docker Hub 이미지 처리 | 개발팀장 문의 중(2026-11-03) |
| C5 | 원본 오픈소스 동기화 유지 여부 | 택배사 사이트가 바뀌면 조회가 깨지므로 원본 수정을 계속 받을지, 주기(예: 월 1회 + 장애 시)와 원본 저장소 주소를 정합니다. 라이선스(Elastic 2.0) 조건도 함께 봅니다 | |
| C6 | GitHub 저장소 공개 여부 | `ddogaapp/delivery-tracker`가 공개 저장소인지. 공개라면 코드의 API 키가 노출된 것이므로 T4를 먼저 합니다 | 비공개 저장소, fork 아님(2026-11-03 `gh repo view`로 확인). T4는 일반 우선순위로 진행 |
