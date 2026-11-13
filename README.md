# Lattice Feedback SDK

고객사 페이지에 스크립트를 삽입해 피드백을 받는 Next.js 앱입니다.
텍스트와 함께 **Comment**(요소에 의견 남기기), **Edit**(위치 변경 제안),
**Flow**(조작 흐름 기록)를 첨부할 수 있습니다.
**현재 화면 저장**으로 보고 있는 화면(DOM·CSS·글꼴·이미지)을 그대로 저장해 함께 보낼 수도 있고,
관리자는 저장된 화면을 뷰어에서 다시 볼 수 있습니다.

호스트 페이지의 SDK가 화면 저장, 요소 선택과 기록을 담당하고, 다른 출처의 iframe에서
피드백을 작성·전송합니다. 관리자 기능은 **API로 제공**하며,
관리자 화면은 현재 저장된 화면 뷰어(`/admin/snapshots/{id}`)만 있습니다.
Comment / Edit / Flow는 아직 저장된 화면 위에서 동작하지 않고 기존의 요소 정보 방식으로 동작합니다.

## 1. 준비

- Node.js **20.9.0 이상**과 npm
- 이 저장소의 기능 통합 버전인 `dev` 브랜치
- 영구 저장이 필요할 때만 Supabase 개발 프로젝트

명령은 별도 안내가 없으면 이 저장소 루트에서 실행합니다.

```sh
npm ci
```

처음 실행한다면 환경변수 예시를 복사합니다. 이미 `.env.local`이 있다면 덮어쓰지 말고
필요한 항목만 수정하세요.

```sh
cp -n .env.example .env.local
```

## 2. DB 없이 바로 실행

`.env.local`에 다음 값을 설정합니다. `FEEDBACK_CAPTURE_POLICY`는 줄바꿈 없이 한 줄로 넣습니다.
이 정책은 아래의 Flow 테스트 페이지와 제공 데모에서 사용하는 경로·요소를 허용합니다.

```dotenv
FEEDBACK_STORAGE=memory
FEEDBACK_APP_ORIGINS=http://localhost:3000
FEEDBACK_ALLOWED_ORIGINS=http://localhost:4000,http://localhost:4001
FEEDBACK_ADMIN_TOKEN=local-demo-admin-token
FEEDBACK_CAPTURE_POLICY={"allowedPaths":["/","/first/","/second/"],"targets":[{"id":"main-action","selector":"main button"},{"id":"quick-action","selector":".demoQuickAction"},{"id":"row-selection","selector":"main input[type=\"checkbox\"]"},{"id":"test-input","selector":"[data-feedback-id=\"test-input\"]"},{"id":"save-button","selector":"[data-feedback-id=\"save-button\"]"},{"id":"next-page","selector":"[data-feedback-id=\"next-page\"]"}]}
```

`local-demo-admin-token`은 로컬 확인용 예시입니다. 운영에서는 별도의 긴 임의 값을 사용합니다.
메모리 모드에서는 서버를 다시 시작하면 피드백이 사라집니다.

**터미널 1 — SDK와 API 서버**

```sh
npm run dev
```

**터미널 2 — 저장소에 포함된 테스트 페이지**

```sh
npx --yes serve examples/flow-pages --listen 4001 --no-clipboard
```

브라우저에서 `http://localhost:4001/first/`를 엽니다.
우하단 **Feedback** 버튼을 누르면 위젯을 사용할 수 있습니다.
`npx serve`는 처음 실행할 때 정적 서버 도구를 다운로드할 수 있습니다.

| 주소 | 용도 |
| --- | --- |
| `http://localhost:3000` | 앱 안내 페이지 |
| `http://localhost:3000/sdk.js` | 호스트 페이지에 삽입하는 SDK |
| `http://localhost:4001/first/` | 세 모드와 새로고침 테스트 |
| `http://localhost:4001/second/` | Flow 문서 이동 테스트 |

위젯은 호스트 페이지의 Feedback 버튼으로 여세요.
`/widget`만 단독으로 열면 호스트 초기화 메시지를 받지 못합니다.

### 기능 확인

1. **텍스트:** 내용을 입력하고 보내기를 누릅니다. 모드 사용은 필수가 아닙니다.
2. **Comment:** `요소 코멘트` → 페이지의 저장 버튼 선택 → 의견 작성 → `코멘트 첨부`.
3. **Edit:** `위치 편집` → 저장 버튼 선택 → 미리보기 드래그 → `변경 첨부`.
   원본 요소의 위치는 바뀌지 않습니다. Escape나 취소 버튼으로 종료할 수 있습니다.
4. **Flow:** `흐름 기록` → 입력·버튼 클릭 → 새로고침 → `다음 문서로 이동` →
   호스트 표시기의 `기록 종료`. 입력한 값은 수집하지 않고 입력 발생 여부만 기록합니다.
5. **화면 저장:** `현재 화면 저장`을 누르면 지금 화면이 저장되어 목록에 추가됩니다(피드백당 최대 5개).
   비밀번호 입력값, `<script>`·인라인 이벤트 핸들러, `data-lattice-block` 영역은 저장하지 않고,
   `data-lattice-mask` 영역의 텍스트와 입력값은 `*`로 가립니다. 그 밖의 입력값은 화면에 보이는 대로 저장됩니다.
6. 하나의 피드백에 모드별 자료와 저장한 화면을 함께 첨부하고 전송한 뒤 아래 관리자 API로 확인합니다.

Flow는 같은 탭·출처에서 새로고침과 문서 이동 후에도 이어집니다.
본문·댓글과 다른 첨부의 초안 복원은 지원하지 않으므로,
**새로고침·문서 이동을 시험할 때는 Flow를 먼저 기록하고 나머지 내용을 작성하세요.**

## 3. 래티스 제공 데모에 붙이기

제공 데모 저장소는 `https://github.com/yejinhann/feedback-sdk-demo-page`입니다.
자신의 포크를 별도 폴더에 준비하고, `index.html`의 SDK 삽입용 주석 아래에 다음을 추가합니다.
기존 assets를 수정하거나 데모를 다시 빌드할 필요는 없습니다.

```html
<script
  src="http://localhost:3000/sdk.js"
  data-project-key="demo"
  data-capture-policy='{"allowedPaths":["/"],"targets":[{"id":"main-action","selector":"main button"},{"id":"quick-action","selector":".demoQuickAction"},{"id":"row-selection","selector":"main input[type=\"checkbox\"]"}]}'
  onload="window.LatticeFeedback.setUser(window.DEMO_USER)"
></script>
```

제공 데모 저장소 폴더에서 실행합니다. SDK 서버는 계속 실행 중이어야 합니다.

```sh
npx --yes serve . --listen 4000 --no-clipboard
```

`http://localhost:4000`에 접속해 Feedback 버튼을 누릅니다.
이 데모는 기존 버튼과 체크박스로 선택·편집·기록 및 새로고침을 확인하는 용도입니다.
전체 문서 이동은 위의 `/first/` → `/second/` 테스트 페이지에서 확인합니다.

텍스트 전송만 간단히 확인하려면 제공 데모 대신, SDK 저장소 루트에서 다음을 실행해도 됩니다.
이 기본 예제에는 수집 정책이 없으므로 모드 첨부는 비활성화됩니다.
두 페이지 서버를 동시에 같은 4000번 포트로 실행하지 마세요.

```sh
npx --yes serve examples/host-page --listen 4000 --no-clipboard
```

## 4. 저장된 피드백 확인

현재 등록된 프로젝트 키는 `demo`입니다.
관리자 API에는 `.env.local`의 `FEEDBACK_ADMIN_TOKEN`과 같은 Bearer 토큰이 필요합니다.
다음 예시는 위의 로컬 설정을 기준으로 합니다.

```sh
curl --fail-with-body \
  'http://localhost:3000/api/feedback?projectKey=demo' \
  -H 'Authorization: Bearer local-demo-admin-token'
```

응답의 `items`에서 피드백 ID와 `attachments`를 확인합니다.

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| GET | `/api/feedback?projectKey=demo` | 목록 조회 |
| GET | `/api/feedback/{id}?projectKey=demo` | 상세 조회 |
| PATCH | `/api/feedback/{id}?projectKey=demo` | 상태·관리자 답변 수정 |

`{id}`는 목록에서 받은 실제 ID로 바꿉니다.
관리자 토큰과 Supabase 서버 키를 호스트 HTML이나 SDK 설정에 넣지 마세요.

### 저장된 화면 보기

피드백 상세 응답의 `screenSnapshots`에 함께 보낸 화면의 ID가 들어 있습니다.
브라우저에서 다음 주소를 열고 관리자 토큰을 입력하면 저장된 화면이 재현됩니다.

```text
http://localhost:3000/admin/snapshots/{화면 ID}?projectKey=demo
```

- 화면은 스크립트가 실행되지 않는 sandbox iframe 안에, 저장할 때의 뷰포트 크기로 재현됩니다.
- `화면에 맞춤` / `실제 크기`로 배율을 바꾸고, 마우스 휠로 저장된 화면 안을 스크롤할 수 있습니다.
- 가져오지 못한 글꼴·이미지가 있으면 뷰어 위쪽에 목록으로 표시됩니다.
- 위젯에서 **요소 코멘트**를 첨부하면 그 순간의 화면이 자동으로 저장되고, 뷰어에서 해당 요소 위에 번호 핀과 말풍선으로 표시됩니다. 같은 페이지에 코멘트를 더 달면 코멘트 화면 하나가 모든 핀을 담도록 교체됩니다.
- 토큰은 탭을 닫을 때까지만 브라우저의 sessionStorage에 보관됩니다.

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| POST | `/api/snapshots` | 위젯이 저장한 화면 업로드(최대 4 MB, 글꼴·이미지 제외) |
| POST | `/api/snapshots/assets` | 프로젝트에 아직 없는 글꼴·이미지 해시 확인 |
| PUT | `/api/snapshots/assets/{sha256}` | 글꼴·이미지 파일 업로드(파일당 최대 3 MB) |
| GET | `/api/snapshots/assets/{sha256}?projectKey=demo` | 저장된 파일 조회(관리자 토큰 필요) |

같은 사이트의 글꼴·이미지는 화면과 따로 프로젝트당 한 번만 저장되므로, 두 번째 화면부터는 DOM·CSS만 전송합니다.
| GET | `/api/snapshots/{id}?projectKey=demo` | 저장된 화면 전체 조회(관리자 토큰 필요) |

저장된 화면은 피드백과 같은 저장소(`FEEDBACK_STORAGE`)에 보관됩니다.
메모리 모드에서는 프로젝트당 50개까지 보관하고, 서버를 다시 시작하면 사라집니다.

## 5. Supabase로 영구 저장

메모리 대신 Supabase를 사용하려면 다음 순서로 설정합니다.

1. Supabase 개발 프로젝트에서 `supabase/migrations/`의 SQL 파일을 이름 순서대로 적용합니다.
   기존 테이블이 있다면 먼저 스키마를 비교합니다.
   화면 저장 테이블(`20261113000000-create-screen-snapshots.sql`, `20261113010000-create-screen-snapshot-assets.sql`)이 없으면
   피드백 상세 조회와 화면 저장이 503을 반환합니다.
2. `.env.local`의 저장소 설정을 다음과 같이 바꿉니다.
3. Next.js 서버를 다시 시작하고 피드백 전송·목록 조회를 확인합니다.
4. 서버를 재시작해 같은 피드백이 남아 있는지 확인합니다.

```dotenv
FEEDBACK_STORAGE=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your-server-key
```

예시 값은 실제 프로젝트 값으로 바꿉니다. 이 구현은 `sb_secret_...` 형식의 서버 키를
사용하며 공개 키나 기존 JWT 형태의 service_role 키를 설정값으로 받지 않습니다.
설정·DB 오류가 나면 503을 반환하고 메모리 저장소로 자동 전환하지 않습니다.

SQL 적용, 권한 및 실제 DB 확인 절차는 `docs/supabase-setup.md`를 참고하세요.
`.env.local`과 시크릿은 커밋하지 않습니다.

## 6. 빌드와 검증

```sh
npm run build
npx tsc --noEmit
npm run lint
npm test
```

빌드 후 production 모드로 실행하려면:

```sh
npm start
```

개발 서버와 production 서버는 같은 포트를 사용하므로 기존 서버를 먼저 종료합니다.
`FEEDBACK_STORAGE`를 생략하면 개발·테스트에서는 memory,
production에서는 supabase가 기본값입니다.
DB 없이 production 빌드를 확인하려면 `.env.local`의 `FEEDBACK_STORAGE=memory`를 유지하세요.
production 관리자 API는 `FEEDBACK_ADMIN_TOKEN`이 없으면 잠깁니다.

### SDK 소스를 수정할 때

`npm run dev`는 시작할 때 SDK를 한 번 번들링합니다.
개발 서버가 실행 중일 때 `src/sdk` 또는 SDK가 가져오는 공통 코드를 수정했다면:

```sh
npm run build:sdk
```

그다음 **호스트 페이지를 새로고침**합니다. `public/sdk.js`는 생성 파일이므로 직접 수정하지 않습니다.
환경변수를 수정했을 때는 Next.js 서버도 다시 시작합니다.

## 자주 막히는 부분

| 증상 | 확인할 항목 |
| --- | --- |
| 위젯이 뜨지 않음 | 3000번 서버와 `/sdk.js` 응답, 스크립트 삽입 위치, `data-project-key="demo"` |
| 텍스트만 되고 모드가 비활성화됨 | 호스트의 `data-capture-policy`, 현재 경로의 `allowedPaths` 포함 여부 |
| 첨부 전송이 403 | 서버 `FEEDBACK_CAPTURE_POLICY`에 호스트가 쓰는 경로·ID·selector가 모두 있는지 확인 |
| `origin_not_allowed` | `FEEDBACK_ALLOWED_ORIGINS`에 실제 호스트 origin이 있는지 확인 |
| 관리자 조회가 401 | Bearer 토큰과 `FEEDBACK_ADMIN_TOKEN` 일치 여부 |
| `storage_unavailable` / 503 | 저장소 모드, Supabase URL·서버 키·SQL 적용 여부 |
| 수정한 SDK가 반영되지 않음 | `npm run build:sdk` 후 호스트 새로고침 |
| 화면 저장이 "이 페이지에서는 저장할 수 없습니다" | 수집 정책을 쓰는 경우 현재 경로가 `allowedPaths`에 있는지 확인 |
| 화면 저장이 "저장소를 사용할 수 없습니다" | Supabase 모드라면 화면 저장 마이그레이션을 적용했는지 확인 |

origin은 포트까지 정확히 일치해야 하며 끝에 `/`를 붙이지 않습니다.
`localhost`와 `127.0.0.1`도 서로 다른 origin입니다.
수집 허용 경로는 `/first/`처럼 pathname과 정확히 일치해야 합니다.
허용되지 않은 페이지로 이동했다면 허용 페이지로 돌아가거나 첨부를 제거한 뒤 전송합니다.

운영 배포 시에는 SDK 앱과 호스트 데모를 서로 다른 주소에 배포하고,
스크립트의 `src`, `FEEDBACK_APP_ORIGINS`, `FEEDBACK_ALLOWED_ORIGINS`를 실제 주소로 변경합니다.
