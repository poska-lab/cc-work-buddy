/** 文字の表示幅。かな・漢字・全角記号は2マス。 */
const cellWidth = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0
  const wide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  return wide ? 2 : 1
}

export const widthOf = (text: string) => [...text].reduce((sum, ch) => sum + cellWidth(ch), 0)

/** 改行や連続した空白を1つの空白にまとめる。 */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** 表示幅 cols に収める。はみ出すときだけ末尾を … にする。 */
export const fit = (text: string, cols: number) => {
  if (cols <= 0) return ''
  if (widthOf(text) <= cols) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = cellWidth(ch)
    if (used + w > cols - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

/** 経過時間を「12秒」「1分5秒」にする。 */
export const seconds = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  return total < 60 ? `${total}秒` : `${Math.floor(total / 60)}分${total % 60}秒`
}

/** 2行目に出す文。ツールを使わずに考えている間は、書き途中の返事の頭か、考えている秒数にする。 */
export const statusLine = (detail: string, thinking: { elapsedMs: number; writing?: string } | undefined) => {
  if (thinking === undefined) return detail
  const writing = oneLine(thinking.writing ?? '')
  return writing !== '' ? `書いてる: ${writing}` : `考え中 ${seconds(thinking.elapsedMs)}`
}
