/**
 * ErcPanel / ErcView smoke tests (node, server render): findings grouped by
 * level, count badges, the per-finding "Select parts" control (wired to the
 * finding's component and wire ids) and the honesty statement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ErcPanel, ErcView } from '../../src/ui/embedded/ErcPanel'
import { runErc } from '../../src/sim/erc'
import { part, railsWorld, w } from './helpers'
import { __setLangForTests } from '../../src/i18n'

// These assertions check the English source strings; zh-TW coverage of the
// panel lives in the i18n tests.
beforeAll(() => __setLangForTests('en'))
afterAll(() => __setLangForTests('zh-TW'))

describe('ErcView', () => {
  const layout = railsWorld(
    [part('D1', 'led', ['top+5', 'top-5']), { id: 'SW1', type: 'pushbutton', at: 'f50' }],
    [w('top+3', 'a50'), w('top-3', 'a52')],
  )

  it('lists findings by level with badges, select buttons and the honesty note', () => {
    const html = renderToStaticMarkup(
      createElement(ErcView, { result: { findings: runErc(layout) }, live: false, onSelect: () => {} }),
    )
    expect(html).toContain('Electrical rules')
    expect(html).toMatch(/erc-badge is-error[^>]*>1</)
    expect(html).toMatch(/erc-badge is-risk[^>]*>1</)
    expect(html).toContain('1 error · 1 risk')
    expect(html.indexOf('>Error <')).toBeGreaterThan(0)
    expect(html.indexOf('>Error <')).toBeLessThan(html.indexOf('>Risk <'))
    expect(html).toContain('Select parts')
    expect(html).toContain('aria-label="Select parts D1"')
    expect(html).toContain('D1 sits directly across')
    expect(html).toContain('not a proof that the circuit works or is safe')
    expect(html).toContain('start the simulation to add live readings')
  })

  it('says when live readings are included, and when nothing is found', () => {
    const live = renderToStaticMarkup(createElement(ErcView, { result: { findings: [] }, live: true, onSelect: () => {} }))
    expect(live).toContain('No problems found')
    expect(live).toContain('latest simulation readings')
    expect(live).not.toContain('erc-badge')
  })

  it('shows a checker failure instead of hiding it', () => {
    const html = renderToStaticMarkup(createElement(ErcView, { result: { error: 'boom' }, live: false, onSelect: () => {} }))
    expect(html).toContain('could not run')
    expect(html).toContain('boom')
  })

  it('the store-bound ErcPanel renders', () => {
    expect(renderToStaticMarkup(createElement(ErcPanel))).toContain('Electrical rules')
  })
})
