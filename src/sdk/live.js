// The live workshop (server/mcp.mjs): an AI app such as Claude changes the draft open in your workshop, and the
// workshop's preview reports back. Both sides name a draft by this key, so a preview result finds its draft
// without a round trip. Pure JS, used by the browser and the server.

/** A short key for a draft's code: its length and a 32-bit hash (djb2). */
export function draftKey(code) {
  const s = String(code ?? '')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return `${s.length}:${h.toString(36)}`
}
