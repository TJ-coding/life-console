// The edition this device shows (src/editionPref.js), what it enables, and switching. Editions change what is
// SHOWN, never what is stored: switching only writes a device preference; adding a module writes the account's
// settings.addOns[edition][module] = true. Nothing here rewrites planner data.
import { reactive, computed } from 'vue'
import { state } from './store'
import { EDITIONS, EDITION_LIST, DEFAULT_EDITION, enabledModules } from '../editions/index.js'
import { devicePref, saveDevicePref } from './editionPref.js'

const pref = reactive({ id: devicePref.value })
export const editions = EDITION_LIST
/** The edition shown: this device's choice, else the account's home edition, else base. */
export const edition = computed(() => EDITIONS[pref.id] ?? EDITIONS[state.settings?.edition] ?? EDITIONS[DEFAULT_EDITION])
const enabled = computed(() => enabledModules(edition.value.id, state.settings))
/** Is a module shown in this edition? The shell's own entries ('core') always are. */
export const isEnabled = (moduleId) => !moduleId || moduleId === 'core' || enabled.value.has(moduleId)
/** A view switch (edition.features): on unless the edition turns it off. */
export const feature = (name) => edition.value.features?.[name] !== false
/** Is a module one of the edition's own (vs an add-on)? */
export const isDefault = (moduleId) => edition.value.modules.includes(moduleId)

export function setEdition(id) {
  pref.id = EDITIONS[id] ? id : null
  saveDevicePref(pref.id)
}
/** Add a module to this edition for this account (synced), or take it away again. */
export function setAddOn(moduleId, on) {
  const s = state.settings
  if (!s.addOns || typeof s.addOns !== 'object') s.addOns = {}
  if (!s.addOns[edition.value.id]) s.addOns[edition.value.id] = {}
  s.addOns[edition.value.id][moduleId] = !!on
}
