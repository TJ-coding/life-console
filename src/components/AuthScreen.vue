<script setup>
// S-00 · Sign in — shown instead of the app while nobody is signed in (or a reset link is open).
import { computed, onMounted, ref } from 'vue'
import { auth, signIn, signUp, requestReset, resetPassword, signInWithGoogle } from '../auth'

const mode = ref(auth.resetToken ? 'reset' : 'signin') // signin | signup | forgot | reset
const email = ref('')
const password = ref('')
const name = ref('')
const error = ref(auth.error) // e.g. a Google sign-in that came back with an error
const note = ref('')
const busy = ref(false)
const card = ref(null)
const focusFirst = () => card.value?.querySelector('input')?.focus() // name / email / new password: always the first field
onMounted(focusFirst)

const TITLES = { signin: auth.password ? 'Sign in' : 'Sign in to Life Console', signup: 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password' }
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

      <template v-if="mode === 'signin' || mode === 'signup'">
        <button v-if="auth.google" type="button" class="google-btn" @click="signInWithGoogle">
          <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>
        <p v-if="auth.google && !auth.password" class="tiny muted">New here? Continuing with Google creates your account. Life Console never sees or stores a password.</p>
        <div v-if="auth.google && auth.password" class="auth-or tiny muted"><span>or with email</span></div>
      </template>

      <template v-if="auth.password || mode === 'reset'">
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
      </template>
      <p v-else-if="error" class="auth-msg danger" role="alert">{{ error }}</p>
      <p class="auth-legal tiny muted">By continuing you agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
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
.google-btn { height: 40px; display: flex; align-items: center; justify-content: center; gap: 10px; border-radius: 2px; border: 1px solid var(--border); background: #fff; color: #1f1f1f; font: 500 15px/1 Inter, sans-serif; cursor: pointer; }
.google-btn:hover { box-shadow: 0 0 0 2px color-mix(in srgb, var(--info) 45%, transparent); }
.auth-legal { margin: 0; border-top: 1px solid var(--border); padding-top: 10px; }
.auth-legal a { color: var(--info); }
.auth-or { display: flex; align-items: center; gap: 10px; }
.auth-or::before, .auth-or::after { content: ''; flex: 1; border-top: 1px solid var(--border); }
.danger { color: var(--danger); }
</style>
