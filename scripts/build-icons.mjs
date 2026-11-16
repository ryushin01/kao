/**
 * 파비콘(public/favicon.svg)과 README 첫 화면 사진으로 웹 앱·알림 아이콘과 공유 미리보기 이미지를 만듭니다: `pnpm icons`
 * 파비콘을 바꾸면 이 명령으로 아래 파일을 모두 다시 만듭니다(하나라도 빠지면 그 자리에 예전 아이콘이 남음).
 *
 * - favicon.ico: SVG 파비콘을 읽지 못하는 브라우저·도구가 기본으로 찾는 /favicon.ico(16·32·48 PNG를 ICO 하나에).
 *   없으면 Nuxt 서버가 /favicon.ico에 그림이 아닌 자리 표시 글자를 돌려줍니다
 * - apple-touch-icon.png: iPhone 홈 화면 아이콘(180, 바탕 그대로, 알파 없음)
 * - icon-192.png, icon-512.png: 웹 앱 매니페스트 아이콘(그대로)
 * - icon-maskable-512.png: 안드로이드가 원·둥근 사각형으로 잘라도 눈금이 남도록 가운데 72%로 줄이고 바탕색으로 채움
 * - badge-96.png: 안드로이드 알림 표시줄용. 바탕 없이 모양만 흰색(알림 표시줄은 투명도만 씀)
 * - og-image.jpg: 1200×630 공유 미리보기. README 첫 화면 사진(docs/images/home.jpg)을 머리글 아래부터 자름
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = new URL('../', import.meta.url)
// URL.pathname은 공백·한글이 든 경로를 %로 바꿔 두므로 파일 경로는 fileURLToPath로 바꿉니다.
const out = (name) => fileURLToPath(new URL(`public/${name}`, ROOT))
const svg = await readFile(new URL('public/favicon.svg', ROOT), 'utf8')
const background = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1] ?? '#000000'

const png = (size, source = svg) => sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 })

// ICO: 머리(6바이트) + 이미지마다 16바이트 목록 + PNG 원본을 차례로
const icoSizes = [16, 32, 48]
const icoImages = await Promise.all(icoSizes.map((size) => png(size).toBuffer()))
const icoHeader = Buffer.alloc(6 + 16 * icoImages.length)
icoHeader.writeUInt16LE(1, 2) // 종류: 아이콘
icoHeader.writeUInt16LE(icoImages.length, 4)
let icoOffset = icoHeader.length
icoImages.forEach((image, index) => {
  const entry = 6 + 16 * index
  icoHeader.writeUInt8(icoSizes[index], entry) // 너비
  icoHeader.writeUInt8(icoSizes[index], entry + 1) // 높이
  icoHeader.writeUInt16LE(1, entry + 4) // 색 평면
  icoHeader.writeUInt16LE(32, entry + 6) // 픽셀당 비트
  icoHeader.writeUInt32LE(image.length, entry + 8)
  icoHeader.writeUInt32LE(icoOffset, entry + 12)
  icoOffset += image.length
})
await writeFile(out('favicon.ico'), Buffer.concat([icoHeader, ...icoImages]))

// iPhone은 투명한 곳을 검게 칠하므로 바탕색으로 채워 알파 채널 없이 저장합니다.
await png(180).flatten({ background }).toFile(out('apple-touch-icon.png'))

for (const size of [192, 512]) {
  await png(size).toFile(out(`icon-${size}.png`))
}

const inner = Math.round(512 * 0.72)
await sharp({ create: { width: 512, height: 512, channels: 4, background } })
  .composite([{ input: await sharp(Buffer.from(svg)).resize(inner, inner).png().toBuffer(), gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile(out('icon-maskable-512.png'))

// 바탕 사각형을 빼고 모든 선을 흰색으로(알림 표시줄은 모양의 투명도만 씀)
const silhouette = svg.replace(/<rect[^>]*\/>/, '').replace(/stroke="#[0-9a-f]{3,6}"/gi, 'stroke="#ffffff"').replace(/fill="#[0-9a-f]{3,6}"/gi, 'fill="#ffffff"')
await png(96, silhouette).toFile(out('badge-96.png'))

await sharp(fileURLToPath(new URL('docs/images/home.jpg', ROOT)))
  .extract({ left: 0, top: 64, width: 1440, height: 756 })
  .resize(1200, 630)
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(out('og-image.jpg'))

console.log('[icons] favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png, badge-96.png, og-image.jpg')
