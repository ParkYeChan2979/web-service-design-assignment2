# 과제 2 신청 승인 서비스: 업무 규칙과 트랜잭션

신청·대기 취소·직접 승인·승인 취소·대기열 자동 승급·변경 이력을 구현한 제출 저장소입니다. 과제 안내문은 배포 ZIP의 `01_과제2_안내문.pdf`, 상태·이력·입출력 계약은 [API 계약](docs/API.md)에 있습니다.

**제출 마감: 2026년 11월 25일 23:59 (한국 시간)**

> **구현 상태 요약**: TODO 4개(`apply`·`cancel`·`approve`·`revoke`)와 트랜잭션 처리를 모두 구현했습니다.
> `npm test` 4/4, `npm run test:assignment` 32/32, `npm run test:advanced`(선택) 1/1 통과. 화면 검증 U01~U05 완료.
> 보고서: [docs/report.pdf](docs/report.pdf) · 자세한 내용은 아래 [제출 정보](#제출-정보) 참고.

## 실행

Node.js **24.x**와 npm이 필요합니다. Node.js 20은 지원하지 않습니다. SQLite는 Node 내장 모듈입니다.

```sh
node --version
npm ci
npm test
npm start
```

http://127.0.0.1:3000 에 접속합니다. Ctrl+C로 종료합니다.

- 포트 사용 중: 기존 실행 터미널을 종료하거나 다른 포트를 사용합니다.
- macOS / Linux: `PORT=3001 npm start`
- Windows PowerShell: `$env:PORT="3001"; npm start`
- 첫 실행: `data/app.sqlite`와 `data/jwt-secret.txt`가 자동 생성됩니다.
- 브라우저 로그인 토큰은 메모리에만 저장합니다. 새로고침 후 다시 로그인하세요. DB 데이터는 유지됩니다.

## 연습 계정

공통 비밀번호는 `Classroom123!`입니다. 실제 이용자가 아닌 가상 계정입니다.

|아이디|이름|역할|
|---|---|---|
|alice|민지|학생|
|bob|준호|학생|
|charlie|서연|학생|
|manager1|운영자 A|행사 1 담당 · 정원 2명|
|manager2|운영자 B|행사 2 담당 · 정원 1명|

로그인 화면의 계정 버튼으로 입력값을 채우고 로그인 버튼을 누릅니다. 각 탭은 별도 토큰을 사용하므로 일반 탭 여러 개로 역할을 나눌 수 있습니다.

## 제공 코드와 구현할 부분

로그인·JWT 인증, 스키마와 가상 계정, 조회 API와 권한 검사, 입력 형식 검사, 기본 화면, SQL 조회·저장 도구를 제공합니다.

`src/application-service.js`의 TODO 4개는 초기 상태에서 501을 반환합니다.

1. `apply`: 행사·학생·중복 검사, PENDING 저장과 APPLY 이력
2. `cancel`: 학생 본인의 PENDING 취소, CANCELLED와 CANCEL 이력
3. `approve`: 담당자·상태·정원 검사, APPROVED와 APPROVE 이력
4. `revoke`: 담당자의 승인 취소, 다음 대기자 1명 승급, 두 이력의 원인 연결

모든 상태 변경과 이력 저장을 트랜잭션으로 묶으세요. 특히 revoke에서는 신청 2건과 이력 2건의 부분 저장을 막아야 합니다. 대기자 선택, 업무 규칙, 이력 저장 시점, 트랜잭션 경계는 학생 구현입니다. repository 함수 자체는 권한을 검사하지 않습니다. 보조 함수·SQL·파일은 필요하면 추가할 수 있습니다.

## 테스트

```sh
npm test
npm run test:assignment
npm run test:advanced
```

- `npm test`: 제공 기반 기능 4개. 구현 전과 후 모두 통과해야 합니다.
- `test:assignment`: 필수 32개. TODO 구현 전 일부 실패가 정상입니다.
- `test:advanced`: 선택 심화. 서버 2개가 마지막 자리를 동시에 승인하는 검사를 20회 수행합니다. 미수행은 감점하지 않습니다.

테스트는 별도 임시 DB·포트를 사용합니다. 필수 테스트 T28~T30은 임시 DB 트리거로 이력 저장 실패를 주입합니다. `TEST_INJECTED_FAILURE` 로그는 이 검사의 의도된 오류입니다. HTTP 500뿐 아니라 상태·이력 전체가 요청 전과 같은지 검사합니다. 테스트가 오류를 흉내 내므로 실제 서비스 코드에 특별 처리를 넣지 마세요. 기대값 변경이나 테스트 삭제는 허용하지 않습니다.

## 화면 검증

- U01: alice 신청 → manager1 승인 → 학생이 최신 상태 확인.
- U02: 운영자가 대기 목록 조회 → 학생이 대기 취소 → 오래된 운영자 화면의 승인 거부(409)와 CANCELLED 유지.
- U03: 서버 종료·재실행 → 재로그인 → 신청 상태와 이력 유지.
- U04: 새 DB에서 행사 2에 alice·bob·charlie 순서로 신청 → manager2가 alice 승인 → alice 승인 취소(사유 입력) → bob 자동 승인, charlie 대기 유지 → alice와 bob의 변경 이력에서 원인 ID 연결 확인.
- U05: 새 DB에서 alice만 행사 2 신청·승인 → 승인 취소 → REVOKED, 승인 인원 0명, 응답 promoted=null 확인.

승인 취소는 담당 운영자 화면의 승인된 신청에서 수행합니다. 각 신청의 ‘변경 이력 보기’로 저장 결과를 확인합니다. 다른 탭의 변경은 자동 반영되지 않으므로 ‘최신 정보 새로고침’을 사용하세요.

## DB 초기화와 이전 코드에서의 전환

서버를 먼저 종료하고 아래 명령에서 `RESET`을 입력합니다. 신청·변경 이력을 지우고 초기 계정·행사를 다시 만듭니다.

```sh
npm run db:reset
```

이전 배포본 DB에는 REVOKED 상태와 변경 이력 스키마가 없습니다. 새 배포본에서는 기존 DB를 초기화하세요. 운영 데이터 마이그레이션은 이 과제 범위가 아닙니다.

선택 환경변수: PORT, DB_PATH, JWT_SECRET. 기본 실행에는 설정 파일이 필요 없습니다. 키 파일을 지우면 기존 토큰은 무효화됩니다.

## 파일 구조

- `src/application-service.js`: 학생 구현 TODO 4개와 트랜잭션
- `src/repository.js`: 조회·저장·이력 저장 도구
- `src/db.js`: SQLite 스키마·초기 데이터
- `src/auth.js`: JWT 인증
- `src/app.js`: 라우팅·형식 검사·조회 권한·오류 응답
- `src/server.js`: 로컬 서버
- `public/`: 승인 취소·이력 조회 포함 제공 화면
- `tests/`: 기반·필수·선택 심화 테스트
- `docs/API.md`: 상태·이력·입출력 계약

## 제출 정보

### 서비스 소개

학생이 행사에 참가를 신청하고 담당 운영자가 승인하는 서비스입니다. 이번 과제에서 업무 규칙을 서버에 구현했습니다.

- 학생은 신청하고, 자기 대기 신청만 취소할 수 있습니다.
- 담당 운영자는 정원 안에서 직접 승인하고, 승인을 취소할 수 있습니다.
- 승인을 취소하면 같은 행사에서 가장 먼저 대기한 1명(`created_at ASC, id ASC`)이 같은 트랜잭션 안에서 자동 승인됩니다.
- 성공한 상태 변경은 모두 `application_history`에 기록됩니다. 자동 승인 이력은 원인이 된 승인 취소 이력 ID(`causeHistoryId`)를 가리킵니다.
- 상태 저장이나 이력 저장 중 하나라도 실패하면 그 요청의 변경 전체가 롤백됩니다.

### 구현 완료 여부

|항목|상태|
|---|---|
|TODO-01 `apply`: 행사 존재·학생 역할·중복 검사, PENDING + APPLY 이력|완료|
|TODO-02 `cancel`: 본인·PENDING 검사, CANCELLED + CANCEL 이력|완료|
|TODO-03 `approve`: 담당자·PENDING·정원 검사, APPROVED + APPROVE 이력|완료|
|TODO-04 `revoke`: 담당자·APPROVED 검사, REVOKED + REVOKE 이력, 대기자 1명 AUTO_APPROVE + 원인 이력 연결|완료|
|모든 변경의 트랜잭션·롤백 (R7)|완료|
|필수 테스트 T01~T32|32/32 통과|
|화면 검증 U01~U05|완료 (캡처 34장)|
|선택 심화: 서버 2개 동시 승인 20회|통과 (보호 방식과 한계는 보고서와 아래 "알려진 한계" 참고)|

### 변경 파일 (제공 코드와 직접 구현한 부분의 구분)

제공 시작 코드와 비교했을 때 바뀐 파일은 아래뿐입니다. 테스트 파일(`tests/`)과 `src/app.js`·`src/auth.js`·`src/db.js`·`src/errors.js`·`package.json`·`package-lock.json`은 수정하지 않았습니다.

|파일|구분|내용|
|---|---|---|
|`src/application-service.js`|직접 구현|TODO 4개 구현. `inTransaction()`으로 요청마다 `BEGIN IMMEDIATE` … `COMMIT`, 예외가 나면 `ROLLBACK`. 검사 순서는 존재(404) → 권한(403) → 상태·중복(409) → 정원(409). `UNIQUE` 위반은 409 `ALREADY_APPLIED`로 변환|
|`src/repository.js`|함수 1개 추가|`nextPending(eventId)`: 같은 행사 PENDING 중 `ORDER BY created_at ASC, id ASC LIMIT 1`. 나머지 함수는 제공 코드 그대로|
|`src/server.js`|문구 1줄 수정|서버 시작 메시지의 "TODO 구현 전 501" 안내를 구현 완료 문구로 변경|
|`public/index.html`|문구 1줄 수정|첫 화면 알림의 "TODO 구현 전 501" 안내를 현재 동작 설명으로 변경|
|`README.md`|작성|이 "제출 정보" 절과 상단 요약 추가|
|`docs/report.pdf`|추가|보고서|
|`docs/evidence/`|추가|테스트 실행 로그와 비교 실험 로그|
|`docs/screenshots/`|추가|자동 테스트·화면 검증 캡처 34장|

### 실행 환경

- macOS (Apple Silicon, arm64), Node.js v24.15.0, npm 11.12.1
- 의존성: `express` 5.3.0, `jsonwebtoken` 9.0.3 (`package-lock.json`으로 고정). DB는 Node 내장 `node:sqlite`

### 새 폴더에서 재현하는 방법

```sh
git clone <이 저장소 URL> assignment2 && cd assignment2
node --version            # v24.x 확인
npm ci
npm test                  # 기반 4/4
npm run test:assignment   # 필수 32/32 (TEST_INJECTED_FAILURE 로그는 T28~T30의 의도된 실패 주입)
npm run test:advanced     # 선택 심화 1/1
npm start                 # http://127.0.0.1:3000, 종료는 Ctrl+C
```

DB를 처음 상태로 되돌리려면 서버를 끈 뒤 `npm run db:reset`을 실행하고 `RESET`을 입력합니다. `data/app.sqlite`와 `data/jwt-secret.txt`는 첫 실행 때 자동 생성되며 저장소에 포함하지 않습니다(`.gitignore`).

### 검증 증거

- 테스트 로그: [docs/evidence/test-starter.txt](docs/evidence/test-starter.txt), [test-assignment.txt](docs/evidence/test-assignment.txt), [test-advanced.txt](docs/evidence/test-advanced.txt)
- 비교 실험: [docs/evidence/control-deferred-begin.txt](docs/evidence/control-deferred-begin.txt). `BEGIN IMMEDIATE`를 일반 `BEGIN`으로 바꾼 임시 사본(제출 코드 아님)에서는 동시 승인 중 한 요청이 500으로 실패했습니다.
- 캡처: [docs/screenshots/](docs/screenshots/)
  - `S01`~`S03`: 자동 테스트 결과
  - `U01-*`~`U05-*`: 화면 검증 단계별 캡처
  - 화면 캡처의 응답 패널에는 토큰이 표시되지 않습니다.

### 알려진 한계

- **쓰기 요청의 직렬화**: 모든 변경 요청이 `BEGIN IMMEDIATE`로 DB 쓰기 잠금을 잡습니다. 그래서 같은 DB 파일을 쓰는 프로세스가 여럿이어도 검사와 저장 사이에 다른 요청이 끼어들지 못합니다. 그 대가로 쓰기는 한 번에 하나씩 처리됩니다. 잠금 대기가 `busy_timeout`(5초)을 넘으면 그 요청은 500으로 실패하고, 데이터는 바뀌지 않습니다.
- **선택 심화 테스트의 의미**: 20회 반복 성공은 모든 경쟁 상황이 없다는 증명이 아닙니다. 보호 근거는 반복 결과가 아니라 SQLite의 잠금 방식입니다.
- **화면 갱신**: 제공 화면은 다른 탭의 변경을 자동으로 반영하지 않습니다. 오래된 화면에서 보낸 요청은 서버가 최신 상태로 다시 검사해서 409로 거부합니다(U02).

### AI 사용 요약

Claude Code(Anthropic, 모델 Claude Opus 5.5)를 사용했습니다. 자세한 내용은 보고서의 "AI 활용과 참고 자료"에 적었습니다.

|적용 위치|AI가 한 일|직접 한 일·검증|
|---|---|---|
|`src/application-service.js` 전체, `src/repository.js`의 `nextPending`|안내문과 API 계약을 바탕으로 구현 코드 작성|구현 코드를 직접 읽고 검토. `npm test`·`test:assignment`·`test:advanced`를 직접 실행해 결과 확인 (S01~S03)|
|`src/server.js`, `public/index.html` 문구|오래된 안내 문구 수정 제안·반영|화면과 터미널에서 바뀐 문구 확인 (U03-1, U03-3)|
|`docs/evidence/`|테스트 로그 저장, `BEGIN` 비교 실험 수행|로그 내용 확인|
|화면 검증 U01~U05|단계별 절차 안내와 캡처 내용 점검|브라우저 조작과 캡처 34장은 모두 직접 수행|
|`README.md`, 보고서 초안|초안 작성|내용을 검토하고 최종본 확정|

참고 자료: 과제 안내문, [docs/API.md](docs/API.md), [Node.js SQLite 문서](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [SQLite BEGIN TRANSACTION 문서](https://www.sqlite.org/lang_transaction.html)

## 참고 문서

- [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Express API](https://expressjs.com/en/5x/api/)
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)
