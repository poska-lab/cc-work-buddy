import type { Mood, Turn } from '../types'

export const IDLE: Mood = { kind: 'idle', line: '待機中。なにかあれば呼んでね' }

// 帯の幅で描画側が切るので、ここでは長すぎる文だけを切る。
const clip = (text: string, max = 120) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** 言い回しを n で順に選ぶ。同じ作業が続いても一言が単調にならないようにする。 */
const pick = (n: number, lines: readonly string[]) => lines[n % lines.length]!

const host = (url: string) => /^https?:\/\/([^/?#]+)/.exec(url)?.[1] ?? clip(url, 60)

/** mcp__claude_ai_Notion__notion-search → Notion / notion-search */
const mcp = (tool: string) => {
  const [, server = '', name = tool] = tool.split('__')
  return { server: server.replace(/^(claude_ai|plugin)_/, '').replace(/_/g, ' '), name }
}

/** ツール名と引数から、そのツールを使っている間の気分を作る。n はこのターンで何回目のツールか（0 始まり）。 */
export const moodForTool = (tool: string, args: Record<string, unknown>, n = 0): Mood => {
  const file = base(str(args.file_path) || str(args.notebook_path))

  switch (tool) {
    case 'Read': {
      const from = typeof args.offset === 'number' ? args.offset : undefined
      return {
        kind: 'reading',
        line:
          from === undefined
            ? pick(n, [`${file} を読んでる`, `${file} に目を通してる`, `${file} の中身を確認中`])
            : `${file} の ${from} 行目あたりを読んでる`,
      }
    }
    case 'Edit':
      return {
        kind: 'writing',
        line: args.replace_all === true ? `${file} をまとめて置き換え中` : pick(n, [`${file} を書き換え中`, `${file} を直してる`]),
      }
    case 'Write':
      return { kind: 'writing', line: `${file} を書き出し中` }
    case 'NotebookEdit':
      return { kind: 'writing', line: `${file} のセルを編集中` }
    case 'Grep': {
      const where = base(str(args.path)) || str(args.glob)
      return { kind: 'searching', line: `「${clip(str(args.pattern), 60)}」を${where ? ` ${where} から` : ''}探してる` }
    }
    case 'Glob':
      return { kind: 'searching', line: `${clip(str(args.pattern), 60)} に合うファイルを探してる` }
    case 'Bash': {
      const what = clip(str(args.description) || str(args.command))
      return { kind: 'running', line: args.run_in_background === true ? `裏で実行中: ${what}` : `実行中: ${what}` }
    }
    case 'WebSearch':
      return { kind: 'browsing', line: `「${clip(str(args.query), 60)}」をウェブ検索中` }
    case 'WebFetch':
      return { kind: 'browsing', line: `${host(str(args.url))} を読みに行ってる` }
    case 'Agent':
    case 'Task': {
      const who = str(args.subagent_type)
      return { kind: 'delegating', line: `${who ? `${who} に` : '仲間に'}頼んでる: ${clip(str(args.description), 60)}` }
    }
    case 'Skill':
      return { kind: 'thinking', line: `スキル ${str(args.skill)} を使ってる` }
    case 'TodoWrite': {
      const count = Array.isArray(args.todos) ? args.todos.length : 0
      return { kind: 'thinking', line: count > 0 ? `段取りを整理中（${count} 件）` : '段取りを整理中' }
    }
    case 'TaskCreate':
    case 'TaskUpdate':
      return { kind: 'thinking', line: '段取りを整理中' }
    case 'AskUserQuestion':
      return { kind: 'thinking', line: 'あなたの答えを待ってる' }
    case 'ToolSearch':
      return { kind: 'searching', line: '使える道具を探してる' }
    default: {
      if (!tool.startsWith('mcp__')) return { kind: 'thinking', line: `${tool} を使ってる` }
      const { server, name } = mcp(tool)
      return { kind: 'browsing', line: `${clip(server, 60)} で ${clip(name, 60)} を実行中` }
    }
  }
}

/** ツールの結果で気分を更新する。失敗と拒否のときだけ変える。 */
export const moodAfterTool = (
  current: Mood,
  outcome: { tool: string; denied: boolean; isError: boolean },
): Mood => {
  if (outcome.denied) return { kind: 'denied', line: `${outcome.tool} は止められた。別の手を考える` }
  if (outcome.isError) return { kind: 'oops', line: `${outcome.tool} がうまくいかなかった…立て直します` }
  return current
}

export const moodForTurnEnd = (reason: string): Mood => {
  switch (reason) {
    case 'answer':
      return { kind: 'done', line: 'できた！確認してみて' }
    case 'aborted':
      return { kind: 'stopped', line: '中断しました。次の指示を待ってます' }
    case 'refusal':
      return { kind: 'stopped', line: 'それは引き受けられなかった' }
    default:
      return { kind: 'crashed', line: 'エラーで止まっちゃった…' }
  }
}

/** ターンの始まり。頼まれたことの頭を出して、何に取りかかったかがわかるようにする。 */
export const thinking = (request: string): Mood => {
  const head = clip(request, 40)
  return { kind: 'thinking', line: head === '' ? '取りかかってる' : `「${head}」に取りかかってる` }
}

export const NO_TURN: Turn = { count: 0, startedAt: 0, tools: 0, tally: {} }

/** 集計で使うツールの呼び名。MCP のツールはまとめて MCP と数える。 */
const toolName = (tool: string) => (tool.startsWith('mcp__') ? 'MCP' : tool)

/** ターンにツールを1回足す。ツールの名前ごとに数える。 */
export const tallyTool = (turn: Turn, tool: string): Turn => {
  const name = toolName(tool)
  return { ...turn, tools: turn.tools + 1, tally: { ...turn.tally, [name]: (turn.tally[name] ?? 0) + 1 } }
}

const duration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

/** 一言の下に出す集計。作業中はツールの回数と内訳、終わったらかかった時間も添える。 */
export const summary = (turn: Turn) => {
  if (turn.tools === 0 && turn.endedAt === undefined) return ''
  // 多く使ったツールから並べる（同じ回数なら先に使ったもの）。
  const parts = Object.entries(turn.tally)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${count}`)
  const tools = `ツール ${turn.tools} 回${parts.length > 0 ? `（${parts.join(' · ')}）` : ''}`
  return turn.endedAt === undefined ? tools : `${duration(turn.endedAt - turn.startedAt)} · ${tools}`
}
