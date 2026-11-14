/**
 * 관제 지도용 서울 도심 지도 데이터를 OpenStreetMap에서 만듭니다(지도 데이터 © OpenStreetMap 기여자, ODbL 1.0).
 *
 *   pnpm build:map            # assets-src/osm/에 받아 둔 원본으로 만들기
 *   pnpm build:map --fetch    # Overpass API에서 원본을 다시 받은 뒤 만들기
 *
 * 만드는 것
 * - src/shared/config/routes.ts: 탈것 4대의 주행 경로. 실제 도로를 따라 닫힌 경로(위도·경도)
 * - public/maps/seoul.json: 관제 지도에 그리는 도로·한강·공원(지도 중심 기준 m 좌표, 정수)
 *
 * 경로는 경유점(도로 이름·진행 방향)을 잇는 최단 경로입니다. 간선 도로는 일방통행을 지키고, 진출입로(_link)는
 * 양방향으로 두어 교차로 구조 때문에 크게 돌지 않게 합니다. 그래도 교차로에서 나갔다 되돌아오는 짧은 구간이
 * 생기면 잘라 냅니다(removeSpurs). Node 22.18 이상이 TS 파일을 그대로 불러와 앱과 같은 좌표 변환을 씁니다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { MAP_CENTER, toLocal } from '../src/shared/lib/route-geo.ts'

const { values: args } = parseArgs({ options: { fetch: { type: 'boolean', default: false } } })
const ROOT = new URL('../', import.meta.url)
const RAW = new URL('assets-src/osm/', ROOT)

/** 경로 계산용(진출입로가 화면 밖으로 잠깐 나가는 곳까지 넉넉히)과 화면용 범위: [남, 서, 북, 동] */
const ROUTING_BBOX = [37.495, 126.893, 37.595, 127.027]
const DISPLAY_BBOX = [37.5, 126.9, 37.584, 127.022]

// ── 원본 받기 ───────────────────────────────────────────────────────────────

const QUERIES = {
  roads: `[out:json][timeout:240];(
    way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|cycleway)$"](${ROUTING_BBOX});
    way["highway"~"^(path|footway)$"]["bicycle"~"^(yes|designated)$"](${ROUTING_BBOX});
  );out body;>;out skel qt;`,
  minor: `[out:json][timeout:240];(way["highway"~"^(residential|unclassified|living_street)$"](${DISPLAY_BBOX}););out body;>;out skel qt;`,
  areas: `[out:json][timeout:240];(
    relation["natural"="water"](${DISPLAY_BBOX});way["natural"="water"](${DISPLAY_BBOX});
    relation["leisure"="park"](${DISPLAY_BBOX});way["leisure"="park"](${DISPLAY_BBOX});
  );out geom;`,
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 공용 Overpass 서버는 붐비면 429·502·504를 돌려주므로, 잠시 기다렸다가 다른 서버로도 다시 요청합니다. */
async function overpass(name, query) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const endpoint = OVERPASS[attempt % OVERPASS.length]
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'kao-map-builder (https://github.com/ryushin01/kao)' },
      body: new URLSearchParams({ data: query }),
    }).catch((error) => ({ ok: false, status: error.message }))
    if (response.ok) return response.text()
    console.log(`[map] ${name}: ${new URL(endpoint).host} ${response.status}, 다시 요청합니다.`)
    await wait(15_000 * (attempt + 1))
  }
  throw new Error(`Overpass에서 ${name}을 받지 못했습니다.`)
}

async function fetchRaw() {
  await mkdir(RAW, { recursive: true })
  for (const [name, query] of Object.entries(QUERIES)) {
    console.log(`[map] Overpass에서 ${name} 받는 중…`)
    await writeFile(new URL(`${name}.json`, RAW), await overpass(name, query))
    // Overpass 공용 서버 사용 규칙: 요청 사이를 띄웁니다.
    await wait(3000)
  }
}

if (args.fetch) await fetchRaw()
const load = async (name) => {
  try {
    return JSON.parse(await readFile(new URL(`${name}.json`, RAW), 'utf8'))
  } catch {
    throw new Error(`assets-src/osm/${name}.json이 없습니다. pnpm build:map --fetch로 먼저 받아 주세요.`)
  }
}
const [roadsRaw, minorRaw, areasRaw] = await Promise.all([load('roads'), load('minor'), load('areas')])

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
  // 진출입로는 양방향으로 둡니다(지도 축척에서는 차이가 보이지 않고, 교차로마다 크게 돌아가는 것을 막음).
  const oneway = !t.highway.endsWith('_link') && (t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.highway === 'motorway')
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

/** 교차로에서 나갔다가 60m 안으로 되돌아오는 구간(250m 이상, 한 바퀴의 40% 미만)을 잘라 냅니다. */
function removeSpurs(path) {
  for (let changed = true; changed; ) {
    changed = false
    const points = path.map((id) => nodes.get(id))
    const cumulative = [0]
    for (let i = 1; i < points.length; i += 1) cumulative[i] = cumulative[i - 1] + distance(points[i - 1], points[i])
    const total = cumulative.at(-1) + distance(points.at(-1), points[0])
    search: for (let i = 0; i < points.length; i += 1) {
      for (let j = points.length - 1; j > i + 2; j -= 1) {
        const along = cumulative[j] - cumulative[i]
        if (along > total * 0.4 || along < 250) continue
        if (distance(points[i], points[j]) < 60) {
          path.splice(i + 1, j - i - 1)
          changed = true
          break search
        }
      }
    }
  }
  return path
}

/** Douglas–Peucker. points는 {x, z}, 처음과 끝 점은 남깁니다. */
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
    const dx = b.x - a.x
    const dz = b.z - a.z
    const span = Math.hypot(dx, dz)
    let index = -1
    let max = tolerance
    for (let i = first + 1; i < last; i += 1) {
      // 처음과 끝이 같은 점(닫힌 고리)이면 선까지가 아니라 그 점까지의 거리로 잽니다.
      const d = span === 0 ? distance(a, points[i]) : Math.abs(dx * (a.z - points[i].z) - dz * (a.x - points[i].x)) / span
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
    name: '반포·동작 한강 순환',
    via: '강변북로 → 반포대교 → 올림픽대로 → 동작대교',
    allow: car,
    removeSpurs: true,
    waypoints: [
      { name: '강변북로', lat: 37.5178, lng: 126.991, heading: 52 },
      { name: '반포대로', lat: 37.5126, lng: 126.9975, heading: 160, tags: { layer: '2' } },
      { name: '올림픽대로', lat: 37.508, lng: 126.99, heading: 260 },
      { name: '동작대로', lat: 37.512, lng: 126.9822, heading: 15, tags: { 'bridge:name': '동작대교' } },
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
  if (plan.removeSpurs) removeSpurs(path)
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

const corner1 = toLocal(DISPLAY_BBOX[0], DISPLAY_BBOX[1])
const corner2 = toLocal(DISPLAY_BBOX[2], DISPLAY_BBOX[3])
const bounds = { minX: Math.round(corner1.x), maxX: Math.round(corner2.x), minZ: Math.round(corner2.z), maxZ: Math.round(corner1.z) }
const inside = (p) => p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ

const ROAD_CLASS = {
  motorway: 'trunk', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary',
  motorway_link: 'link', trunk_link: 'link', primary_link: 'link', secondary_link: 'link', tertiary_link: 'link',
  residential: 'minor', unclassified: 'minor', living_street: 'minor', cycleway: 'cycleway', path: 'cycleway', footway: 'cycleway',
}
const TOLERANCE = { trunk: 2, primary: 2, secondary: 2, tertiary: 2.5, link: 2, minor: 4, cycleway: 3 }
const roads = Object.fromEntries(Object.keys(TOLERANCE).map((key) => [key, []]))
for (const way of [...roadWays, ...minorWays]) {
  const kind = ROAD_CLASS[way.tags.highway]
  if (!kind) continue
  // 화면 밖 구간은 잘라 내고, 안쪽에 이어진 조각만 남깁니다.
  let piece = []
  const flush = () => {
    if (piece.length > 1) roads[kind].push(simplify(piece, TOLERANCE[kind]).flatMap((p) => [Math.round(p.x), Math.round(p.z)]))
    piece = []
  }
  for (const id of way.nodes) {
    const node = nodes.get(id)
    if (node && inside(node)) piece.push(node)
    else flush()
  }
  flush()
}

/** 다각형을 화면 사각형으로 자릅니다(Sutherland–Hodgman). */
function clip(ring) {
  const edgesOf = [
    [(p) => p.x >= bounds.minX, (a, b) => ({ x: bounds.minX, z: a.z + ((b.z - a.z) * (bounds.minX - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= bounds.maxX, (a, b) => ({ x: bounds.maxX, z: a.z + ((b.z - a.z) * (bounds.maxX - a.x)) / (b.x - a.x) })],
    [(p) => p.z >= bounds.minZ, (a, b) => ({ x: a.x + ((b.x - a.x) * (bounds.minZ - a.z)) / (b.z - a.z), z: bounds.minZ })],
    [(p) => p.z <= bounds.maxZ, (a, b) => ({ x: a.x + ((b.x - a.x) * (bounds.maxZ - a.z)) / (b.z - a.z), z: bounds.maxZ })],
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

const area = (ring) => Math.abs(ring.reduce((sum, p, i) => sum + p.x * ring[(i + 1) % ring.length].z - ring[(i + 1) % ring.length].x * p.z, 0) / 2)
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
    const clipped = clip(simplify([...outer, outer[0]], tolerance).slice(0, -1))
    if (clipped.length < 3 || area(clipped) < minArea) return
    const flat = (ring) => ring.flatMap((p) => [Math.round(p.x), Math.round(p.z)])
    const inner = holes.map((hole) => clip(simplify([...hole, hole[0]], tolerance).slice(0, -1))).filter((hole) => hole.length > 2 && area(hole) > minArea / 10)
    result.push({ outer: flat(clipped), holes: inner.map(flat) })
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

const map = {
  attribution: '© OpenStreetMap 기여자 (ODbL 1.0)',
  center: MAP_CENTER,
  bounds,
  roads,
  water: polygons((tags) => tags.natural === 'water', 15_000, 4),
  parks: polygons((tags) => tags.leisure === 'park', 40_000, 6),
}
await mkdir(new URL('public/maps/', ROOT), { recursive: true })
const json = JSON.stringify(map)
await writeFile(new URL('public/maps/seoul.json', ROOT), json)
const segments = Object.values(roads).reduce((sum, list) => sum + list.reduce((s, line) => s + line.length / 2 - 1, 0), 0)
console.log(`[map] public/maps/seoul.json ${(json.length / 1024).toFixed(0)}KB, 도로 선분 ${segments}개, 물 ${map.water.length}개, 공원 ${map.parks.length}개`)
