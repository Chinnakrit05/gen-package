import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildPouchGeometry } from '../../src/components/PouchViewer3D'
import { brickShape, generatePouch } from '../../src/core/pouch'
import { getMaterial } from '../../src/core/materials'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const size = document.querySelector<HTMLSelectElement>('#size')!
const view = document.querySelector<HTMLSelectElement>('#view')!
const grid = document.querySelector<HTMLInputElement>('#grid')!
const output = document.querySelector<HTMLOutputElement>('#result')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
const scene = new THREE.Scene()
scene.background = new THREE.Color('white')
scene.add(new THREE.AmbientLight(0xffffff, 0.85))
for (const [x, y, z, intensity] of [[250, 420, 300, 1.6], [-220, 120, -260, 0.6]]) {
  const light = new THREE.DirectionalLight(0xffffff, intensity)
  light.position.set(x, y, z)
  scene.add(light)
}
const camera = new THREE.PerspectiveCamera(36, 1, 1, 8000)
const controls = new OrbitControls(camera, canvas)
const printMaterial = new THREE.MeshStandardMaterial({ color: 'white', roughness: 0.6, side: THREE.DoubleSide })
const sealMaterial = printMaterial.clone()
const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [printMaterial, sealMaterial])
scene.add(mesh)
let texture: THREE.CanvasTexture | null = null
let height = 120
let widthDepth = Math.hypot(80, 50)
let distance = 300

function render() {
  renderer.render(scene, camera)
  const gl = renderer.getContext()
  const pixels = new Uint8Array(canvas.width * canvas.height * 4)
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  let nonwhite = 0
  for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 245) nonwhite++
  output.dataset.result = nonwhite > 1000 ? 'pass' : 'fail'
  output.textContent = `Rendered pixels: ${nonwhite}; top seal: 20 mm; bottom seal: 20 mm; view: ${view.value}`
}

function resetCamera() {
  const directions: Record<string, [number, number, number]> = {
    front: [0.65, 0.28, 1], back: [-0.65, 0.28, -1], bottom: [0.5, -1, -0.5],
  }
  const [x, y, z] = directions[view.value]
  camera.position.set(x * distance, y * distance, z * distance)
  controls.target.set(0, 0, 0)
  controls.update()
  render()
}

function update() {
  const dims = size.value === 'coffee' ? { W: 80, D: 50, H: 120 } : { W: 250, D: 150, H: 150 }
  const pouch = generatePouch(dims, getMaterial('pouch-foil'), { style: 'gusset' })
  height = brickShape(pouch).topY
  widthDepth = Math.hypot(dims.W, dims.D)
  mesh.geometry.dispose()
  mesh.geometry = buildPouchGeometry(pouch)
  mesh.position.y = -height / 2
  texture?.dispose()
  texture = null
  if (grid.checked) {
    const source = document.createElement('canvas')
    source.width = Math.round(pouch.label.width * 3)
    source.height = Math.round(pouch.label.height * 3)
    const ctx = source.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, source.width, source.height)
    for (let y = 0; y < pouch.label.height; y += 10) {
      for (let x = 0; x < pouch.label.width; x += 10) {
        ctx.fillStyle = `rgb(${40 + x % 150},${60 + y % 160},${80 + (x + y) % 140})`
        ctx.fillRect(x * 3, y * 3, 27, 27)
      }
    }
    texture = new THREE.CanvasTexture(source)
    texture.flipY = false
    texture.colorSpace = THREE.SRGBColorSpace
  }
  printMaterial.map = texture
  printMaterial.needsUpdate = true
  resize()
}

function resize() {
  const rect = canvas.getBoundingClientRect()
  renderer.setSize(Math.round(rect.width), Math.round(rect.height), false)
  camera.aspect = rect.width / rect.height
  camera.updateProjectionMatrix()
  distance = Math.max(height, widthDepth / camera.aspect) * 2.1
  resetCamera()
}
size.addEventListener('change', update)
grid.addEventListener('change', update)
view.addEventListener('change', resetCamera)
controls.addEventListener('change', render)
new ResizeObserver(resize).observe(canvas)
update()
