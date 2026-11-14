# 실차 연결

KAO는 기본적으로 시뮬레이션으로 움직이지만, 실제 차량의 측정값을 받으면 그 탈것은 시뮬레이션 대신 실측값을 씁니다. OBD-II 동글, 제조사 커넥티드카 API의 웹훅, 자전거 트래커 등 어떤 장치든 아래 형식으로 보내면 됩니다.

## 수신 API

```
POST /api/ingest/telemetry
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

```json
{
  "vehicleId": "kao-0001",
  "at": 1794491525139,
  "speed": 62.5,
  "metrics": { "coolant": 96.2, "tire-fl": 238, "battery": 13.9 }
}
```

| 필드 | 내용 |
|---|---|
| `vehicleId` | 등록 탈것 id (`kao-0001`~`kao-0004`). 없으면 404 |
| `at` | 측정 시각(ms). 서버 시각과 1분 넘게 다르면 서버 시각을 씁니다. 생략 가능 |
| `speed` | 속도(km/h). 생략하면 시뮬레이션 속도 |
| `metrics` | 지표 key와 값. 그 탈것에 없는 key나 숫자가 아닌 값은 422 |

탈것별 지표 key는 `server/utils/fleet-specs.ts`에 있습니다(예: G80 `coolant`, `tire-fl`, `battery`, `rpm`).

## 화면에 반영되는 방식

- 최근 30초 안에 측정값이 들어온 탈것은 탈것 상세에 **실차 신호**로 표시하고, 보낸 지표와 속도를 실측값으로 바꿉니다. 보내지 않은 지표는 시뮬레이션 값을 씁니다.
- 지표의 경고·위험 상태는 실측값으로 바로 판단합니다.
- 30초 넘게 측정값이 없으면 다시 시뮬레이션으로 돌아갑니다.

## 아직 시뮬레이션에만 있는 것

- **문제(이슈)와 원격 조치**는 시뮬레이션의 문제 일정으로만 생깁니다. 실측값이 기준을 넘어도 새 문제를 열지는 않습니다. 실측값으로 문제를 열려면, 측정값이 들어올 때 기준 초과를 기록하는 상태 저장(예: `vehicle_issues` 테이블)이 필요합니다.
- **경로 위 위치**는 시뮬레이션 경로를 따릅니다. 실제 GPS를 쓰려면 위도·경도를 받아 지도 좌표로 바꾸는 단계가 필요합니다.
- **원격 조치 명령 전달**은 기록만 합니다. 실제 차량에 보내려면 제조사 API(예: 원격 공조·속도 제한)나 동글의 명령 채널과 연결해야 합니다.

## 예시

```bash
curl -s https://kao-ryushin01.vercel.app/api/ingest/telemetry \
  -H "Authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' \
  -d '{"vehicleId":"kao-0001","speed":48,"metrics":{"coolant":108.5}}'
```

운영 토큰은 Vercel 환경 변수 `INGEST_TOKEN`에 있습니다(읽을 수 없는 Secret이라, 잃어버리면 새로 만들어 바꿉니다).
