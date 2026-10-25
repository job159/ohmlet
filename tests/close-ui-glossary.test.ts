/**
 * Release close-out (GLOSSARY-ENTRIES): the scope's 上升時間 and the
 * analyzer's I²C lane letters are real glossary ids of
 * src/ui/embedded/glossary.ts — defined there, not registered by the
 * instruments at import time — with the instruments' English text word for
 * word (zh-TW in src/i18n/zh-TW/qa-instruments.ts). This file imports the
 * glossary alone: nothing else can have registered them.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { GLOSSARY, glossaryText, type GlossaryId } from '../src/ui/embedded/glossary'

beforeEach(() => __setLangForTests('zh-TW'))

describe('GLOSSARY-ENTRIES: rise and i2c-lane', () => {
  it('are defined by the glossary itself', () => {
    const ids: GlossaryId[] = ['rise', 'i2c-lane']
    for (const id of ids) expect(Object.prototype.hasOwnProperty.call(GLOSSARY, id), id).toBe(true)
    expect(GLOSSARY.rise).toEqual({
      title: 'Rise time (10–90 %)',
      body: 'How long the signal takes to climb from 10 % to 90 % of its swing. For an RC circuit it is about 2.2 × R × C.',
    })
    expect(GLOSSARY['i2c-lane']).toEqual({
      title: 'I²C lane letters',
      body: 'S = start, Sr = repeated start, P = stop, A = ACK (answered), N = NACK (no answer).',
    })
  })

  it('read in zh-TW', () => {
    expect(glossaryText('rise').title).toBe('上升時間（10–90 %）')
    expect(glossaryText('rise').body).toContain('2.2 × R × C')
    expect(glossaryText('rise').body).not.toMatch(/How long/)
    expect(glossaryText('i2c-lane')).toEqual({ title: 'I²C 解碼字母', body: 'S＝開始、Sr＝重複開始、P＝停止、A＝ACK（有回應）、N＝NACK（沒有回應）。' })
  })

  it('the instruments’ other ids stay as they are', () => {
    for (const id of ['period', 'edges', 'dt', 'burst', 'baud', 'vpp', 'avg', 'rms', 'trigger', 'holdoff', 'vdiv', 'tdiv', 'ack', '8n1'] as GlossaryId[]) {
      expect(GLOSSARY[id], id).toBeDefined()
    }
    expect(glossaryText('holdoff').title).toBe('觸發抑制時間')
  })
})
