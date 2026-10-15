import type { ClientModule } from 'claude-code'

import type { MoodKind } from '../types'
import { draw, frameAt, isRainbow, keepSpaces, RAINBOW_MS, restarts, TICK_MS } from './clawd'
import type { Cell, Frame } from './clawd'
import { fit, statusLine, widthOf } from './text'

type Props = {
  kind: MoodKind
  seq: number
  /** 帯の横幅（文字数）。 */
  width: number
  /** 1行目: 全体として何をしているか。 */
  goal: string
  /** 2行目: 直近で何をして何がわかったか。 */
  progress: string
  /** 3行目: 今の具体的な作業（考え中の間は、秒数か書き途中の文に置き換える）。 */
  detail: string
  /** 3行目の末尾に薄く添える集計。 */
  stats: string
  /** ツールを使わずに考えている間だけある。since はその開始時刻、elapsedMs は送った時点までの経過。 */
  thinking?: { since: number; elapsedMs: number; writing?: string }
}

// 描画側の時計。t は刻みの合計、start は今の状態に入った時刻。
// 考え中の秒数は、props が届いた時点の経過（base）に、そこからの刻み（t - baseAt）を足して数える。
type Clock = {
  t: number
  start: number
  seq: number
  kind: MoodKind
  frame: Frame
  since?: number
  base: number
  baseAt: number
  second: number
  /** いま出している2行目と、それが変わった時刻。変わってしばらくは太く描く。 */
  progress: string
  progressAt: number
  lit: boolean
}

const elapsed = (clock: Clock) => clock.base + clock.t - clock.baseAt

/** 2行目が変わってから太く描いておく長さ。 */
const LIT_MS = 2000

const isLit = (clock: Clock) => clock.progress !== '' && clock.t - clock.progressAt < LIT_MS

/**
 * Claude くんと、いま何をしているかの3行を、描画側の時計で描く。コマが変わったとき（虹色の間は色を進めるたび、
 * 考え中は秒が変わるたび）だけ描き直し、プラグインとは往復しない。
 */
const Buddy: ClientModule<Props, Clock> = (props, surface) => {
  let clock = surface.state
  if (clock === undefined) {
    const fresh: Clock = {
      t: 0,
      start: 0,
      seq: props.seq,
      kind: props.kind,
      frame: frameAt(props.kind, 0),
      base: 0,
      baseAt: 0,
      second: -1,
      progress: props.progress ?? '',
      progressAt: -LIT_MS,
      lit: false,
    }
    surface.setState(fresh)
    surface.every(TICK_MS, () => {
      fresh.t += TICK_MS
      const next = frameAt(fresh.kind, fresh.t - fresh.start)
      const flowing = isRainbow(fresh.kind, next) && fresh.t % RAINBOW_MS === 0
      const second = fresh.since === undefined ? -1 : Math.floor(elapsed(fresh) / 1000)
      const lit = isLit(fresh)
      if (next !== fresh.frame || flowing || second !== fresh.second || lit !== fresh.lit) {
        fresh.frame = next
        fresh.second = second
        fresh.lit = lit
        surface.setState(fresh)
      }
    })
    clock = fresh
  }

  // 状態が切り替わったら、その状態のはじめ（リアクション）から動かし直す。
  // 同じ作業の状態が続くだけなら流れを切らない（ツールが続くたびに1コマ目へ戻って止まって見えるのを防ぐ）。
  if (props.seq !== clock.seq) {
    if (restarts(clock.kind, props.kind)) {
      clock.kind = props.kind
      clock.start = clock.t
      clock.frame = frameAt(props.kind, 0)
    }
    clock.seq = props.seq
  }
  // 考え始めた時刻が変わったら、届いた経過から数え直す。
  if (props.thinking?.since !== clock.since) {
    clock.since = props.thinking?.since
    clock.base = props.thinking?.elapsedMs ?? 0
    clock.baseAt = clock.t
  }
  // 2行目（わかったこと）が変わったら、しばらく太く描いて気づけるようにする。
  if ((props.progress ?? '') !== clock.progress) {
    clock.progress = props.progress ?? ''
    clock.progressAt = clock.t
    clock.lit = isLit(clock)
  }

  // 版が切り替わる途中で古い形の props が届いても落ちないよう、文字の項目がなければ空にする。
  const goal = props.goal ?? ''
  const stats = props.stats ?? ''

  const { Box, Text } = surface.elements
  const art = draw(clock.kind, clock.frame, clock.seq, clock.t)
  const room = Math.max(10, (surface.columns || props.width) - (art[0]?.length ?? 0) - 2)
  const detail = statusLine(props.detail ?? '', props.thinking && { elapsedMs: elapsed(clock), writing: props.thinking.writing })
  const tail = stats === '' ? '' : `${detail === '' ? '' : '  '}${stats}`
  const shown = fit(detail, Math.max(0, room - widthOf(tail)))

  /** 絵の1行に、文字を足して1行にする。 */
  const line = (cells: Cell[], extra: unknown[]) => (
    <Text mono>
      {cells.map(({ ch, fg, bg }) =>
        fg === undefined ? (
          keepSpaces(ch)
        ) : (
          <Text color={fg} backgroundColor={bg}>
            {ch}
          </Text>
        ),
      )}
      {extra}
    </Text>
  )

  // 絵の3行それぞれの右に文字を並べて、帯を絵と同じ3行に収める。上に1行あけて、上の出力と詰まらないようにする。
  // 1行目（全体の目的）は太く、2行目（わかったこと）は Claude の色、3行目（今の作業）は薄く、集計はさらに薄く。
  return (
    <Box flexDirection="column" paddingTop={1}>
      {line(art[0]!, [keepSpaces('  '), <Text bold>{keepSpaces(fit(goal, room))}</Text>])}
      {line(art[1]!, [keepSpaces('  '), <Text color="claude" bold={isLit(clock)}>{keepSpaces(fit(clock.progress, room))}</Text>])}
      {line(art[2]!, [keepSpaces('  '), <Text dimColor>{keepSpaces(shown)}</Text>, <Text color="inactive">{keepSpaces(tail)}</Text>])}
    </Box>
  )
}

export default Buddy
