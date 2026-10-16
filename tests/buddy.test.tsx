import { expect, mock, test } from 'claude-code/testing'

import type { MoodKind } from '../types'
import { moodAfterTool, moodForTool, moodForTurnEnd, NO_TURN, summary, tallyTool } from '../hooks/mood'
import { draw, frameAt, isRainbow, keepSpaces, restarts, ROWS } from '../hooks/clawd'
import { buildPrompt, clean, parse } from '../hooks/narrate'
import { CLIENT } from '../hooks/register'
import { fit, statusLine } from '../hooks/text'
import type { Cell } from '../hooks/clawd'

const WORKING: readonly MoodKind[] = ['thinking', 'reading', 'searching', 'writing', 'running', 'browsing', 'delegating']
const RESTING: readonly MoodKind[] = ['idle', 'done', 'stopped', 'oops', 'crashed', 'denied']

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const lines = (rows: Cell[][]) => rows.map(cells => keepSpaces(cells.map(cell => cell.ch).join('')))
const colors = (rows: Cell[][]) => new Set(rows.flat().flatMap(cell => [cell.fg, cell.bg]))

test('templates follow the tool, its arguments and its outcome', async () => {
  expect(moodForTool('Read', { file_path: '/a/b/AGENTS.md' })).toEqual({
    kind: 'reading',
    line: 'AGENTS.md を読んでる',
  })
  expect(moodForTool('Read', { file_path: '/a/b/AGENTS.md' }, 1).line).toBe('AGENTS.md に目を通してる')
  expect(moodForTool('Read', { file_path: 'x.ts', offset: 120 }).line).toBe('x.ts の 120 行目あたりを読んでる')
  expect(moodForTool('Bash', { command: 'npm test', description: 'Run tests' }).line).toBe('実行中: Run tests')
  expect(moodForTool('Grep', { pattern: 'TODO', path: '/repo/src' }).line).toBe('「TODO」を src から探してる')
  expect(moodForTool('WebFetch', { url: 'https://docs.example.com/a/b' }).line).toBe('docs.example.com を読みに行ってる')
  expect(moodForTool('mcp__claude_ai_Notion__notion-search', {}).line).toBe('Notion で notion-search を実行中')
  const during = moodForTool('Edit', { file_path: 'x.ts' })
  expect(moodAfterTool(during, { tool: 'Edit', denied: false, isError: false })).toBe(during)
  expect(moodAfterTool(during, { tool: 'Edit', denied: false, isError: true })).toEqual({
    kind: 'oops',
    line: 'Edit がうまくいかなかった…立て直します',
  })
  expect(moodAfterTool(during, { tool: 'Edit', denied: true, isError: false }).kind).toBe('denied')
  expect(moodForTurnEnd('answer').kind).toBe('done')
  expect(moodForTurnEnd('aborted').kind).toBe('stopped')
  expect(moodForTurnEnd('error').kind).toBe('crashed')
})

test('the turn summary counts tools by kind and adds the time at the end', async () => {
  expect(summary(NO_TURN)).toBe('')
  let turn = { ...NO_TURN, startedAt: 1000 }
  for (const tool of ['Bash', 'Read', 'Read', 'mcp__claude_ai_Notion__notion-search']) turn = tallyTool(turn, tool)
  expect(summary(turn)).toBe('ツール 4 回（Read 2 · Bash 1 · MCP 1）')
  expect(summary({ ...turn, endedAt: 1000 + 83_000 })).toBe('1分23秒 · ツール 4 回（Read 2 · Bash 1 · MCP 1）')
})

test('every frame keeps the shape: same rows, one width, no collapsible spaces', async () => {
  const widths = new Set<number>()
  for (const kind of [...WORKING, ...RESTING]) {
    for (let t = 0; t < 90_000; t += 50) {
      const drawn = lines(draw(kind, frameAt(kind, t), 3, t))
      if (drawn.length !== ROWS || drawn.some(line => line.includes(' '))) throw new Error(`${kind} at ${t}ms`)
      for (const line of drawn) widths.add(line.length)
    }
  }
  // もとの Clawd と同じ横 9 文字の体に、揺れの1文字と記号の4文字を足した幅（横に伸びていない）。
  expect([...widths]).toEqual([14])
})

test('working states loop at their own tempo with several poses', async () => {
  expect(frameAt('running', 150)).toBe(frameAt('running', 0))
  expect(frameAt('running', 200)).not.toBe(frameAt('running', 0))
  expect(frameAt('thinking', 450)).toBe(frameAt('thinking', 0))
  expect(frameAt('thinking', 500)).not.toBe(frameAt('thinking', 0))
  for (const kind of WORKING) {
    const poses = new Set<string>()
    for (let t = 0; t < 5000; t += 50) poses.add(JSON.stringify(lines(draw(kind, frameAt(kind, t), 0, 0))))
    expect(poses.size >= 3).toBe(true)
  }
})

test('resting states react with a fitting face, blink now and then, and doze off after a minute', async () => {
  expect(frameAt('done', 0)).toMatchObject({ face: 'joy', arms: 'up' })
  expect(frameAt('done', 3000).face).toBeUndefined()
  expect(frameAt('oops', 0).face).toBe('surprised')
  expect(frameAt('crashed', 0).face).toBe('cry')
  expect(frameAt('denied', 0).face).toBe('annoyed')
  expect(frameAt('stopped', 1500).face).toBe('sad')
  expect(frameAt('idle', 58_000).face).toBe('tired')
  expect(frameAt('oops', 0).dx).not.toBe(frameAt('oops', 100).dx)
  expect(frameAt('stopped', 1500).mark).toBe('...')
  expect(frameAt('idle', 0).face).toBeUndefined()
  expect(frameAt('idle', 2450).face).toBe('closed')
  // 泣き顔の涙は、震えている間も目と別の文字に入って消えない。
  for (let t = 0; t < 2800; t += 100) expect(colors(draw('crashed', frameAt('crashed', t), 0, t)).has('#FFFFFF')).toBe(true)
  for (const kind of RESTING) {
    expect(/^z+$/.test(frameAt(kind, 30_000).mark ?? '')).toBe(false)
    expect(/^z+$/.test(frameAt(kind, 120_000).mark ?? '')).toBe(true)
  }
})

test('working states and the cheering glow in a rainbow that flows and changes each time', async () => {
  expect(isRainbow('running', frameAt('running', 0))).toBe(true)
  expect(isRainbow('done', frameAt('done', 0))).toBe(true)
  expect(isRainbow('done', frameAt('done', 5000))).toBe(false)
  expect(isRainbow('idle', frameAt('idle', 0))).toBe(false)
  expect(colors(draw('idle', frameAt('idle', 0), 0, 0)).has('#D77757')).toBe(true)

  const pose = frameAt('running', 0)
  expect(colors(draw('running', pose, 1, 0)).has('#D77757')).toBe(false)
  expect(colors(draw('running', pose, 1, 0)).has('#1F1F1F')).toBe(true)
  expect(JSON.stringify(draw('running', pose, 1, 300))).not.toBe(JSON.stringify(draw('running', pose, 1, 0)))
  expect(JSON.stringify(draw('running', pose, 2, 0))).not.toBe(JSON.stringify(draw('running', pose, 1, 0)))
})

test('the band draws Claude in a Client that blinks on its own clock', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'work-buddy', surface, ...BAND })
    // 絵と文字を同じ3行に収め、上に1行あける。「Claude」の行は出さない。
    expect((await ui.drawn({ in: CLIENT })).children).toHaveLength(3)
    expect((await ui.drawn({ in: CLIENT })).props).toMatchObject({ paddingTop: 1 })
    expect(JSON.stringify(await ui.drawn({ in: CLIENT }))).not.toContain('Claude')
    const open = JSON.stringify(await ui.drawn({ in: CLIENT }))
    expect(open).toContain('"mono":true')
    expect(open).toContain('#D77757')
    await ui.advance(2450)
    expect(JSON.stringify(await ui.drawn({ in: CLIENT }))).not.toBe(open)
    await ui.unmount()
  }
})

test('a tool call from the main loop changes the line and the tally, and the band yields to a survey', async ($, on) => {
  let seen = ''
  // エンジン自身の描画の代わり: プラグインが譲ったときは空の Box を描く。
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', async () => {
    const ui = await $.ui.mount({ plugin: 'work-buddy', surface: 'terminal', ...BAND })
    seen = (await ui.find({ type: 'Text', text: /を読んでる/, in: CLIENT }))?.text ?? ''
    await ui.unmount()
    return { deny: 'blocked by test' }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'work-buddy', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /待機中/, in: CLIENT })).toBeDefined()
    await ui.unmount()
  }

  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' })
  expect(seen.replace(/\u00a0/g, ' ')).toContain('README.md を読んでる')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'work-buddy', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /Read\sは止められた/, in: CLIENT })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ツール\s1\s回（Read\s1）/, in: CLIENT })).toBeDefined()
    await ui.unmount()
  }

  const shown = await $.ui.mount({ plugin: 'work-buddy', surface: 'terminal', ...BAND })
  expect(await shown.findAll({ type: 'Button' })).toHaveLength(0)
  await shown.unmount()

  const survey = { ...BAND, props: { ...BAND.props, hasSurvey: true } }
  const ui = await $.ui.mount({ plugin: 'work-buddy', surface: 'terminal', ...survey })
  expect(await ui.find({ type: 'Text', text: '止められた' })).toBeUndefined()
  await ui.unmount()
})

test('the marks move too, and a working state that continues keeps its motion going', async () => {
  const marks = (kind: MoodKind, until: number) => {
    const seen = new Set<string>()
    for (let t = 0; t < until; t += 50) seen.add(frameAt(kind, t).mark ?? '')
    return seen
  }
  expect(marks('thinking', 2000)).toEqual(new Set(['?', '??', '???']))
  expect(marks('running', 800)).toEqual(new Set(['!', '!!', '!!!']))
  expect(marks('oops', 800)).toEqual(new Set(['!?', '?!']))

  expect(restarts('running', 'running')).toBe(false)
  expect(restarts('thinking', 'thinking')).toBe(false)
  expect(restarts('thinking', 'running')).toBe(true)
  expect(restarts('oops', 'oops')).toBe(true)
  expect(restarts('done', 'done')).toBe(true)
})

test('the narration prompt carries the request, the note, the actions and the latest result, and the reply gives two lines', async () => {
  const prompt = buildPrompt({
    request: 'ログの警告を直して',
    note: '設定を確認します',
    actions: ['config.ts を読んでる'],
    result: 'export const order = ["b", "a"]',
    goal: '警告の原因を探している',
  })
  expect(prompt).toContain('ログの警告を直して')
  expect(prompt).toContain("Claude's latest note: 設定を確認します")
  expect(prompt).toContain('- config.ts を読んでる')
  expect(prompt).toContain('export const order = ["b", "a"]')
  expect(prompt).toContain('The lines shown now: GOAL: 警告の原因を探している / NOW: (none)')
  expect(parse('GOAL: 「警告の原因を探している」\nNOW: config.ts で読み込み順が逆なのを見つけた。')).toEqual({
    goal: '警告の原因を探している',
    progress: 'config.ts で読み込み順が逆なのを見つけた',
  })
  expect(parse('GOAL: 警告の原因を探している')).toBeUndefined()
  expect(clean('「?」「!」の動きを確認している')).toBe('「?」「!」の動きを確認している')
  expect(clean('  ')).toBeUndefined()
})

test('text fits the band by display width, and the second line counts seconds or shows what is being written', async () => {
  expect(fit('あいうえお', 6)).toBe('あい…')
  expect(fit('abc', 6)).toBe('abc')
  expect(statusLine('README.md を読んでる', undefined)).toBe('README.md を読んでる')
  expect(statusLine('', { elapsedMs: 12_400 })).toBe('考え中 12秒')
  expect(statusLine('', { elapsedMs: 65_000 })).toBe('考え中 1分5秒')
  expect(statusLine('', { elapsedMs: 3000, writing: '原因は\n設定の順番です' })).toBe('書いてる: 原因は 設定の順番です')
})

test('after a tool finishes, Haiku writes the goal and what was found, at most once every 4 seconds, on the top two lines', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const asked: string[] = []
  on('model.complete', ($, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: `GOAL: 警告の原因を探している\nNOW: 読み込み順が逆なのを見つけた${asked.length}`, usage: {} } } as never
  })
  on('tool.call', () => ({ deny: 'test' }))

  await $.tool.call({ tool: 'Read', file_path: '/repo/config.ts' })
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' })
  await clock.settle()
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('- config.ts を読んでる')
  expect(asked[0]).toContain('denied: test')

  const ui = await $.ui.mount({ plugin: 'work-buddy', surface: 'terminal', ...BAND })
  const rows = (await ui.drawn({ in: CLIENT })).children as { children: unknown[] }[]
  expect(JSON.stringify(rows[0])).toContain('警告の原因を探している')
  expect(JSON.stringify(rows[1])).toContain('読み込み順が逆なのを見つけた1')
  expect(JSON.stringify(rows[2])).toContain('止められた')
  await ui.unmount()

  await clock.advance(4000)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' })
  await clock.settle()
  expect(asked).toHaveLength(2)
})

test('the three lines read as a hierarchy: bold goal, colored finding that flashes when it changes, dim action', async ($, on) => {
  const clock = mock.clock(on, { now: 5_000_000 })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'GOAL: 警告の原因を探している\nNOW: 読み込み順が逆なのを見つけた', usage: {} } }) as never)
  on('tool.call', () => ({ deny: 'test' }))

  const ui = await $.ui.mount({ plugin: 'work-buddy', surface: 'terminal', ...BAND })
  await $.tool.call({ tool: 'Read', file_path: '/repo/config.ts' })
  await clock.settle()

  type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const rows = async () => (await ui.drawn({ in: CLIENT })).children as Node[]
  const styled = (row: Node, text: RegExp) =>
    (row.children ?? []).find((part): part is Node => typeof part === 'object' && text.test(JSON.stringify(part)))?.props

  let [goal, finding, action] = await rows()
  expect(styled(goal!, /警告の原因を探している/)).toMatchObject({ bold: true })
  expect(styled(finding!, /読み込み順が逆なのを見つけた/)).toMatchObject({ color: 'claude', bold: true })
  expect(styled(action!, /止められた/)).toMatchObject({ dimColor: true })
  expect(styled(action!, /ツール/)).toMatchObject({ color: 'inactive' })

  await ui.advance(2100)
  ;[goal, finding, action] = await rows()
  expect(styled(finding!, /読み込み順が逆なのを見つけた/)).toMatchObject({ color: 'claude', bold: false })
  await ui.unmount()
})

test('the band uses a new Client key, so a reload does not reuse the instance an older version left', async () => {
  // 0.4.2 までの Client は 'clawd' の名前で { kind, seq } だけを受け取り、状態の形も違った。
  expect(CLIENT).not.toBe('clawd')
})

test('with narrate turned off in the settings, Haiku is never asked', { options: { narrate: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 9_000_000 })
  const asked: string[] = []
  on('model.complete', ($, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: 'GOAL: x\nNOW: y', usage: {} } } as never
  })
  on('tool.call', () => ({ deny: 'test' }))

  await $.tool.call({ tool: 'Read', file_path: '/repo/config.ts' })
  await clock.settle()
  expect(asked).toHaveLength(0)
})
