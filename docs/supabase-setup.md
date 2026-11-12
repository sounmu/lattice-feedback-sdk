# Supabase 저장소 설정

## 구조

브라우저는 기존 Next.js API에만 요청한다. 서버는 Supabase Data API의
`public.feedback` 테이블을 사용한다. 기존 저장소 인터페이스와 API 응답을 유지한다.
추가 패키지 없이 프로젝트에서 사용 중인 `fetch`로 REST 요청을 보낸다.
요청에는 10초 제한을 두며, 오류 응답과 잘못된 응답 형식은 503으로 처리한다.
생성 요청은 중복 저장을 피하기 위해 자동 재시도하지 않는다.

서버용 Secret key는 RLS를 우회한다. 따라서 모든 목록·상세·수정 쿼리에
`project_key` 조건을 넣고, 기존 관리자 인증을 먼저 거친다.
DB에는 RLS를 켜고 `anon`과 `authenticated` 역할의 테이블 권한을 제거한다.
이 설정은 고객 사용자 인증을 추가하는 기능은 아니다.

## DB 적용

1. Supabase 개발 프로젝트를 준비한다.
2. SQL Editor에서 `supabase/migrations/20261112000000-create-feedback.sql`을 한 번 실행한다.
   기존 테이블을 덮어쓰거나 삭제하지 않는다. 이미 `public.feedback`이 있다면 실행 전에 스키마를 비교한다.
3. Project URL과 `sb_secret_...` 형식의 Secret key를 확인한다.
   공개용 `sb_publishable_...` 키나 기존 JWT 형태의 service_role 키는 이 구현의 설정 대상이 아니다.
4. 다음 값을 로컬 `.env.local` 또는 배포 환경의 서버 전용 환경변수에 설정한다.

```dotenv
FEEDBACK_STORAGE=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your-server-key
FEEDBACK_ADMIN_TOKEN=your-admin-token
FEEDBACK_APP_ORIGINS=http://localhost:3000
FEEDBACK_ALLOWED_ORIGINS=http://localhost:4000
```

예시 키와 토큰은 실제 값으로 바꾼다. `.env.local`과 키는 커밋하지 않는다.
어떤 키에도 `NEXT_PUBLIC_` 접두사를 붙이지 않는다.
운영 배포 시 두 origin 설정은 각각 앱 주소와 고객사 데모 주소로 바꾼다.

`FEEDBACK_STORAGE`를 생략하면 개발·테스트에서는 memory, production에서는 supabase를 사용한다.
DB 설정 오류나 DB 장애가 생겨도 메모리 저장으로 전환하지 않는다.
배포 없이 기존 로컬 데모만 확인하려면 명시적으로 `FEEDBACK_STORAGE=memory`를 사용할 수 있다.
이 모드의 데이터는 재시작하면 사라진다.

## 확인 절차

```sh
npx tsc --noEmit
npm run lint
npm test
npm run build
npm start
```

다른 터미널에서 `examples/host-page`를 4000번 포트로 제공한다.
데모 페이지의 위젯에서 가상 사용자로 피드백을 제출한다.

1. POST 응답이 201이고 Supabase 테이블에 해당 ID가 저장되는지 확인한다.
2. 관리자 토큰으로 목록과 상세를 조회하고 상태·답변을 수정한다.
3. Next.js 서버를 종료 후 다시 시작해 같은 ID와 수정된 값이 유지되는지 확인한다.
4. 관리자 토큰이 없으면 조회·수정이 401인지 확인한다.
5. 공개용 Supabase 키로 테이블에 직접 접근할 때 조회·생성·수정이 거부되는지 확인한다.
6. DB 설정을 잘못 지정하면 생성·조회·수정이 `503 storage_unavailable`인지 확인한다.

`src/lib/supabase-feedback-repository.test.ts`는 로컬 HTTP 서버로 REST 요청 계약,
페이지 이어 읽기, 프로젝트 필터, 부분 수정, 설정 및 오류 처리를 검사한다.
실제 Postgres SQL 실행·RLS·재시작 후 영구 저장은 위 수동 검증을 별도로 수행해야 한다.

## 실제 DB 검증 기록 (2026-11-12)

- production Next 서버에서 가상 피드백 1건 생성: 201.
- 관리자 목록·상세 조회 및 상태·답변 수정: 200.
- 서버 프로세스 재시작 후 같은 ID·원문·수정 상태·답변 보존: 확인.
- 관리자 토큰 없는 목록·상세·수정: 401.
- 실제 저장소에서 다른 projectKey로 목록·상세·수정: 빈 목록 또는 null.
- 검증 중 발견한 프로젝트 필터 오류 수정: `eq."demo"`는 조회되지 않았고 `eq.demo`로 정상 조회됐다.
  필터 계약 테스트 2건이 수정 전 실패하고 수정 후 통과하는 것을 확인했다.
- 타입 검사·lint·테스트 90개·production 빌드: 통과.
- 공개용 키가 로컬 환경에 없어 공개 키를 통한 테이블 직접 접근 차단은 미검증이다.
- 테스트 행 `dd82f292-54d3-44ef-b682-f62d1f1ea7f3`은 가상 데이터이며 `resolved` 상태로 남겨 두었다.

## 현재 한계

- 고객사 등록은 기존 `src/lib/projects.ts`의 demo 설정을 유지한다.
- 목록은 내부적으로 페이지를 나눠 읽지만 외부 API에는 아직 페이지네이션이 없다.
- 메모리 rate limit은 DB 저장소와 별개다. 여러 인스턴스의 통합 제한은 후속 과제다.
- 메모리 모드에 쌓인 기존 데이터는 자동 이관하지 않는다.

공식 문서: Supabase의 API keys, REST API, Securing your API 문서를 기준으로 한다.
