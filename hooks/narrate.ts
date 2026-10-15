import { oneLine } from './text'

export const NARRATOR = 'claude-haiku-5-5'

/** Haiku を呼ぶ間隔の下限。ツールが続いても、これより短い間隔では呼ばない。 */
export const GAP_MS = 4000

/** Haiku に渡す、いまの作業の様子。 */
export type Scene = {
  /** 利用者がこのターンで頼んだこと。 */
  request: string
  /** Claude が直近に書いた文（ツールの前の一言など）。 */
  note: string
  /** 直近の作業（ルールで作った一言、古い順）。最後のものがいま終わった作業。 */
  actions: readonly string[]
  /** いま終わった作業の結果の頭。 */
  result: string
  /** いま出している2行。 */
  goal?: string
  progress?: string
}

/** Haiku がまとめた2行。goal は全体として何をしているか、progress は直近で何をして何がわかったか。 */
export type Narration = { goal: string; progress: string }

export const SYSTEM = `You narrate, for the user watching the screen, what Claude (the coding agent in Claude Code) is doing. Write two lines in the user's language.

GOAL: the overall aim of the current work, at most 40 characters for Japanese (70 for English). Keep the previous goal word for word unless the aim has really changed.
NOW: what Claude just did and what it found or concluded from the latest result, concrete and specific, at most 40 characters for Japanese (70 for English). For example: config.ts で読み込み順が逆なのを見つけた

No quotes, no emoji, no preamble, no trailing period. Reply in exactly this form:
GOAL: ...
NOW: ...`

const tail = (text: string, max: number) => (text.length > max ? `…${text.slice(-max)}` : text)
const head = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

export const buildPrompt = ({ request, note, actions, result, goal, progress }: Scene) =>
  [
    "The user's request:",
    '<<<',
    tail(request.trim(), 600),
    '>>>',
    '',
    `Claude's latest note: ${oneLine(tail(note, 400)) || '(none)'}`,
    '',
    'Recent actions (oldest first; the last one just finished):',
    ...(actions.length > 0 ? actions.map(action => `- ${action}`) : ['- (none yet)']),
    '',
    'The start of its result:',
    '<<<',
    head(result.trim(), 600) || '(empty)',
    '>>>',
    '',
    `The lines shown now: GOAL: ${goal ?? '(none)'} / NOW: ${progress ?? '(none)'}`,
  ].join('\n')

const QUOTES = [
  ['「', '」'],
  ['『', '』'],
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
] as const

/** 1行を整える。行全体を囲む引用符と末尾の句点を落とし、長すぎれば切る。空なら undefined。 */
export const clean = (text: string, max = 60) => {
  const line = text.trim()
  // 行全体を囲んでいる引用符だけを外す（「?」で始まる行の「 は残す）。
  const wrapped = QUOTES.find(([open, close]) => line.startsWith(open) && line.endsWith(close) && !line.slice(1, -1).includes(open))
  const bare = (wrapped ? line.slice(1, -1) : line).replace(/[。.]+$/, '').trim()
  if (bare === '') return undefined
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare
}

/** Haiku の答えから GOAL と NOW の2行を読む。どちらかが欠けていれば undefined。 */
export const parse = (reply: string): Narration | undefined => {
  const pick = (label: string) => {
    const found = new RegExp(`^\\s*${label}\\s*[:：]\\s*(.+)$`, 'm').exec(reply)
    return found ? clean(found[1]!) : undefined
  }
  const goal = pick('GOAL')
  const progress = pick('NOW')
  return goal !== undefined && progress !== undefined ? { goal, progress } : undefined
}
