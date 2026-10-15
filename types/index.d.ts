export type MoodKind =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'searching'
  | 'writing'
  | 'running'
  | 'browsing'
  | 'delegating'
  | 'oops'
  | 'crashed'
  | 'denied'
  | 'done'
  | 'stopped'

export type Mood = { kind: MoodKind; line: string }

/** 帯に出している状態。seq は状態が切り替わるたびに1つ進む。 */
export type Shown = Mood & { seq: number }

/** 今のターンの集計。count はこれまでのターン数、tally は作業の呼び名ごとの回数。 */
export type Turn = {
  count: number
  startedAt: number
  endedAt?: number
  tools: number
  tally: Record<string, number>
}

/**
 * いま何をしているかの説明。goal は全体として何をしているか、progress は直近で何をして何がわかったか
 * （どちらも Haiku がまとめる。goal はターンの始めだけ依頼の頭）。writing は書き途中の返事の頭、
 * thinkingSince はツールを使わずに考え始めた時刻、narratedAt は最後に Haiku を呼んだ時刻（どちらもミリ秒）。
 */
export type Now = { goal?: string; progress?: string; writing?: string; thinkingSince?: number; narratedAt?: number }

declare module 'claude-code' {
  interface PluginState {
    'work-buddy': { shown: Shown; turn: Turn; now: Now }
  }
}
