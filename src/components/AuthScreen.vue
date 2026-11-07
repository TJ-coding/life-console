<script setup>
// S-00 · Sign in — shown instead of the app while nobody is signed in (or a reset link is open).
import { computed, onMounted, ref } from 'vue'
import { auth, signIn, signUp, requestReset, resetPassword } from '../auth'

const mode = ref(auth.resetToken ? 'reset' : 'signin') // signin | signup | forgot | reset
const email = ref('')
const password = ref('')
const name = ref('')
const error = ref('')
const note = ref('')
const busy = ref(false)
const card = ref(null)
const focusFirst = () => card.value?.querySelector('input')?.focus() // name / email / new password: always the first field
onMounted(focusFirst)

const TITLES = { signin: 'Sign in', signup: 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password' }
const ACTION = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Save password' }
const needsPassword = computed(() => mode.value !== 'forgot')
const needsEmail = computed(() => mode.value !== 'reset')

function go(m) { mode.value = m; error.value = ''; note.value = ''; setTimeout(focusFirst) }

async function submit() {
  error.value = ''
  note.value = ''
  busy.value = true
  try {
    if (mode.value === 'signin') await signIn(email.value, password.value)
    else if (mode.value === 'signup') await signUp(email.value, password.value, name.value)
    else if (mode.value === 'reset') await resetPassword(password.value)
    else { await requestReset(email.value); note.value = 'If that email has an account, a reset link is on its way. It works for an hour.' }
  } catch (e) {
    error.value = e.status === 429 ? 'Too many attempts — wait a few minutes and try again.' : e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <form ref="card" class="auth-card panel" @submit.prevent="submit">
      <div class="auth-brand">
        <span class="auth-logo"><span class="icon">radar</span></span>
        <div><div class="auth-name">LIFE CONSOLE</div><div class="mono tiny muted">your planning console</div></div>
      </div>
      <h1>{{ TITLES[mode] }}</h1>

      <label v-if="mode === 'signup'" class="field"><span>Name (optional)</span>
        <input v-model="name" class="input big-in" autocomplete="name" maxlength="80" /></label>
      <label v-if="needsEmail" class="field"><span>Email</span>
        <input v-model="email" class="input big-in" type="email" autocomplete="email" required /></label>
      <label v-if="needsPassword" class="field"><span>{{ mode === 'signin' ? 'Password' : 'New password (8+ characters)' }}</span>
        <input v-model="password" class="input big-in" type="password" :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'" :minlength="mode === 'signin' ? undefined : 8" required /></label>

      <p v-if="error" class="auth-msg danger" role="alert">{{ error }}</p>
      <p v-if="note" class="auth-msg ok" role="status">{{ note }}</p>

      <button class="btn primary auth-go" type="submit" :disabled="busy">{{ busy ? '…' : ACTION[mode] }}</button>

      <div class="auth-links small">
        <template v-if="mode === 'signin'">
          <button v-if="auth.signups === 'open'" type="button" class="linkish" @click="go('signup')">Create an account</button>
          <span v-else class="muted">Sign-ups are closed on this server</span>
          <button v-if="auth.passwordReset" type="button" class="linkish" @click="go('forgot')">Forgot password?</button>
        </template>
        <button v-else type="button" class="linkish" @click="go('signin')">← Back to sign in</button>
      </div>
      <p v-if="mode === 'signin' && !auth.passwordReset" class="tiny muted">Forgot your password? Ask whoever runs this server to reset it.</p>
    </form>
  </div>
</template>

<style scoped>
.auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--bg); }
.auth-card { width: 100%; max-width: 400px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
.auth-brand { display: flex; align-items: center; gap: 10px; }
.auth-logo { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--accent); color: var(--accent); border-radius: 2px; }
.auth-name { font: 700 13px/16px 'JetBrains Mono', monospace; letter-spacing: 0.08em; }
h1 { margin: 4px 0 0; font: 600 22px/28px Inter, sans-serif; }
.big-in { height: 40px; font-size: 15px; padding: 0 10px; }
.auth-go { height: 40px; font-size: 15px; justify-content: center; }
.auth-go:disabled { opacity: 0.6; }
.auth-msg { margin: 0; font-size: 13px; }
.auth-links { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.linkish { background: none; border: 0; padding: 0; color: var(--info); cursor: pointer; font: inherit; }
.linkish:hover { text-decoration: underline; }
.ok { color: var(--accent); }
.danger { color: var(--danger); }
</style>
