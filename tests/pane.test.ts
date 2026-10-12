import { test, expect } from 'claude-code/testing'

test('the pane draws its title before any report has arrived', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'crab-ledger',
      surface,
      component: 'Pane',
      requestId: 'crab-ledger',
      props: { title: 'Crab ledger', isFocused: false } as never,
    })
    expect(await ui.find({ type: 'Text', text: /Crab ledger/ })).toBeDefined()
    await ui.unmount()
  }
})
