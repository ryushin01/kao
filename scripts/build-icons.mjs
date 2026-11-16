/**
 * 파비콘(public/favicon.svg)과 README 첫 화면 사진으로 웹 앱·알림 아이콘과 공유 미리보기 이미지를 만듭니다: `pnpm icons`
 *
 * - icon-192.png, icon-512.png: 웹 앱 매니페스트 아이콘(그대로)
 * - icon-maskable-512.png: 안드로이드가 원·둥근 사각형으로 잘라도 눈금이 남도록 가운데 72%로 줄이고 바탕색으로 채움
 * - badge-96.png: 안드로이드 알림 표시줄용. 바탕 없이 모양만 흰색(알림 표시줄은 투명도만 씀)
 * - og-image.jpg: 1200×630 공유 미리보기. README 첫 화면 사진(docs/images/home.jpg)을 머리글 아래부터 자름
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = new URL('../', import.meta.url)
// URL.pathname은 공백·한글이 든 경로를 %로 바꿔 두므로 파일 경로는 fileURLToPath로 바꿉니다.
const out = (name) => fileURLToPath(new URL(`public/${name}`, ROOT))
const svg = await readFile(new URL('public/favicon.svg', ROOT), 'utf8')
const background = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1] ?? '#000000'

for (const size of [192, 512]) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(out(`icon-${size}.png`))
}

const inner = Math.round(512 * 0.72)
await sharp({ create: { width: 512, height: 512, channels: 4, background } })
  .composite([{ input: await sharp(Buffer.from(svg)).resize(inner, inner).png().toBuffer(), gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile(out('icon-maskable-512.png'))

// 바탕 사각형을 빼고 모든 선을 흰색으로(알림 표시줄은 모양의 투명도만 씀)
const silhouette = svg.replace(/<rect[^>]*\/>/, '').replace(/stroke="#[0-9a-f]{3,6}"/gi, 'stroke="#ffffff"').replace(/fill="#[0-9a-f]{3,6}"/gi, 'fill="#ffffff"')
await sharp(Buffer.from(silhouette)).resize(96, 96).png({ compressionLevel: 9 }).toFile(out('badge-96.png'))

await sharp(fileURLToPath(new URL('docs/images/home.jpg', ROOT)))
  .extract({ left: 0, top: 64, width: 1440, height: 756 })
  .resize(1200, 630)
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(out('og-image.jpg'))

console.log('[icons] icon-192.png, icon-512.png, icon-maskable-512.png, badge-96.png, og-image.jpg')
