# 실차 연결

KAO는 기본적으로 시뮬레이션으로 움직이지만, 실제 차량이 측정값을 보내면 그 탈것은 시뮬레이션 대신 실측값·GPS·실측 문제를 씁니다. OBD-II 동글, 제조사 커넥티드카 API의 웹훅, 자전거 트래커 등 어떤 장치든 아래 형식으로 보내면 됩니다. 실제 차량이 없으면 [데모 장치](#데모-장치)로 같은 흐름을 볼 수 있습니다.

모든 요청에 `Authorization: Bearer <토큰>`이 필요합니다. 토큰은 두 가지입니다.

| 토큰 | 쓰는 곳 | 범위 |
|---|---|---|
| 장치 토큰(`kaod_…`) | 실제 장치. `pnpm device add`로 만듭니다([장치와 토큰](#장치와-토큰)) | 탈것 하나. 다른 탈것을 보내면 403, `vehicleId`를 빼면 그 탈것 |
| 공용 토큰(`INGEST_TOKEN`) | 개발·시험(데모 장치, E2E). Vercel 환경 변수(읽을 수 없는 Secret) | 모든 탈것 |

토큰이 맞지 않거나 폐기한 장치 토큰이면 401입니다.

## 흐름

```
장치 ──측정값·GPS──▶ POST /api/ingest/telemetry ──▶ 실측 문제 열기·해결, 위치 계산
  ▲                        │ 응답: 받아 갈 명령
  │                        ▼
  └──── 적용 결과 ─── POST /api/ingest/commands/:id/ack ◀── 관제 요원이 보낸 원격 조치
                                                              │ 웹훅을 등록한 장치면
제조사 서버 ◀──────────── POST <webhook_url>(서명한 명령) ◀───┘
```

## 장치와 토큰

장치는 운영 DB에 `pnpm device`로 만듭니다(`DATABASE_URL`이 담긴 env 파일과 함께). 토큰(과 웹훅 서명 비밀)은 만들 때 한 번만 보여 주고 DB에는 SHA-256만 남깁니다. 잃어버리면 폐기하고 새로 만듭니다.

```bash
pnpm device add --vehicle kao-0001 --name "G80 OBD 단말"
pnpm device add --vehicle kao-0002 --webhook https://maker.example/kao/commands   # 명령을 웹훅으로 받는 장치
pnpm device list
pnpm device revoke dev_1a2b3c4d5e6f
```

토큰이 새면 그 장치만 폐기하면 되고, 다른 탈것의 장치는 영향을 받지 않습니다. 장치의 마지막 요청 시각은 `list`에 보입니다(인스턴스마다 1분에 한 번 기록).

## 측정값 보내기

```
POST /api/ingest/telemetry
Content-Type: application/json
```

```json
{
  "vehicleId": "kao-0001",
  "at": 1794491525139,
  "speed": 62.5,
  "metrics": { "coolant": 96.2, "tire-fl": 238, "battery": 13.9 },
  "lat": 37.56631,
  "lng": 126.97795
}
```

| 필드 | 내용 |
|---|---|
| `vehicleId` | 등록 탈것 id (`kao-0001`~`kao-0007`). 없으면 404 |
| `at` | 측정 시각(ms). 미래(5초 넘게)이거나 1분보다 오래되면 서버 시각을 씁니다. 생략 가능 |
| `speed` | 속도(km/h). 생략하면 시뮬레이션 속도 |
| `metrics` | 지표 key와 값. 그 탈것에 없는 key나 숫자가 아닌 값은 422. 지표를 나눠 보내도 됩니다(30초 안의 가장 새 값을 지표마다 씀) |
| `lat`, `lng` | GPS 위도·경도. 둘을 함께 보내야 하고, 하나만 오거나 범위를 벗어나면 422 |

응답:

```json
{
  "ok": true,
  "vehicleId": "kao-0001",
  "at": 1794491525139,
  "stale": false,
  "position": { "onRoute": true, "progress": 0.4321, "lap": 3 },
  "commands": [
    {
      "id": "8d0c…",
      "issueId": "live-kao-0001-coolant-1794491500000",
      "action": "cooling-mode",
      "label": "냉각 모드",
      "description": "냉각 팬과 펌프를 최대로 돌리고 엔진 회전수를 낮춥니다.",
      "sentAt": 1794491520000,
      "expiresAt": 1794491640000
    }
  ]
}
```

`stale`이 `true`면 이 탈것의 더 새 측정값이 이미 있어(늦게 도착함) 이력에만 저장하고 문제 판단과 바퀴 수에는 쓰지 않았다는 뜻입니다.

탈것별 지표 key는 `server/utils/fleet-specs.ts`에 있습니다.

| 탈것 | 지표 key (굵게: 기준을 넘으면 문제로 엶) |
|---|---|
| `kao-0001` Genesis G80 | `rpm`, **`coolant`**, **`tire-fl`**, **`battery`** |
| `kao-0002` Lamborghini Aventador | `rpm`, **`oil`**, **`brake-fl`**, **`tire-rl`** |
| `kao-0003` Ducati Panigale V4 S | `rpm`, **`lean`**, **`coolant`**, **`tire-r`** |
| `kao-0004` STRiDA LT | `cadence`, **`tire-f`**, **`belt`**, **`tracker`** |
| `kao-0005` Genesis Essentia Concept | `motor-power`, **`battery-temp`**, **`motor-temp`**, **`soc`**, **`tire-fr`** |
| `kao-0006` Renault Arkana | `rpm`, **`cvt`**, **`oil-pressure`**, **`tire-rr`** |
| `kao-0007` Toyota Alphard | `rpm`, **`hv-battery`**, **`cabin-co2`**, **`tire-fl`** |

## 실측 문제

실차 신호(30초 안의 측정값)가 있는 탈것은 시뮬레이션 문제 대신 실측 문제를 보여 줍니다.

- **열기**: 지표가 경고 기준을 넘으면 문제를 엽니다. 위험 기준을 넘으면 등급을 올리고, 내리지는 않습니다. 같은 지표에 해결되지 않은 문제는 하나뿐입니다.
- **해결**: 지표가 기준 안으로 돌아와 10초 동안 유지되면 해결합니다. 그 사이 다시 넘거나, 측정값이 30초 넘게 끊겼다 돌아오면(그 사이를 모르므로) 처음부터 기다립니다. 차량 응답을 기다리는 명령이 있으면 응답까지 기다립니다.
- **순서**: 문제마다 마지막으로 반영한 측정 시각을 저장해, 그보다 오래된 측정값은 판단에 쓰지 않습니다(이미 해결한 문제를 늦게 온 이상값으로 다시 열지도 않음). 같은 탈것의 요청이 겹치면 저장할 때 그 시각이 그대로인지 확인해 덮어쓰지 않고 다시 판단합니다.
- **알림**: 위험 등급이 된 열린 문제는 시뮬레이션 문제처럼 웹 푸시로 알립니다.
- 신호가 30초 넘게 끊기면 그 탈것은 시뮬레이션으로 돌아가고 실측 문제는 숨깁니다. 해결되지 않은 문제는 저장돼 있다가 다시 신호가 오면 이어집니다. 그 지표를 더 보내지 않으면 문제는 열린 채로 남습니다.

## 원격 조치 명령

관제 요원이 실측 문제에 원격 조치를 보내면 명령으로 쌓입니다. 장치는 측정값을 보낼 때 응답의 `commands`로 받거나, 측정값 없이 명령만 확인할 수 있습니다.

```
GET /api/ingest/commands?vehicleId=kao-0001
```

받은 명령을 적용했으면(또는 적용하지 못했으면) 알려 줍니다.

```
POST /api/ingest/commands/:id/ack
{ "vehicleId": "kao-0001", "result": "applied" | "failed", "message": "실패 이유(선택, 200자)" }
```

| 응답 | 뜻 |
|---|---|
| 200 | 반영함 |
| 404 | 이 탈것에 보낸 명령이 아님 |
| 409 | 이미 응답했거나 응답 시간(2분)이 지난 명령 |
| 422 | `result`가 `applied`·`failed`가 아님 |

관제 화면은 명령을 이렇게 보여 줍니다.

| 상황 | 문제 상태 | 조치 기록 |
|---|---|---|
| 명령을 보냄 | 조치 중 · 차량 응답을 기다림 | 전송 |
| 차량이 `applied` | 조치 중 · 지표가 돌아오기를 기다림. 10초 유지되면 "…로 해결" | 완료(차량 적용 완료) |
| 차량이 `failed` | 조치 필요(다른 조치를 보낼 수 있음) | 실패(이유 포함) |
| 2분 안에 응답 없음 | 조치 필요 | 실패(차량 응답 없음) |
| 적용 뒤 10분이 지나도 기준을 넘음 | 조치 필요 | 실패(다시 조치 필요) |

실패 기록은 화면 낭독기에 `role="alert"`로 바로 알립니다. 같은 문제에 차량 응답을 기다리는 명령은 하나뿐입니다(DB의 부분 유일 인덱스로 동시에 보내도 한쪽만 들어감).

| 명령(`action`) | 차량에서 할 일 | `parameters` |
|---|---|---|
| `cooling-mode` | 냉각 팬과 펌프를 최대로, 엔진 회전수를 낮춤 | |
| `power-limit` | 최고 출력을 60%로 묶음 | `{ "powerRatio": 0.6, "maxSpeedKmh": 40 }`(G80. 최고 속도는 평소의 80%) |
| `speed-limit` | 최고 속도를 평소의 60%로 묶고 계기판에 안내 | `{ "maxSpeedKmh": 30 }`(G80. 탈것마다 다름) |
| `tpms-recalibrate` | 타이어 공기압 센서 다시 맞춤 | |
| `notify-rider` | 계기판과 운전자 휴대폰으로 점검 안내 | |
| `traction-boost` | 트랙션·윌리 컨트롤 단계를 올림 | |
| `eco-power` | 부가 장치 전원을 끊음 | |
| `dispatch-service` | 협력 정비소에 현장 출동 요청 | |

속도·출력 제한을 적용하면 관제 화면에 90초 동안 "속도 제한 적용 중"을 보여 줍니다.

### 웹훅으로 받기(제조사 서버)

장치에 `--webhook`을 등록하면 관제 요원이 조치를 보낼 때 서버가 그 주소로 명령을 바로 보냅니다(제조사 커넥티드카 API처럼). 받는 쪽은 명령을 차량에 적용하고 위의 ack로 결과를 알려 줍니다. 2xx로 응답하면 '차량이 받아 감'으로 기록하고, 그 밖에는 장치가 위 방식으로 받아 갈 때까지 둡니다.

```
POST <webhook_url>
X-KAO-Timestamp: 1763100000000
X-KAO-Signature: sha256=<HMAC-SHA256(웹훅 서명 비밀, "${X-KAO-Timestamp}.${본문}") 16진수>
{ "type": "kao.command", "deviceId": "dev_…", "vehicleId": "kao-0002", "command": { "id": "…", "action": "speed-limit", "parameters": { "maxSpeedKmh": 48 }, … } }
```

```js
// 받는 쪽 확인 예(Node)
const expected = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
const fresh = Math.abs(Date.now() - Number(timestamp)) < 5 * 60_000
if (!fresh || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return reply(401)
```

- 주소는 https만 씁니다(DB에서도 막음). 사설·루프백·링크 로컬 등 내부망 주소로는 보내지 않고, 이름은 연결할 때 실제로 연결할 주소로 검사합니다(검사 뒤 DNS가 바뀌는 경우도 막음).
- 리다이렉트는 따르지 않고, 5초 안에 응답이 없으면 보내지 못한 것으로 봅니다. 관제 요원의 조치 요청은 그동안 기다립니다.
- 제조사 API마다 다른 형식(원격 공조, 속도 제한 등)은 이 웹훅을 받는 쪽에서 바꿔 부르면 됩니다.

## GPS

- 네 경로는 OpenStreetMap 서울 도로를 따라 만든 실제 코스입니다(`src/shared/config/routes.ts`, [개발 가이드의 서울 지도](development.md#서울-지도)). G80은 광화문 도심 순환(세종대로·을지로·남대문로·종로), 아벤타도르는 동작·한남 한강 순환(강변북로·한남대교·올림픽대로·동작대교), 파니갈레는 남산 순환(퇴계로·장충단로·소월로), 스트라이다는 여의도 한강 자전거길입니다. 장치는 실제 위도·경도를 그대로 보내면 됩니다.
- 서버는 GPS를 관제 지도와 같은 경로(`src/shared/lib/route-geo.ts`)에 맞춰 경로 위 위치로 바꿉니다. 경로에서 150m 넘게 벗어나면 경로 위치로 쓰지 않고, 화면에 "경로에서 벗어남"과 좌표를 보여 줍니다. 관제 지도는 이때 미니어처를 실제 GPS 위치에 두고, 최근 2분의 GPS 위치(최대 60점)를 지나온 길로 그립니다(주행 위치 표의 '위치 기준'은 "GPS 경로 밖: 반포대교 남동쪽 약 3.2km"처럼 지도에 이름이 뜨는 곳 가운데 가장 가까운 곳의 방향·거리이고, 바퀴 수·진행률은 경로 위치가 없어 "—"). 경로로 돌아오면 지도는 새 경로 위치에서 바로 이어 갑니다.
- 바퀴 수는 매시 정각부터 셉니다. 앞뒤 측정값의 경로 위치 차이를 더해 가므로, 출발선 근처에서 GPS가 흔들려도 바퀴가 쌓이지 않습니다.
- GPS로 움직이는 탈것은 관제 지도에서 12배속 없이 실제 위치로 움직이고, 주행 위치 표의 '위치 기준'이 GPS가 됩니다.

## 지표 이력

측정값은 하루 동안 저장합니다. 지표 이력 그래프는 각 시각 30초 안에 실측값이 있으면 그 값을, 없으면 시뮬레이션을 씁니다. 그래프 위에 "120점 가운데 N점이 실차 측정값"이라고 밝힙니다.

## 데모 장치

`scripts/live-demo.mjs`가 실제 차량 대신 1초마다 측정값과 GPS를 보내고, 받은 명령에 2초 뒤 응답합니다.

```bash
# 로컬: 서버를 토큰과 함께 띄우고, 다른 터미널에서 데모 장치를 돌립니다.
INGEST_TOKEN=local-token pnpm dev
INGEST_TOKEN=local-token pnpm live:demo --vehicle kao-0001 --fault coolant

# 운영: .env.ingest.local(커밋하지 않음)에 INGEST_TOKEN을 두고
node --env-file=.env.ingest.local scripts/live-demo.mjs --url https://kao-ryushin01.vercel.app --vehicle kao-0003 --fault tire-r
```

| 옵션 | 내용 |
|---|---|
| `--vehicle` | 탈것 id (기본 `kao-0001`) |
| `--fault` | 기준을 넘게 할 지표 key. 생략하면 정상 주행만 |
| `--ack` | 명령에 할 응답 `applied`(기본) · `failed` · `none`(응답 없음 시험) |
| `--seconds`, `--interval`, `--ack-delay` | 보낼 시간(기본 180초), 간격(1000ms), 응답까지 걸리는 시간(2000ms) |
| `--detour` | 시작 10초 뒤부터 이 시간(초) 동안 경로 옆으로 400m 벗어나 달림(경로 밖 GPS와 지나온 길 시험) |
| `--token` | 수신 토큰. 기본은 `INGEST_TOKEN`이고, 장치 토큰(`kaod_…`)을 넣으면 그 장치의 탈것으로만 보냅니다 |

관제 요원으로 로그인해 그 탈것 상세를 열면 "실차 신호"와 함께 문제가 열리고, 조치를 보내면 장치가 받아 적용한 뒤 지표가 돌아와 해결되는 과정을 볼 수 있습니다.
