// 내려받은 glTF의 노드·재질 구조를 출력합니다. (사용: node scripts/inspect-model.mjs <scene.gltf>)
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(process.argv[2])
const root = doc.getRoot()
const scene = root.getDefaultScene() ?? root.listScenes()[0]
console.log('bounds', JSON.stringify(getBounds(scene)))
console.log('materials', root.listMaterials().map((m) => `${m.getName()}${m.getBaseColorTexture() ? '[tex]' : ''}(${m.getBaseColorFactor().map((v) => v.toFixed(2)).join(',')})`).join(' | '))
console.log('textures', root.listTextures().length, 'meshes', root.listMeshes().length, 'nodes', root.listNodes().length)
const walk = (node, depth) => {
  if (depth > 6) return
  const mesh = node.getMesh()
  const mats = mesh ? [...new Set(mesh.listPrimitives().map((p) => p.getMaterial()?.getName()))].join(',') : ''
  console.log(`${'  '.repeat(depth)}${node.getName()}${mesh ? ` <${mats}>` : ''} t=${node.getTranslation().map((v) => v.toFixed(2))}`)
  node.listChildren().forEach((c) => walk(c, depth + 1))
}
scene.listChildren().forEach((n) => walk(n, 0))
