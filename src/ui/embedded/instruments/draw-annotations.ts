/**
 * Canvas drawing of one decoder annotation lane (logic analyzer): rounded
 * boxes tinted by tone, the full label when it fits, else the short one,
 * else none. Spans narrower than 3 px merge into one dense bar so a long
 * capture zoomed out still shows WHERE traffic is without drawing
 * thousands of slivers. Items are sorted by t0 (decoder output).
 */
import type { LogicAnnotation } from '../logic-decoders'

const TONE: Record<NonNullable<LogicAnnotation['tone']>, { fill: string; stroke: string }> = {
  data: { fill: 'rgba(10, 132, 255, 0.30)', stroke: 'rgba(64, 160, 255, 0.85)' },
  addr: { fill: 'rgba(191, 90, 242, 0.30)', stroke: 'rgba(205, 130, 255, 0.85)' },
  control: { fill: 'rgba(255, 159, 10, 0.26)', stroke: 'rgba(255, 179, 64, 0.85)' },
  ack: { fill: 'rgba(48, 209, 88, 0.26)', stroke: 'rgba(80, 220, 120, 0.85)' },
  nack: { fill: 'rgba(255, 107, 97, 0.20)', stroke: 'rgba(255, 130, 120, 0.75)' },
  error: { fill: 'rgba(255, 69, 58, 0.42)', stroke: 'rgba(255, 95, 85, 1)' },
}

const TEXT = '#e8ecf2'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

/** First item whose t1 >= t (items sorted by t0, spans of one lane do not nest). */
function firstVisible(items: readonly LogicAnnotation[], t: number): number {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].t0 < t) lo = mid + 1
    else hi = mid
  }
  // step back over spans that started earlier but still reach into view
  while (lo > 0 && items[lo - 1].t1 >= t) lo--
  return lo
}

export function drawAnnotationLane(
  ctx: CanvasRenderingContext2D,
  items: readonly LogicAnnotation[],
  y: number,
  h: number,
  width: number,
  t0: number,
  t1: number,
): void {
  const xOf = (t: number) => ((t - t0) / (t1 - t0)) * width
  const top = y + 2
  const bh = h - 4
  ctx.save()
  ctx.font = "10px 'SF Mono', ui-monospace, Menlo, Consolas, monospace"
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let denseFrom = NaN
  let denseTo = NaN
  let denseTone: LogicAnnotation['tone'] = 'data'
  const flushDense = () => {
    if (!Number.isFinite(denseFrom)) return
    const c = TONE[denseTone ?? 'data']
    ctx.fillStyle = c.stroke
    ctx.globalAlpha = 0.55
    ctx.fillRect(denseFrom, top + bh / 2 - 2, Math.max(1, denseTo - denseFrom), 4)
    ctx.globalAlpha = 1
    denseFrom = NaN
  }
  for (let i = firstVisible(items, t0); i < items.length; i++) {
    const a = items[i]
    if (a.t0 > t1) break
    if (a.t1 < t0) continue
    const xa = xOf(a.t0)
    const xb = xOf(a.t1)
    const tone = a.tone ?? 'data'
    if (xb - xa < 3) {
      // dense run: merge neighbours closer than 2 px
      if (Number.isFinite(denseFrom) && xa - denseTo <= 2) {
        denseTo = Math.max(denseTo, xb)
        if (tone === 'error') denseTone = 'error'
      } else {
        flushDense()
        denseFrom = xa
        denseTo = xb
        denseTone = tone
      }
      continue
    }
    flushDense()
    const c = TONE[tone]
    const x0 = Math.max(-4, xa) + 0.5
    const x1 = Math.min(width + 4, xb) - 0.5
    roundRect(ctx, x0, top + 0.5, Math.max(1, x1 - x0), bh - 1, 4)
    ctx.fillStyle = c.fill
    ctx.fill()
    ctx.strokeStyle = c.stroke
    ctx.lineWidth = 1
    ctx.stroke()
    // label: centred in the visible part of the box
    const vx0 = Math.max(0, xa)
    const vx1 = Math.min(width, xb)
    const room = vx1 - vx0 - 6
    if (room < 7) continue
    let label = a.text
    if (ctx.measureText(label).width > room) label = a.short ?? ''
    if (!label || ctx.measureText(label).width > room) continue
    ctx.fillStyle = TEXT
    ctx.fillText(label, (vx0 + vx1) / 2, top + bh / 2 + 0.5)
  }
  flushDense()
  ctx.restore()
}
