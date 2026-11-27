// src/keys.js: is the person typing? Keys from inside an extension part arrive retargeted to the part's box.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { typingIn, textFieldIn, fromPart, keyOrigin } from '../src/keys.js'

// a tiny element: tag, type, and the selectors closest() matches
const el = (tagName, { type = '', matches = [], editable = false } = {}) => ({ tagName, type, isContentEditable: editable, closest: (sel) => (sel.split(',').some((s) => matches.includes(s.trim().split(/[[:]/)[0])) ? {} : null) })
const ev = (target, path = [target]) => ({ target, composedPath: () => path })

test('typing in an input inside an extension part counts as typing (the event is retargeted to the part box)', () => {
  const host = el('DIV')
  const input = el('INPUT', { type: 'text', matches: ['input'] })
  const e = ev(host, [input, host])
  assert.equal(keyOrigin(e), input)
  assert.equal(fromPart(e), true)
  assert.equal(typingIn(e), true, 'no shortcut while typing in an extension')
  assert.equal(textFieldIn(e), true, "the browser's own undo applies")
})

test('outside parts it behaves as before', () => {
  const input = el('INPUT', { type: 'text', matches: ['input'] })
  assert.equal(typingIn(ev(input)), true)
  assert.equal(fromPart(ev(input)), false)
  const box = el('INPUT', { type: 'checkbox', matches: ['input'] })
  assert.equal(textFieldIn(ev(box)), false, 'a checkbox is not a text field')
  const div = el('DIV')
  assert.equal(typingIn(ev(div)), false)
  assert.equal(typingIn(ev(el('DIV', { editable: true }))), true, 'editable text')
  assert.equal(typingIn({ target: input }), true, 'no composedPath: falls back to target')
})

test('a button inside a part is not typing, but the key still comes from the part', () => {
  const host = el('DIV')
  const btn = el('BUTTON')
  const e = ev(host, [btn, host])
  assert.equal(typingIn(e), false)
  assert.equal(fromPart(e), true)
})
