import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mood, Now, Shown } from '../types'
import { IDLE, moodAfterTool, moodForTool, moodForTurnEnd, NO_TURN, summary, tallyTool, thinking } from './mood'
import { buildPrompt, GAP_MS, NARRATOR, parse, SYSTEM } from './narrate'

// 0.2.0 までの 'mood' は seq を持たないため、別の key で持つ（$.state は reload 後も残る）。
const mood = atom({ plugin: 'work-buddy', key: 'shown' } as const, { ...IDLE, seq: 0 } as Shown)
const turn = atom({ plugin: 'work-buddy', key: 'turn' } as const, NO_TURN)
const now = atom({ plugin: 'work-buddy', key: 'now' } as const, {} as Now)

/** 状態を切り替える。seq を進めて、描画側に動きのやり直しを伝える。 */
const enter =
  (next: Mood) =>
  (prev: Shown): Shown => ({ ...next, seq: prev.seq + 1 })

/**
 * 描画側の Client の名前。Client の状態や props の形を変えたら名前も変える。
 * 同じ名前だと /reload-plugins のあとも古い版の状態と時計が残り、新しい版と食い違って落ちる（0.5.0 で起きた）。
 */
export const CLIENT = 'clawd-v5'

/** Client の props は undefined を持てないので、値のない項目を落とす。 */
const defined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T

// Haiku に渡す、このターンの様子。
let request = ''
let note = ''
const actions: string[] = []
// 今のターン。ターンが終わったあとに届いた Haiku の答えは捨てる。
let currentTurn: string | undefined
let inflight = false
let lastWritingAt = 0
// 設定の narrate。オフなら Haiku を呼ばず、ルールの一言だけを出す。
let narrating = true

/**
 * Haiku に「全体として何をしているか」と「直近で何をして何がわかったか」の2行をまとめてもらう。
 * 呼び出し中か、前の呼び出しから GAP_MS 経っていなければ呼ばない。
 */
async function narrate($: EngineInterface, turnId: string | undefined, result: string) {
  if (inflight) return
  inflight = true
  try {
    const at = await $.clock.now()
    const { goal, progress, narratedAt } = await read($, now)
    if (narratedAt !== undefined && at - narratedAt < GAP_MS) return
    await update($, now, prev => ({ ...prev, narratedAt: at }))
    const reply = await $.model.complete({
      model: NARRATOR,
      system: SYSTEM,
      prompt: buildPrompt({ request, note, actions, result, goal, progress }),
      maxTokens: 500,
      effort: 'low',
      timeoutMs: 15_000,
    })
    const lines = reply.isAnswered ? parse(reply.text) : undefined
    if (lines !== undefined && turnId === currentTurn) await update($, now, prev => ({ ...prev, ...lines }))
  } catch {
    // 一言が作れなくても、ルールの一言のまま続ける。
  } finally {
    inflight = false
  }
}

/** ツールの結果を、Haiku に渡す文にする。止められたときはその理由。 */
const resultText = (ran: { deny?: string; text?: string; result?: unknown }) => {
  if (ran.deny !== undefined) return `denied: ${ran.deny}`
  if (typeof ran.text === 'string' && ran.text !== '') return ran.text.slice(0, 2000)
  try {
    return JSON.stringify(ran.result ?? '').slice(0, 2000)
  } catch {
    return ''
  }
}

/** ツールを使わずに考え始めた（モデルの返事を待っている）ことを記録する。 */
async function startThinking($: EngineInterface) {
  const at = await $.clock.now()
  await update($, now, prev => ({ ...prev, thinkingSince: prev.thinkingSince ?? at, writing: undefined }))
}

/** 書き途中の返事の頭を記録する。 */
async function showWriting($: EngineInterface, text: string) {
  await update($, now, prev => ({ ...prev, writing: text.slice(0, 200) }))
}

export const register: Register = (on, options) => {
  narrating = options.narrate !== false

  // サブエージェント内のイベントは無視し、メインの作業だけを映す。
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      currentTurn = e.turnId
      request = e.text
      note = ''
      actions.length = 0
      const startedAt = await $.clock.now()
      await update($, turn, prev => ({ ...NO_TURN, count: prev.count + 1, startedAt }))
      // Haiku がまとめるまでは、全体の行に依頼の頭を出す。
      const start = thinking(e.text)
      await update($, now, () => ({ goal: start.line, thinkingSince: startedAt }))
      await update($, mood, enter(start))
    }
    return next(e)
  })

  // モデルの返事が流れる場所なので、受け取ったものは手を加えずにすぐ流す。
  // 書き途中の文は 0.5 秒おきに、待たずに記録する。
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    startThinking($).catch(() => undefined)
    const stream = next(e)
    let text = ''
    for await (const chunk of stream) {
      if (chunk.kind === 'text') {
        text += chunk.text
        if (Date.now() - lastWritingAt > 500) {
          lastWritingAt = Date.now()
          showWriting($, text).catch(() => undefined)
        }
      }
      yield chunk
    }
    const result = await stream.result
    if (result.answer.trim() !== '') note = result.answer
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const { tool, ...args } = e as { tool: string } & Record<string, unknown>
    const during: Mood = moodForTool(tool, args, (await read($, turn)).tools)
    actions.push(during.line)
    actions.splice(0, Math.max(0, actions.length - 6))
    await update($, turn, prev => tallyTool(prev, tool))
    await update($, now, prev => ({ ...prev, thinkingSince: undefined, writing: undefined }))
    await update($, mood, enter(during))

    const ran = await next(e)
    // 結果が出てから、何がわかったかを Haiku にまとめてもらう（待たない）。
    if (narrating) void narrate($, currentTurn, resultText(ran))
    const after = moodAfterTool(during, {
      tool,
      denied: ran.deny !== undefined,
      isError: ran.isError === true,
    })
    if (after !== during) await update($, mood, enter(after))

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      currentTurn = undefined
      const endedAt = await $.clock.now()
      await update($, turn, prev => ({ ...prev, endedAt }))
      // 終わったあとも、最後にわかったことは2行目に残す（次のターンの始めで消える）。
      await update($, now, prev => ({ progress: prev.progress }))
      await update($, mood, enter(moodForTurnEnd(e.reason)))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Client（描画側で動く絵）を描けるのは terminal と desktop。
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)

    const current = await read($, mood)
    const { goal, progress, writing, thinkingSince } = await read($, now)
    const stats = summary(await read($, turn))
    const elapsedMs = thinkingSince === undefined ? undefined : (await $.clock.now()) - thinkingSince
    const { Client } = $.ui.resolve(e)

    // 1行目は全体として何をしているか、2行目は直近で何をして何がわかったか、3行目は今の具体的な作業。
    // ターンの外（待機中・終わったあと）は、1行目に状態の一言だけを出す。
    return (
      <Client
        key={CLIENT}
        module="./buddy.tsx"
        props={defined({
          kind: current.kind,
          seq: current.seq,
          width: e.props.bodyColumns,
          goal: goal ?? current.line,
          progress: progress ?? '',
          detail: goal === undefined ? '' : current.line,
          stats,
          thinking:
            thinkingSince === undefined || elapsedMs === undefined
              ? undefined
              : defined({ since: thinkingSince, elapsedMs, writing }),
        })}
      />
    )
  })
}
