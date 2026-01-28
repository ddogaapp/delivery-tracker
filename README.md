# 📦 Delivery Tracker (택배 송장 추적 서비스)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg)](https://pnpm.io/)
[![pipeline status](http://gitlab.hecton.co.kr:8090/ddoga/delivery-tracker/badges/master/pipeline.svg)](http://gitlab.hecton.co.kr:8090/ddoga/delivery-tracker/-/commits/master)

다양한 택배사의 배송 상태를 통합하여 추적할 수 있는 GraphQL API 서비스입니다. 국내외 주요 택배사를 지원하며, 확장이 용이한 구조로 설계되었습니다.

## ✨ 주요 특징

- **통합 추적**: 국내외 30개 이상의 택배사 지원.
- **GraphQL API**: 현대적인 API 인터페이스를 통한 효율적인 데이터 쿼리.
- **Monorepo 구조**: `pnpm workspace`를 활용한 모듈화된 프로젝트 관리.

## 🏗️ 프로젝트 구조

프로젝트는 다음과 같은 패키지로 구성되어 있습니다:

- [`packages/core`](./packages/core): 각 택배사별 스크래핑 로직 및 핵심 비즈니스 로직.
- [`packages/api`](./packages/api): GraphQL 스키마 및 리졸버 정의.
- [`packages/server`](./packages/server): Apollo Server 기반의 GraphQL HTTP 서버.

## 🚀 시작하기

### 사전 준비 사항

- Node.js >= 18
- pnpm >= 8

### 설치 및 빌드

```bash
# 의존성 설치
pnpm install

# 전체 프로젝트 빌드
pnpm build
```

### 개발 서버 실행

```bash
# 서버 패키지 실행 (기본 포트: 4000)
pnpm dev
```
서버가 실행되면 `http://localhost:4000`에서 GraphQL Playground를 통해 API를 테스트할 수 있습니다.

### 운영 서버 설정

```bash
# aws 초기 스크립트 docker 설치
sudo apt-get update
sudo apt-get install -y docker.io
sudo usermod -aG docker ubuntu

# 프로세스 확인
docker ps
```

## API 목록
### 1. 송장 추적 조회: https://api.ddoga.co.kr:4436/track/{carrier}/{trackerNumber}
### 2. 송장 최종 상태 조회: https://api.ddoga.co.kr:4436/track/last/{carrier}/{trackerNumber}
### 3. 지원 택배사 목록 조회: http://localhost:4000/track/carriers

## 🚚 지원 택배사

현재 다음을 포함한 **33개**의 국내외 택배사를 지원합니다. ([지원 택배사 전체목록](https://api.ddoga.co.kr:4436/track/carriers))

### 🇰🇷 국내 택배
- CJ대한통운 (`kr.cjlogistics`)
- 우체국택배 (`kr.epost`)
- 한진택배 (`kr.hanjin`)
- 롯데택배 (`kr.lotte`)
- 로젠택배 (`kr.logen`)
- 쿠팡 로지스틱스 (`kr.coupangls`)
- CU 편의점택배 (`kr.cvsnet`)
- 대신택배 (`kr.daesin`)
- 경동택배 (`kr.kdexp`)
- 합동택배 (`kr.ltl`)
- 일양로지스 (`kr.ilyanglogis`)
- 천일택배 (`kr.chunilps`)
- ... 그 외 다수

### 해외 택배
- DHL (`us.dhl`)
- FedEx (`us.fedex`)
- USPS (`us.usps`)
- ... 그 외 다수

## 💡 추가 정보
- **API 문서**: [tracker.delivery/docs](https://tracker.delivery/docs)
- **CI/CD**: 오픈 소스를 `매주 화요일 02시`에 자동으로 동기화 하고, GitLab CI/CD를 활용하여 자동 배포됩니다.

## 📄 라이선스

이 프로젝트는 [MIT License](./LICENSE)를 따릅니다.
