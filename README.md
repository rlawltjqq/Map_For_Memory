# 나의 여행 지도

가본 시·군·구를 클릭해서 색칠하고, 사진을 붙여두는 공유 여행 지도.
지도별로 방(room)을 만들고, 공유 암호를 아는 사람끼리 함께 편집한다.

## 로컬 실행

```
python server.py
```

브라우저에서 http://localhost:8931 접속. (파이썬만 있으면 됩니다 — 추가 설치 불필요)
로컬 데이터는 `data/` 폴더에 저장됩니다.

## Vercel 배포

1. 이 저장소를 GitHub에 푸시
2. [vercel.com](https://vercel.com) → **Add New Project** → 저장소 Import (설정 그대로 Deploy)
3. 프로젝트 → **Storage** 탭에서 두 가지 연결:
   - **Upstash Redis** (Marketplace) — 방/방문 기록 저장
   - **Blob** — 사진 저장
4. 연결하면 환경변수가 자동 주입됨. **Deployments** 탭에서 Redeploy 한 번.

이후 배포 URL로 접속 → 지도 만들기 → "초대 링크 복사"로 같이 쓸 사람에게 링크를,
암호는 따로 전달하면 됩니다.

## 구조

| 경로 | 역할 |
|---|---|
| `index.html` | 프론트엔드 (빌드 결과물, 지도 SVG 포함) |
| `api/*.js` | Vercel 서버리스 함수 (방 생성/입장, 방문 기록, 사진) |
| `server.py` | 로컬 개발 서버 — `api/`와 동일한 API를 파일 저장으로 에뮬레이트 |
| `page_template.html` | 프론트엔드 템플릿 (수정은 여기서) |
| `make_sigungu_map.py` | GeoJSON → 지도 SVG 생성 (경계 + 지역명 라벨) |
| `build_page.py` | 템플릿 + SVG → index.html 빌드 |

### API

- `POST /api/rooms` `{name, password}` → 방 생성, `{id, token}` 반환
- `POST /api/join` `{room, password}` → `{token}` 반환
- `GET /api/state?room=` (x-token 헤더) → `{name, visited, photos}`
- `POST /api/visited` `{room, code, on}` 개별 토글 / `{room, codes:[...]}` 전체 교체
- `POST /api/photo?room=&code=` (바이너리 body + X-Filename 헤더) / `DELETE` `{url}`

인증: 방 암호는 scrypt 해시로 저장, 토큰 = sha256(방ID:암호해시).
클라이언트가 업로드 전에 사진을 긴 변 1600px JPEG로 압축한다 (Vercel 요청 4.5MB 제한 대응).

## 지도 다시 만들 때

원본 경계 데이터(통계청 2013, [southkorea-maps](https://github.com/southkorea/southkorea-maps)):

```
curl -L -o korea_provinces.geojson https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2013/json/skorea_provinces_geo.json
curl -L -o korea_municipalities.geojson https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2013/json/skorea_municipalities_geo.json
python make_sigungu_map.py   # SVG 재생성
python build_page.py         # index.html 재빌드
```
