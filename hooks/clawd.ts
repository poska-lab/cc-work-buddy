import type { MoodKind } from '../types'

// Claude くん（Claude Code の起動画面のキャラ）。もとのブロック文字
//    ▐▛███▜▌ / ▝▜█████▛▘ /   ▘▘ ▝▝
// を1文字2×2画素として読み直した 18×5 画素の絵。もとと同じく、2×2画素を四分割ブロック1文字で描く（横 9 文字）。
// B 体  . 透明。目・口・腕・脚は別に重ねる。目と口は頭と胴の内側だけに置き、輪郭を切らない。
const BODY = ['...BBBBBBBBBBBB...', '...BBBBBBBBBBBB...', '...BBBBBBBBBBBB...', '...BBBBBBBBBBBB...']

type Ink = 'body' | 'eye' | 'tear'
type Px = readonly [x: number, y: number, ink: Ink]

/** Claude くんの色（Claude Code のテーマの claude 色）と、目・涙の色。 */
const INKS: Record<Ink, string> = {
  body: '#D77757',
  eye: '#1F1F1F',
  tear: '#FFFFFF',
}

// 目は頭の下の段の1画素。look で左右に1画素ずらす。
const dots = (look: number): Px[] => [
  [5 + look, 1, 'eye'],
  [12 + look, 1, 'eye'],
]

// 閉じた目・細めた目は2画素の線。
const lines = (look: number): Px[] => [
  [4 + look, 1, 'eye'],
  [5 + look, 1, 'eye'],
  [12 + look, 1, 'eye'],
  [13 + look, 1, 'eye'],
]

// 口は胴の上の段の真ん中に2画素。胴の下の段は輪郭なので、口も目も置かない。
const MOUTH: Px[] = [
  [8, 2, 'eye'],
  [9, 2, 'eye'],
]

/** 表情: ふつう・まばたき・喜び・驚き・疲れ・むっ・しょんぼり・泣き。目の形・口・涙で描き分け、腕・動き・記号で補う。 */
type Face = 'normal' | 'closed' | 'joy' | 'surprised' | 'tired' | 'annoyed' | 'sad' | 'cry'

const FACES: Record<Face, (look: number) => Px[]> = {
  normal: dots,
  closed: lines,
  // 喜び: 目を細めて、口を開ける（バンザイと虹色で跳ねるのと合わせる）。
  joy: () => [...lines(0), ...MOUTH],
  // 驚き: 目を開いたまま、口を開ける（びくっと震えるのと合わせる）。
  surprised: () => [...dots(0), ...MOUTH],
  // 疲れ: 目を細める。
  tired: () => lines(0),
  // むっ: 目を開いたまま口を結ぶ（左右をにらむのと記号 # で補う）。
  annoyed: dots,
  // しょんぼり: 目を伏せる。
  sad: lines,
  // 泣き: 目の斜め外側の下に涙（目と同じ文字に入ると3色になって描けないため、1画素外にずらす）。
  cry: look => [...dots(look), [4 + look, 2, 'tear'], [13 + look, 2, 'tear']],
}

// 腕は胴の横に2画素。上げると頭の横に斜めに立つ。右腕は左腕を左右反転したもの。
const LEFT_ARM = {
  down: [
    [1, 2],
    [2, 2],
  ],
  up: [
    [2, 1],
    [1, 0],
  ],
} as const

const ARMS = {
  down: ['down', 'down'],
  up: ['up', 'up'],
  leftUp: ['up', 'down'],
  rightUp: ['down', 'up'],
} as const

// 脚は4本。step で内側に寄せ、stand と交互にすると足踏みに見える。
const LEGS = {
  stand: [4, 6, 11, 13],
  step: [5, 7, 10, 12],
} as const

type Pose = {
  face?: Face
  /** 目線。-1 で左、1 で右。 */
  look?: number
  arms?: keyof typeof ARMS
  legs?: keyof typeof LEGS
  /** 横の位置（0〜2）。コマ間で変えると体が揺れる。 */
  dx?: number
  /** 縦の位置。0 で浮き上がる（跳ねる・揺れる）。 */
  dy?: number
  /** 頭の右に添える記号。 */
  mark?: string
  /** 落ち着いた状態でも、このコマは虹色で塗る（リアクション用）。 */
  party?: boolean
}

/** 1コマ。ms はそのコマを見せる長さ。 */
export type Frame = Pose & { ms: number }

/** intro は状態に入ったときに一度だけ流し、そのあと loop をくり返す。 */
type Motion = { intro: readonly Frame[]; loop: readonly Frame[] }

/** 描画側の時計の刻み。コマの長さはこの倍数にする。 */
export const TICK_MS = 50

const at = (ms: number, poses: readonly Pose[]): Frame[] => poses.map(pose => ({ ...pose, ms }))

const repeat = <T>(times: number, items: readonly T[]): T[] => Array.from({ length: times }, () => items).flat()

// 落ち着いている間は、ゆっくりふわふわ浮きながら、ときどきまばたきして左右を見る（1周 8.1 秒）。
const awake = (mark?: string): Frame[] => [
  { mark, ms: 1200 },
  { mark, dy: 0, ms: 1200 },
  { face: 'closed', mark, ms: 150 },
  { mark, ms: 900 },
  { mark, dy: 0, ms: 900 },
  { look: -1, mark, ms: 600 },
  { mark, ms: 900 },
  { look: 1, mark, ms: 600 },
  { mark, dy: 0, ms: 1500 },
  { face: 'closed', mark, ms: 150 },
]

// 起きている7周（約57秒）が過ぎると、疲れた顔をしてから目を閉じて居眠りする。
const resting = (reaction: readonly Frame[], mark?: string): Motion => ({
  intro: [...reaction, ...repeat(7, awake(mark)), { face: 'tired', mark: '..', ms: 3000 }],
  loop: at(900, [
    { face: 'closed', mark: 'z' },
    { face: 'closed', mark: 'zz' },
    { face: 'closed', mark: 'zzz' },
  ]),
})

/** 作業中は状態ごとのテンポでくり返し、落ち着いた状態はリアクションのあと待機の動きに移る。 */
const MOTIONS: Record<MoodKind, Motion> = {
  thinking: {
    intro: [],
    loop: at(500, [
      { look: -1, mark: '?' },
      { mark: '??' },
      { look: 1, mark: '???' },
      { mark: '??' },
    ]),
  },
  reading: {
    intro: [],
    loop: [
      ...at(600, [
        { look: -1, mark: '[]' },
        { mark: '[]' },
        { look: 1, mark: '[]' },
      ]),
      { face: 'closed', mark: '[]', ms: 150 },
    ],
  },
  // 左右を見ながら、足踏みして揺れる。
  searching: {
    intro: [],
    loop: at(300, [
      { look: -1, dx: 0 },
      { look: -1, dx: 1, legs: 'step' },
      { look: 1, dx: 2 },
      { look: 1, dx: 1, legs: 'step' },
    ]),
  },
  writing: {
    intro: [],
    loop: at(200, [
      { look: 1, arms: 'rightUp', mark: '_/' },
      { look: 1, mark: '_/' },
      { look: 1, arms: 'rightUp', mark: '_/' },
      { mark: '_/' },
    ]),
  },
  // 足を踏み替えながら跳ね、! を増やしたり減らしたりする。
  running: {
    intro: [],
    loop: at(200, [
      { dy: 0, legs: 'step', mark: '!' },
      { mark: '!!' },
      { dy: 0, legs: 'step', arms: 'up', mark: '!!!' },
      { mark: '!!' },
    ]),
  },
  // 浮きながら左右に揺れる。
  browsing: {
    intro: [],
    loop: at(400, [
      { dx: 0, mark: '~' },
      { dx: 1, dy: 0, mark: '~~' },
      { dx: 2, mark: '~~~' },
      { dx: 1, dy: 0, mark: '~~' },
    ]),
  },
  // 手を振って呼ぶ。
  delegating: {
    intro: [],
    loop: at(300, [
      { arms: 'rightUp', mark: '>' },
      { mark: '>>' },
      { arms: 'leftUp', mark: '>>>' },
      { mark: '>>' },
    ]),
  },
  idle: resting([]),
  // 喜びの顔で、虹色になって足踏みしながら3回跳ねてから、バンザイで少し止まる。
  done: resting(
    [
      ...repeat(
        3,
        at(200, [
          { face: 'joy', arms: 'up', dy: 0, legs: 'step', mark: '*', party: true },
          { face: 'joy', mark: '+', party: true },
        ]),
      ),
      { face: 'joy', arms: 'up', mark: '*', ms: 1200, party: true },
    ],
    '*',
  ),
  // ツールが失敗した: 驚いてびくっと震える。
  oops: resting(
    [
      ...repeat(
        4,
        at(100, [
          { face: 'surprised', dx: 0, mark: '!?' },
          { face: 'surprised', dx: 2, mark: '?!' },
        ]),
      ),
      { face: 'surprised', mark: '!?', ms: 1500 },
    ],
    ';',
  ),
  // ターンがエラーで止まった: 泣き顔で上下に震える（横にずらすと涙と目が同じ文字に入るため）。
  crashed: resting(
    [
      ...repeat(
        4,
        at(100, [
          { face: 'cry', dy: 0, mark: ';' },
          { face: 'cry', mark: ';' },
        ]),
      ),
      { face: 'cry', mark: ';', ms: 2000 },
    ],
    ';',
  ),
  // ツールを止められた: むっとして左右を見る。
  denied: resting(
    [
      { face: 'annoyed', look: -1, mark: '#', ms: 500 },
      { face: 'annoyed', look: 1, mark: '#', ms: 500 },
      { face: 'annoyed', mark: '#', ms: 1500 },
    ],
    '..',
  ),
  // 中断・お断り: 左右を見てから、しょんぼりして目を伏せる。
  stopped: resting(
    [
      { look: -1, mark: '..', ms: 600 },
      { look: 1, mark: '..', ms: 600 },
      { face: 'sad', mark: '...', ms: 2300 },
    ],
    '..',
  ),
}

const total = (frames: readonly Frame[]) => frames.reduce((sum, frame) => sum + frame.ms, 0)

const pick = (frames: readonly Frame[], t: number) => {
  for (const frame of frames) {
    if (t < frame.ms) return frame
    t -= frame.ms
  }
  return frames[frames.length - 1]!
}

/** 状態に入ってから elapsed ミリ秒後に見せるコマ。 */
export const frameAt = (kind: MoodKind, elapsed: number): Frame => {
  const { intro, loop } = MOTIONS[kind]
  const introMs = total(intro)
  return elapsed < introMs ? pick(intro, elapsed) : pick(loop, (elapsed - introMs) % total(loop))
}

/** 作業中の状態は、体を虹色で塗る。 */
const WORKING = new Set<MoodKind>(['thinking', 'reading', 'searching', 'writing', 'running', 'browsing', 'delegating'])

export const isRainbow = (kind: MoodKind, frame: Frame) => frame.party === true || WORKING.has(kind)

/**
 * 状態が切り替わったとき、動きを頭から流し直すか。同じ作業の状態が続くとき（Read が続くなど）は
 * 流れを切らずに続ける。リアクションのある状態（done・oops など）は、入るたびに流し直す。
 */
export const restarts = (from: MoodKind, to: MoodKind) => from !== to || MOTIONS[to].intro.length > 0

/** 虹色の流れ方（横・縦・全体いっせい・斜め）。状態が切り替わるたびに seq で選び直す。 */
const FLOWS: readonly ((x: number, y: number) => number)[] = [
  x => x * 28,
  (x, y) => y * 60,
  () => 0,
  (x, y) => (x + y * 2) * 20,
]

/** 虹色を進める間隔。 */
export const RAINBOW_MS = 100

const hsl = (hue: number, l: number) => {
  const h = ((hue % 360) + 360) % 360
  const a = 0.9 * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return `#${[f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}

/**
 * seq 番目の状態で、(x, y) 番目の文字を t ミリ秒の時点で塗る虹色。
 * 流れ方・始まりの色・回る向きを seq で変え、2秒で色相を一周する。
 */
export const rainbow = (seq: number, x: number, y: number, t: number) => {
  const flow = FLOWS[seq % FLOWS.length]!
  const direction = Math.floor(seq / FLOWS.length) % 2 === 0 ? 1 : -1
  return hsl(seq * 137 + flow(x, y) + direction * t * 0.18, 0.62)
}

// 横は体の揺れ（dx 0〜2）、縦は浮き上がり（dy 0〜1）の分だけ広く取る。
const SPRITE_W = 20
const SPRITE_H = 6
const MARK_W = 4

/** 描く行数。 */
export const ROWS = SPRITE_H / 2

/** 1文字分。fg は塗った区画の色、bg は残りの区画の色。ch が空白なら何も塗らない。 */
export type Cell = { ch: string; fg?: string; bg?: string }

// 2×2画素の並び（左上=1・右上=2・左下=4・右下=8）で引く四分割ブロック文字。
const QUADS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

/**
 * 2×2画素（左上・右上・左下・右下）を1文字にする。1文字に塗れるのは文字色と背景色の2色までなので、
 * 3色あるときは少ない色を多い色に寄せる（同じ数なら透明より色を残す）。
 */
const quad = (pixels: readonly (string | undefined)[]): Cell => {
  const counts = new Map<string | undefined, number>()
  for (const pixel of pixels) counts.set(pixel, (counts.get(pixel) ?? 0) + 1)
  const [first, second] = [...counts.keys()].sort(
    (a, b) => counts.get(b)! - counts.get(a)! || Number(a === undefined) - Number(b === undefined),
  )
  const fg = first === undefined || second !== undefined ? second : first
  if (fg === undefined) return { ch: ' ' }
  const bg = fg === first ? second : first
  const mask = pixels.reduce((bits, pixel, i) => ((pixel === fg) ? bits | (1 << i) : bits), 0)
  return bg === undefined ? { ch: QUADS[mask]!, fg } : { ch: QUADS[mask]!, fg, bg }
}

/** コマを ROWS 行の文字にする。虹色のときは seq と t で体の色を決める。 */
export const draw = (kind: MoodKind, frame: Frame, seq: number, t: number): Cell[][] => {
  const { face = 'normal', look = 0, arms = 'down', legs = 'stand', dx = 1, dy = 1, mark = '' } = frame
  const ink = new Map<number, Ink>()
  const put = (x: number, y: number, value: Ink) => ink.set((y + dy) * SPRITE_W + x + dx, value)

  BODY.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      if (ch !== '.') put(x, y, 'body')
    }),
  )
  for (const x of LEGS[legs]) put(x, 4, 'body')
  const [left, right] = ARMS[arms]
  for (const [x, y] of LEFT_ARM[left]) put(x, y, 'body')
  for (const [x, y] of LEFT_ARM[right]) put(17 - x, y, 'body')
  for (const [x, y, value] of FACES[face](look)) put(x, y, value)

  const party = isRainbow(kind, frame)
  const color = (x: number, y: number) => {
    const value = ink.get(y * SPRITE_W + x)
    if (value === undefined) return undefined
    // 虹色は文字ごとに1色にして、1文字2色に収める。
    return party && value === 'body' ? rainbow(seq, x >> 1, y >> 1, t) : INKS[value]
  }

  return Array.from({ length: ROWS }, (_, row) => {
    const cells: Cell[] = Array.from({ length: SPRITE_W / 2 }, (_, col) => {
      const [x, y] = [col * 2, row * 2]
      return quad([color(x, y), color(x + 1, y), color(x, y + 1), color(x + 1, y + 1)])
    })
    // 記号は頭の高さ（1行目）に置く。
    const text = (row === 0 ? ` ${mark}` : '').padEnd(MARK_W).slice(0, MARK_W)
    return [...cells, ...[...text].map(ch => ({ ch }))]
  })
}

/**
 * desktop は通常の空白を詰めて描くため、空白を NBSP に置き換え、
 * 等幅（mono）表示と合わせて行頭と列をそろえる。
 */
export const keepSpaces = (line: string) => line.replace(/ /g, ' ')
