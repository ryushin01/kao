/**
 * 관제 지도용 서울 도심 지도 데이터를 OpenStreetMap에서 만듭니다(지도 데이터 © OpenStreetMap 기여자, ODbL 1.0).
 *
 *   pnpm build:map            # assets-src/osm/에 받아 둔 원본으로 만들기(없는 원본만 Overpass API에서 받음)
 *   pnpm build:map --fetch    # 원본을 모두 다시 받은 뒤 만들기
 *
 * 만드는 것
 * - src/shared/config/routes.ts: 탈것 4대의 주행 경로. 실제 도로를 따라 닫힌 경로(위도·경도)
 * - public/maps/seoul.json: 관제 지도에 그리는 도로·한강·공원·높은 건물(지도 중심 기준 m 좌표, 정수, 차분 부호화)
 *
 * 지도는 두 겹입니다. 안쪽(경로가 있는 도심)은 골목길·자전거길·높은 건물(10층 이상 또는 30m 이상)까지,
 * 바깥 고리는 큰길·물·공원만 그려 전체 보기에서 지도가 화면 끝에서 끊기지 않게 하고, 끝은 화면에서 흐리게 묻습니다.
 *
 * 경로는 경유점(도로 이름·진행 방향·태그)을 잇는 최단 경로이고, 일방통행(oneway 태그와 OSM 관례상 한 방향인 길)을 지킵니다
 * (실제로 달릴 수 있는 길만). 교차로 구조 때문에 크게 돌아가는 조합은 경유점과 방향을 바꿔 고릅니다.
 * Node 22.18 이상이 TS 파일을 그대로 불러와 앱과 같은 좌표 변환을 씁니다.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { MAP_CENTER, toLocal } from '../src/shared/lib/route-geo.ts'

const { values: args } = parseArgs({ options: { fetch: { type: 'boolean', default: false } } })
const ROOT = new URL('../', import.meta.url)
const RAW = new URL('assets-src/osm/', ROOT)

/** 범위: [남, 서, 북, 동]. 경로 계산용(진출입로가 화면 밖으로 잠깐 나가는 곳까지 넉넉히), 안쪽(자세히), 바깥 고리 */
const ROUTING_BBOX = [37.495, 126.893, 37.595, 127.027]
const DISPLAY_BBOX = [37.5, 126.9, 37.584, 127.022]
const OUTER_BBOX = [37.45, 126.82, 37.64, 127.11]

// ── 원본 받기 ───────────────────────────────────────────────────────────────

/** 10층 이상이거나 높이 30m 이상인 건물 */
const TALL = ['["building:levels"~"^[1-9][0-9]+$"]', '["height"~"^([3-9][0-9]|[1-9][0-9][0-9]+)([.][0-9]+)?$"]']

/** 원본별 범위와 선택 조건. split×split 조각으로 나눠 받습니다(공용 서버는 큰 요청을 502·504로 끊습니다). */
const SOURCES = {
  roads: {
    bbox: ROUTING_BBOX,
    split: 1,
    out: 'body;>;out skel qt',
    select: (b) => `way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|cycleway)$"](${b});
      way["highway"~"^(path|footway)$"]["bicycle"~"^(yes|designated)$"](${b});`,
  },
  minor: { bbox: DISPLAY_BBOX, split: 1, out: 'body;>;out skel qt', select: (b) => `way["highway"~"^(residential|unclassified|living_street)$"](${b});` },
  // 예전(안쪽 범위만) areas.json을 그대로 쓰지 않도록 바깥 고리까지 받은 원본은 이름을 따로 둡니다.
  'areas-outer': {
    bbox: OUTER_BBOX,
    split: 2,
    out: 'geom',
    select: (b) => `relation["natural"="water"](${b});way["natural"="water"](${b});relation["leisure"="park"](${b});way["leisure"="park"](${b});`,
  },
  outer: {
    bbox: OUTER_BBOX,
    split: 3,
    out: 'geom',
    select: (b) => `way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|secondary)$"](${b});`,
  },
  buildings: {
    bbox: DISPLAY_BBOX,
    split: 2,
    out: 'geom',
    select: (b) => ['way', 'relation'].flatMap((type) => TALL.map((tag) => `${type}["building"]${tag}(${b});`)).join(''),
  },
}

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 공용 Overpass 서버는 붐비면 429·502·504를 돌려주므로, 잠시 기다렸다가 다른 서버로도 다시 요청합니다.
 * 시간·메모리 한도를 넘기면 200 응답의 remark('runtime error: …')로 알리고 elements가 비거나 잘려 있으므로, 그 응답도 실패로 봅니다.
 */
async function overpass(name, query) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const endpoint = OVERPASS[attempt % OVERPASS.length]
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'kao-map-builder (https://github.com/ryushin01/kao)' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(200_000),
    }).catch((error) => ({ ok: false, status: error.message }))
    let problem = response.status
    if (response.ok) {
      const text = await response.text().catch(() => '')
      let data = null
      try {
        data = text.trimStart().startsWith('{') ? JSON.parse(text) : null
      } catch {
        // 응답이 중간에 끊겨 JSON이 잘린 경우도 다시 요청합니다.
      }
      if (data && !/runtime error/i.test(data.remark ?? '')) return data
      problem = data ? data.remark : '응답이 온전한 JSON이 아님'
    }
    console.log(`[map] ${name}: ${new URL(endpoint).host} ${problem}, 다시 요청합니다.`)
    await wait(10_000 * (attempt + 1))
  }
  throw new Error(`Overpass에서 ${name}을 받지 못했습니다.`)
}

/** [남, 서, 북, 동] 범위를 split×split 조각으로 나눕니다. */
function tiles([south, west, north, east], split) {
  const result = []
  for (let i = 0; i < split; i += 1) {
    for (let j = 0; j < split; j += 1) {
      const lat = (k) => Number((south + ((north - south) * k) / split).toFixed(5))
      const lng = (k) => Number((west + ((east - west) * k) / split).toFixed(5))
      result.push([lat(i), lng(j), lat(i + 1), lng(j + 1)])
    }
  }
  return result
}

async function fetchRaw(name) {
  const { bbox, split, out, select } = SOURCES[name]
  const parts = tiles(bbox, split)
  const seen = new Set()
  const elements = []
  let head = null
  for (const [i, part] of parts.entries()) {
    console.log(`[map] Overpass에서 ${name} 받는 중… (${i + 1}/${parts.length})`)
    const data = await overpass(name, `[out:json][timeout:180];(${select(part)});out ${out};`)
    head ??= { version: data.version, generator: data.generator, osm3s: data.osm3s }
    // 조각 경계에 걸친 길·건물은 여러 조각에 들어 있으므로 한 번만 남깁니다.
    for (const element of data.elements) {
      const id = `${element.type}/${element.id}`
      if (seen.has(id)) continue
      seen.add(id)
      elements.push(element)
    }
    // Overpass 공용 서버 사용 규칙: 요청 사이를 띄웁니다.
    await wait(3000)
  }
  await mkdir(RAW, { recursive: true })
  await writeFile(new URL(`${name}.json`, RAW), JSON.stringify({ ...head, elements }))
}

for (const name of Object.keys(SOURCES)) {
  const exists = await access(new URL(`${name}.json`, RAW)).then(
    () => true,
    () => false,
  )
  if (args.fetch || !exists) await fetchRaw(name)
}
const load = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, RAW), 'utf8'))
const [roadsRaw, minorRaw, areasRaw, outerRaw, buildingsRaw] = await Promise.all(['roads', 'minor', 'areas-outer', 'outer', 'buildings'].map(load))

// ── 도로 그래프와 경로 ─────────────────────────────────────────────────────

const nodes = new Map()
for (const el of [...roadsRaw.elements, ...minorRaw.elements]) {
  if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lng: el.lon, ...toLocal(el.lat, el.lon) })
}
const roadWays = roadsRaw.elements.filter((el) => el.type === 'way')
const minorWays = minorRaw.elements.filter((el) => el.type === 'way')

const edges = new Map()
for (const way of roadWays) {
  const t = way.tags
  // 일방통행: oneway=yes·1·true, 그리고 OSM에서 따로 적지 않아도 한 방향으로 보는 고속도로·고속도로 진출입로·회전교차로.
  // 다른 진출입로(trunk_link 등)는 oneway 태그가 있을 때만 한 방향입니다.
  const implied = t.oneway !== 'no' && (t.highway === 'motorway' || t.highway === 'motorway_link' || t.junction === 'roundabout' || t.junction === 'circular')
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || implied
  const reverse = t.oneway === '-1'
  for (let i = 0; i < way.nodes.length - 1; i += 1) {
    const a = nodes.get(way.nodes[i])
    const b = nodes.get(way.nodes[i + 1])
    if (!a || !b) continue
    const add = (from, to, fromId, toId) => {
      if (!edges.has(fromId)) edges.set(fromId, [])
      edges.get(fromId).push({ to: toId, length: Math.hypot(to.x - from.x, to.z - from.z), way })
    }
    if (!reverse) add(a, b, way.nodes[i], way.nodes[i + 1])
    if (!oneway || reverse) add(b, a, way.nodes[i + 1], way.nodes[i])
  }
}

const bearing = (a, b) => (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI
const angleGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180)
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

/** 경유점에서 400m 안의, 이름·태그·진행 방향이 맞는 가장 가까운 교차점 */
function snap({ lat, lng, name, heading, tags = {} }, allow) {
  const p = toLocal(lat, lng)
  let best = null
  for (const [id, list] of edges) {
    const node = nodes.get(id)
    const d = distance(node, p)
    if (d > 400 || (best && d >= best.d)) continue
    const fits = list.some(
      (edge) =>
        allow(edge.way) &&
        (!name || edge.way.tags.name === name) &&
        Object.entries(tags).every(([key, value]) => edge.way.tags[key] === value) &&
        (heading === undefined || angleGap(bearing(node, nodes.get(edge.to)), heading) < 70),
    )
    if (fits) best = { id, d }
  }
  if (!best) throw new Error(`경유점을 도로에 맞추지 못했습니다: ${name ?? ''} ${lat}, ${lng}`)
  return best.id
}

class Heap {
  items = []
  push(item) {
    const a = this.items
    a.push(item)
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1
      if (a[parent][0] <= a[i][0]) break
      ;[a[parent], a[i]] = [a[i], a[parent]]
      i = parent
    }
  }
  pop() {
    const a = this.items
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      for (let i = 0; ; ) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
  get size() {
    return this.items.length
  }
}

function shortestPath(from, to, allow, cost) {
  const dist = new Map([[from, 0]])
  const previous = new Map()
  const queue = new Heap()
  const done = new Set()
  queue.push([0, from])
  while (queue.size) {
    const [d, u] = queue.pop()
    if (done.has(u)) continue
    done.add(u)
    if (u === to) break
    for (const edge of edges.get(u) ?? []) {
      if (!allow(edge.way)) continue
      const next = d + edge.length * cost(edge.way)
      if (next < (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(edge.to, next)
        previous.set(edge.to, u)
        queue.push([next, edge.to])
      }
    }
  }
  if (!done.has(to)) throw new Error(`이어지는 도로가 없습니다: ${from} → ${to}`)
  const path = [to]
  while (path[0] !== from) path.unshift(previous.get(path[0]))
  return path
}

/** 점 p에서 선분 a–b까지의 거리(선분 밖으로 나가면 가까운 끝점까지) */
function segmentDistance(p, a, b) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const span = dx * dx + dz * dz
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / span))
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z)
}

/**
 * Douglas–Peucker. points는 {x, z}, 처음과 끝 점은 남깁니다. 오차는 무한한 직선이 아니라 바꿔 넣을 선분까지 재므로,
 * 갔다가 되돌아오는 구간(되돌이)이나 닫힌 고리도 지워지지 않습니다.
 */
function simplify(points, tolerance) {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    const a = points[first]
    const b = points[last]
    let index = -1
    let max = tolerance
    for (let i = first + 1; i < last; i += 1) {
      const d = segmentDistance(points[i], a, b)
      if (d > max) {
        max = d
        index = i
      }
    }
    if (index >= 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

const CAR = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'])
const car = (way) => CAR.has(way.tags.highway)
const bike = (way) => ['cycleway', 'path', 'footway', 'secondary', 'tertiary'].includes(way.tags.highway)
const bikeCost = (way) => (way.tags.highway === 'cycleway' ? 1 : ['path', 'footway'].includes(way.tags.highway) ? 1.5 : 6)

const ROUTE_PLANS = [
  {
    id: 'downtown',
    name: '광화문 도심 순환',
    via: '세종대로 → 을지로 → 남대문로 → 종로',
    allow: car,
    waypoints: [
      { name: '세종대로', lat: 37.57, lng: 126.9768, heading: 180 },
      { name: '세종대로', lat: 37.5655, lng: 126.9772, heading: 180 },
      { name: '을지로', lat: 37.5662, lng: 126.98, heading: 90 },
      { name: '남대문로', lat: 37.5672, lng: 126.9822, heading: 0 },
      { name: '종로', lat: 37.5703, lng: 126.98, heading: 270 },
    ],
  },
  {
    id: 'han-river',
    name: '동작·한남 한강 순환',
    via: '강변북로 → 한남대교 → 올림픽대로 → 동작대교',
    allow: car,
    waypoints: [
      { name: '한남대로', lat: 37.528, lng: 127.012, heading: 150 },
      { name: '올림픽대로', lat: 37.508, lng: 126.997, heading: 270 },
      { name: '동작대로', lat: 37.512, lng: 126.9822, heading: 15, tags: { 'bridge:name': '동작대교' } },
      { name: '강변북로', lat: 37.52, lng: 126.997, heading: 90 },
    ],
  },
  {
    id: 'namsan',
    name: '남산 순환',
    via: '퇴계로 → 장충단로 → 소월로',
    allow: car,
    waypoints: [
      { name: '퇴계로', lat: 37.559, lng: 126.983, heading: 80 },
      { name: '퇴계로', lat: 37.5605, lng: 126.995, heading: 90 },
      { name: '장충단로', lat: 37.553, lng: 127.005, heading: 180 },
      { name: '소월로', lat: 37.542, lng: 127.0, heading: 270 },
      { name: '소월로', lat: 37.548, lng: 126.99, heading: 300 },
      { name: '소월로', lat: 37.554, lng: 126.98, heading: 340 },
    ],
  },
  {
    id: 'yeouido',
    name: '여의도 한강 자전거길',
    via: '한강남자전거길 → 여의샛강자전거길',
    allow: bike,
    cost: bikeCost,
    waypoints: [
      { name: '한강남자전거길', lat: 37.5307, lng: 126.9273, heading: 130 },
      { name: '한강남자전거길', lat: 37.5235, lng: 126.9381, heading: 135 },
      { name: '여의샛강자전거길', lat: 37.5156, lng: 126.9275, heading: 265 },
      { name: '여의샛강자전거길', lat: 37.5199, lng: 126.9165, heading: 310 },
    ],
  },
]

function buildRoute(plan) {
  const ids = plan.waypoints.map((point) => snap(point, plan.allow))
  const path = []
  for (let i = 0; i < ids.length; i += 1) {
    const part = shortestPath(ids[i], ids[(i + 1) % ids.length], plan.allow, plan.cost ?? (() => 1))
    path.push(...(path.length ? part.slice(1) : part))
  }
  path.pop() // 닫힌 경로라 마지막(첫 점과 같음)은 뺍니다.
  // 1.5m보다 작은 굽이는 줄입니다(닫힌 경로라 첫 점을 끝에 붙였다가 뺍니다).
  const points = simplify([...path, path[0]].map((id) => nodes.get(id)), 1.5).slice(0, -1)
  let length = 0
  for (let i = 0; i < points.length; i += 1) length += distance(points[i], points[(i + 1) % points.length])
  return {
    id: plan.id,
    name: plan.name,
    via: plan.via,
    lengthKm: Math.round(length) / 1000,
    path: points.map((p) => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]),
  }
}

const routes = ROUTE_PLANS.map(buildRoute)
for (const route of routes) console.log(`[map] 경로 ${route.id}: ${route.lengthKm}km, 점 ${route.path.length}개`)

const routesTs = `// 이 파일은 scripts/build-seoul-map.mjs가 만듭니다. 직접 고치지 말고 스크립트의 ROUTE_PLANS를 고친 뒤 pnpm build:map을 실행하세요.
// 지도 데이터 © OpenStreetMap 기여자, ODbL 1.0 (https://www.openstreetmap.org/copyright)

/**
 * 관제 지도 위의 주행 경로입니다. OpenStreetMap 서울 도로를 따라 만든 닫힌 경로이며,
 * path는 위도·경도 점이고 마지막 점에서 첫 점으로 이어집니다. 서버는 길이로 위치를 계산하고
 * 화면은 같은 점을 지도 좌표로 바꿔 그립니다(@shared/lib route-geo).
 */
export interface RouteDefinition {
  id: string
  name: string
  /** 지나는 도로 */
  via: string
  /** 실제 한 바퀴 길이(km) */
  lengthKm: number
  path: ReadonlyArray<readonly [number, number]>
}

export const ROUTES: readonly RouteDefinition[] = ${JSON.stringify(routes, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]').replace(/"(\w+)":/g, '$1:').replace(/"/g, "'")}

export function findRoute(id: string): RouteDefinition {
  const route = ROUTES.find((item) => item.id === id)
  if (!route) throw new Error(\`알 수 없는 경로: \${id}\`)
  return route
}
`
await writeFile(new URL('src/shared/config/routes.ts', ROOT), routesTs)

// ── 화면용 지도 ────────────────────────────────────────────────────────────

const boundsOf = ([south, west, north, east]) => {
  const a = toLocal(south, west)
  const b = toLocal(north, east)
  return { minX: Math.round(a.x), maxX: Math.round(b.x), minZ: Math.round(b.z), maxZ: Math.round(a.z) }
}
/** 지도 전체(바깥 고리까지)와 자세히 그리는 안쪽 */
const bounds = boundsOf(OUTER_BBOX)
const detail = boundsOf(DISPLAY_BBOX)
const within = (box) => (p) => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ

/**
 * 점들을 정수 m로 반올림해 [x0, z0, dx1, dz1, …](첫 점, 그다음부터는 앞 점과의 차이)로 줄입니다.
 * 반올림한 뒤 차이를 내므로 차이를 더해 가면 반올림한 좌표가 그대로 나오고, 반올림해서 겹친 점은 뺍니다.
 */
function encode(points) {
  const out = []
  let px = 0
  let pz = 0
  for (const p of points) {
    const x = Math.round(p.x)
    const z = Math.round(p.z)
    if (out.length && x === px && z === pz) continue
    out.push(x - px, z - pz)
    px = x
    pz = z
  }
  return out
}

const ROAD_CLASS = {
  motorway: 'trunk', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary',
  motorway_link: 'link', trunk_link: 'link', primary_link: 'link', secondary_link: 'link', tertiary_link: 'link',
  residential: 'minor', unclassified: 'minor', living_street: 'minor', cycleway: 'cycleway', path: 'cycleway', footway: 'cycleway',
}
const TOLERANCE = { trunk: 2, primary: 2, secondary: 2, tertiary: 2.5, link: 2, minor: 4, cycleway: 3 }
/** 바깥 고리까지 그리는 큰길(고속도로·도시고속도로·간선·보조간선). 나머지는 안쪽만 그립니다. */
const OUTER_ROADS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'secondary'])
const roads = Object.fromEntries(Object.keys(TOLERANCE).map((key) => [key, []]))

/**
 * 범위 밖 구간은 잘라 내고, 안쪽에 이어진 조각만 등급별로 모읍니다.
 * 바깥 고리(안쪽 범위 밖)의 조각은 멀리서만 보이므로 3배 크게 간추립니다.
 */
function addRoad(kind, points, box) {
  const inside = within(box)
  let piece = []
  const flush = () => {
    if (piece.length > 1) {
      const middle = piece[Math.floor(piece.length / 2)]
      roads[kind].push(encode(simplify(piece, TOLERANCE[kind] * (within(detail)(middle) ? 1 : 3))))
    }
    piece = []
  }
  for (const point of points) {
    if (point && inside(point)) piece.push(point)
    else flush()
  }
  flush()
}
for (const way of outerRaw.elements) {
  const kind = way.type === 'way' && way.geometry ? ROAD_CLASS[way.tags.highway] : undefined
  // 진출입로는 멀리서는 보이지 않으므로 안쪽에만 그립니다.
  if (kind) addRoad(kind, way.geometry.map((p) => toLocal(p.lat, p.lon)), kind === 'link' ? detail : bounds)
}
for (const way of [...roadWays, ...minorWays]) {
  const kind = ROAD_CLASS[way.tags.highway]
  if (kind && !OUTER_ROADS.has(way.tags.highway)) addRoad(kind, way.nodes.map((id) => nodes.get(id)), detail)
}

/** 다각형을 사각형 범위로 자릅니다(Sutherland–Hodgman). */
function clip(ring, box) {
  const edgesOf = [
    [(p) => p.x >= box.minX, (a, b) => ({ x: box.minX, z: a.z + ((b.z - a.z) * (box.minX - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= box.maxX, (a, b) => ({ x: box.maxX, z: a.z + ((b.z - a.z) * (box.maxX - a.x)) / (b.x - a.x) })],
    [(p) => p.z >= box.minZ, (a, b) => ({ x: a.x + ((b.x - a.x) * (box.minZ - a.z)) / (b.z - a.z), z: box.minZ })],
    [(p) => p.z <= box.maxZ, (a, b) => ({ x: a.x + ((b.x - a.x) * (box.maxZ - a.z)) / (b.z - a.z), z: box.maxZ })],
  ]
  let output = ring
  for (const [isIn, cross] of edgesOf) {
    const input = output
    output = []
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i]
      const previous = input[(i + input.length - 1) % input.length]
      if (isIn(current)) {
        if (!isIn(previous)) output.push(cross(previous, current))
        output.push(current)
      } else if (isIn(previous)) {
        output.push(cross(previous, current))
      }
    }
    if (!output.length) break
  }
  return output
}

/** 넓이(m², 부호 있음). 지도 좌표(x 동쪽, z 남쪽)에서 +면 반시계 방향입니다. */
const signedArea = (ring) => ring.reduce((sum, p, i) => sum + p.x * ring[(i + 1) % ring.length].z - ring[(i + 1) % ring.length].x * p.z, 0) / 2
const area = (ring) => Math.abs(signedArea(ring))
const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`

/** 여러 선(멤버 way)을 끝점끼리 이어 닫힌 고리로 만듭니다. */
function joinRings(lines) {
  const rings = []
  const pool = lines.filter((line) => line.length > 1).map((line) => [...line])
  while (pool.length) {
    const ring = pool.shift()
    for (let grown = true; grown && key(ring[0]) !== key(ring.at(-1)); ) {
      grown = false
      for (let i = 0; i < pool.length; i += 1) {
        const line = pool[i]
        if (key(line[0]) === key(ring.at(-1))) ring.push(...line.slice(1))
        else if (key(line.at(-1)) === key(ring.at(-1))) ring.push(...line.reverse().slice(1))
        else continue
        pool.splice(i, 1)
        grown = true
        break
      }
    }
    if (key(ring[0]) === key(ring.at(-1))) rings.push(ring.slice(0, -1))
  }
  return rings
}

const toRing = (geometry) => geometry.map((p) => toLocal(p.lat, p.lon))
function polygons(filter, minArea, tolerance) {
  const result = []
  const push = (outer, holes) => {
    const clipped = clip(simplify([...outer, outer[0]], tolerance).slice(0, -1), bounds)
    if (clipped.length < 3 || area(clipped) < minArea) return
    const inner = holes.map((hole) => clip(simplify([...hole, hole[0]], tolerance).slice(0, -1), bounds)).filter((hole) => hole.length > 2 && area(hole) > minArea / 10)
    result.push({ outer: encode(clipped), holes: inner.map(encode) })
  }
  for (const el of areasRaw.elements) {
    if (!filter(el.tags ?? {})) continue
    if (el.type === 'way' && el.geometry) push(toRing(el.geometry.slice(0, -1)), [])
    if (el.type === 'relation') {
      const lines = (role) => el.members.filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => m.geometry)
      const holes = joinRings(lines('inner')).map(toRing)
      for (const outer of joinRings(lines('outer')).map(toRing)) push(outer, holes)
    }
  }
  return result
}

/** 건물 높이(m): height 태그, 없으면 층수 × 3.3m */
function buildingHeight(tags) {
  const height = Number.parseFloat(tags.height)
  if (Number.isFinite(height) && height > 0) return height
  const levels = Number.parseFloat(tags['building:levels'])
  return Number.isFinite(levels) && levels > 0 ? levels * 3.3 : null
}

/** 높은 건물: [높이(m), x0, z0, dx1, dz1, …] 바닥 둘레(반시계 방향). 가운데가 안쪽 범위에 있는 것만 둡니다. */
const buildings = []
function addBuilding(ring, height) {
  let points = simplify([...ring, ring[0]], 1).slice(0, -1)
  if (points.length < 3 || area(points) < 80) return
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, z: sum.z + p.z / points.length }), { x: 0, z: 0 })
  if (!within(detail)(center)) return
  // 앱은 바닥이 반시계 방향이라고 보고 벽의 바깥쪽을 정합니다.
  if (signedArea(points) < 0) points = points.reverse()
  const encoded = encode(points)
  if (encoded.length >= 6) buildings.push([Math.round(height), ...encoded])
}
for (const el of buildingsRaw.elements) {
  const height = buildingHeight(el.tags ?? {})
  if (!height) continue
  if (el.type === 'way' && el.geometry) addBuilding(toRing(el.geometry.slice(0, -1)), height)
  if (el.type === 'relation') {
    const outers = el.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => m.geometry)
    for (const outer of joinRings(outers).map(toRing)) addBuilding(outer, height)
  }
}

const map = {
  version: 2,
  attribution: '© OpenStreetMap 기여자 (ODbL 1.0)',
  center: MAP_CENTER,
  bounds,
  detail,
  roads,
  water: polygons((tags) => tags.natural === 'water', 15_000, 4),
  parks: polygons((tags) => tags.leisure === 'park', 40_000, 6),
  buildings,
}
await mkdir(new URL('public/maps/', ROOT), { recursive: true })
const json = JSON.stringify(map)
await writeFile(new URL('public/maps/seoul.json', ROOT), json)
const segments = Object.values(roads).reduce((sum, list) => sum + list.reduce((s, line) => s + line.length / 2 - 1, 0), 0)
console.log(
  `[map] public/maps/seoul.json ${(json.length / 1024).toFixed(0)}KB, 도로 선분 ${segments}개, 물 ${map.water.length}개, 공원 ${map.parks.length}개, 건물 ${buildings.length}동`,
)
