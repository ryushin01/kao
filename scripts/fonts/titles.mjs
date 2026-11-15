// 제목 글꼴(오빗)에 미리 담을 글자: src의 Vue 화면에서 h1·h2 제목에 쓰는 글자입니다.
// 제목에 직접 적은 글자, 제목 안 {{ }}의 문자열, 그 안에서 쓰는 변수(heading·title 등)에 넣는 문자열,
// 제목 위젯에 넘기는 title="…" 값과 그 기본값을 모읍니다. scripts/build-fonts.mjs가 읽습니다.
// 여기서 빠진 글자는 나머지 글자 조각(첫 화면 뒤에 붙음)에서 받으므로 화면이 깨지지는 않습니다.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

/** 코드 조각 안의 문자열 값 */
const strings = (code) =>
  [...code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3])

async function* vueFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* vueFiles(file)
    else if (file.endsWith('.vue') && !/\.(test|stories)\./.test(file)) yield file
  }
}

export default async function titles() {
  const out = []
  for await (const file of vueFiles(SRC)) {
    const text = await readFile(file, 'utf8')
    const script = text.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
    for (const [, inner] of text.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/g)) {
      const plain = inner
        .replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
          out.push(...strings(expr))
          for (const id of new Set(expr.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
            for (const [line] of script.matchAll(new RegExp(`\\b${id}\\b[^\\n]*`, 'g'))) out.push(...strings(line))
          }
          return ' '
        })
        .replace(/<[^>]+>/g, ' ')
      out.push(plain)
    }
    for (const [, value] of text.matchAll(/\btitle="([^"]*)"/g)) out.push(value)
  }
  return out.join('')
}
