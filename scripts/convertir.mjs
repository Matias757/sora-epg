// Uso: node scripts/convertir.mjs <guia.xml> <epg.json>
// Lee el XMLTV, lo convierte al formato de la app y lo fusiona con el
// epg.json anterior (si existe) para conservar el historial.
import fs from 'node:fs'

const [entrada, salida] = process.argv.slice(2)
if (!entrada || !salida) {
  console.error('Uso: node convertir.mjs <guia.xml> <epg.json>')
  process.exit(1)
}

const ALIAS = { 'TN.ar': 'TodoNoticias.ar' }
const DIAS_HISTORIAL = 7
const MINIMO_CANALES = 10
const MAX_DESC = 150

function decodificar(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function aSegundos(txt) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?: ([+-])(\d{2})(\d{2}))?/.exec(txt)
  if (!m) return null
  let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  if (m[7]) {
    const desfase = (+m[8] * 60 + +m[9]) * 60000
    ms -= m[7] === '+' ? desfase : -desfase
  }
  return Math.floor(ms / 1000)
}

function etiqueta(bloque, nombre) {
  const m = new RegExp('<' + nombre + '[^>]*>([\\s\\S]*?)</' + nombre + '>').exec(bloque)
  return m ? decodificar(m[1]).trim() : ''
}

const xml = fs.readFileSync(entrada, 'utf8')
const nuevos = {}
const re = /<programme\s+start="([^"]+)"\s+stop="([^"]+)"\s+channel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g
let m
while ((m = re.exec(xml)) !== null) {
  const i = aSegundos(m[1])
  const f = aSegundos(m[2])
  if (i === null || f === null || f <= i) continue
  let id = m[3].replace(/@.*$/, '')
  if (ALIAS[id]) id = ALIAS[id]
  let d = etiqueta(m[4], 'desc')
  if (d.length > MAX_DESC) d = d.slice(0, MAX_DESC - 3).trimEnd() + '...'
  const t = etiqueta(m[4], 'title')
  if (!t) continue
  ;(nuevos[id] = nuevos[id] || []).push({ i, f, t, c: etiqueta(m[4], 'category'), d })
}

const cantidad = Object.keys(nuevos).length
console.log('Canales en la guia nueva: ' + cantidad)
if (cantidad < MINIMO_CANALES) {
  console.error('Muy pocos canales (' + cantidad + '). No se sobrescribe ' + salida)
  process.exit(1)
}

let anterior = { canales: {} }
if (fs.existsSync(salida)) {
  try {
    anterior = JSON.parse(fs.readFileSync(salida, 'utf8'))
  } catch {
    console.warn('El epg.json anterior no se pudo leer; se ignora.')
  }
}

const ahora = Math.floor(Date.now() / 1000)
const corte = ahora - DIAS_HISTORIAL * 86400
const canales = {}
const ids = new Set([...Object.keys(anterior.canales || {}), ...Object.keys(nuevos)])
for (const id of ids) {
  const nuevo = (nuevos[id] || []).sort((a, b) => a.i - b.i)
  const viejo = (anterior.canales && anterior.canales[id]) || []
  const desde = nuevo.length ? nuevo[0].i : Infinity
  const conservados = viejo.filter((p) => p.i < desde && p.f > corte)
  const lista = conservados.concat(nuevo)
  if (lista.length) canales[id] = lista
}

fs.writeFileSync(salida, JSON.stringify({ generado: ahora, canales }))
console.log('Escrito ' + salida + ' (' + Object.keys(canales).length + ' canales)')