<script setup>
// S-00 · Sign in — shown instead of the app while nobody is signed in (or a reset link is open).
import { computed, onMounted, ref } from 'vue'
import { auth, signIn, signUp, requestReset, resetPassword, signInWithGoogle } from '../auth'
import { enterGuest } from '../sync'
import { inAppBrowser, trackSignInScreen, trackSignInEvent } from '../analytics'

const mode = ref(auth.resetToken ? 'reset' : 'signin') // signin | signup | forgot | reset
const email = ref('')
const password = ref('')
const name = ref('')
const error = ref(auth.error) // e.g. a Google sign-in that came back with an error
const note = ref('')
const busy = ref(false)
const card = ref(null)
const focusFirst = () => card.value?.querySelector('input')?.focus() // name / email / new password: always the first field
onMounted(() => {
  focusFirst()
  trackSignInScreen(inApp, auth.wasGuest)
  if (error.value) trackSignInEvent('signin-error', { inApp })
})

// In an app's built-in browser (tapping a link in Reddit, Instagram…) Google refuses to sign in
// ("403 disallowed_useragent"), so offer the way out first: open this page in the real browser.
const inApp = inAppBrowser()
const android = /Android/.test(navigator.userAgent)
const pageUrl = `${location.origin}/app`
const chromeIntent = `intent://${location.host}/app#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(pageUrl)};end`
const copied = ref(false)
async function copyLink() {
  trackSignInEvent('signin-copy-link', { inApp })
  try { await navigator.clipboard.writeText(pageUrl); copied.value = true } catch { window.prompt('Copy this link and open it in your browser:', pageUrl) }
}
function google() {
  trackSignInEvent('signin-google', { inApp })
  setTimeout(signInWithGoogle, 150) // let the event leave before the page navigates away
}

// "Try it without an account": the demo planner opens right away in this browser, and signing in later keeps it.
// Only where someone could go on to make an account (a closed server has no use for it), and not mid password reset.
const canTry = computed(() => auth.signups === 'open' && !auth.resetToken && (mode.value === 'signin' || mode.value === 'signup'))
function tryIt() {
  trackSignInEvent(auth.wasGuest ? 'signin-guest-back' : 'signin-guest', { inApp })
  enterGuest()
}

const TITLES = { signin: auth.wasGuest ? 'Keep your planner' : auth.password ? 'Sign in' : 'Get started — free', signup: 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password' }
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
    <!-- the pitch: the logo's figure faces right, toward the sign-in card -->
    <section class="auth-pitch">
      <img class="auth-hero" src="/media/logo-tile.webp" width="760" height="609" alt="Life Console logo: a white-haired figure with a halo and a white cat" decoding="async" fetchpriority="high" />
      <div class="pitch-text">
        <p class="kicker mono">Military-grade planning for your own goals</p>
        <p class="headline">Know what to do right now.</p>
        <p class="lede">Life Console turns your goals into a week plan, and your week plan into the next thing to do.</p>
      </div>
    </section>
    <ul class="perks">
      <li><span class="icon sm">radar</span><span><b>Today at a glance</b> — the current block counting down, and what's next.</span></li>
      <li><span class="icon sm">calendar_month</span><span><b>Plan the week in three moves</b> — drag tasks onto days and level the load.</span></li>
      <li><span class="icon sm">alarm</span><span><b>Deadlines as time left</b>, not dates, so nothing sneaks up on you.</span></li>
      <li><span class="icon sm">lock_open</span><span><b>Free and open source.</b> Works offline, installs on your phone, syncs your devices.</span></li>
    </ul>

    <form ref="card" class="auth-card panel" @submit.prevent="submit">
      <h1>{{ TITLES[mode] }}</h1>
      <p v-if="auth.wasGuest && (mode === 'signin' || mode === 'signup')" class="small muted sub">Sign in and the planner you made in this browser comes with you.</p>
      <p v-else-if="mode === 'signin' && auth.google && !auth.password" class="small muted sub">One click with Google. No password to make, nothing to install.</p>

      <div v-if="inApp && auth.google" class="inapp" role="note">
        <p><b>Open this page in your browser to sign in.</b> Google doesn't allow sign-in inside an app's built-in browser.</p>
        <a v-if="android" class="btn primary inapp-go" :href="chromeIntent" @click="trackSignInEvent('signin-open-browser', { inApp })">Open in Chrome</a>
        <p v-else class="small">Tap <b>•••</b> or the share button, then <b>Open in Safari</b> (or your browser).</p>
        <button type="button" class="btn inapp-go" @click="copyLink">{{ copied ? 'Link copied' : 'Copy link' }}</button>
      </div>

      <template v-if="mode === 'signin' || mode === 'signup'">
        <button v-if="auth.google" type="button" class="google-btn" @click="google">
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
      <div v-if="canTry" class="try">
        <div class="auth-or tiny muted"><span>{{ auth.wasGuest ? 'or' : 'not ready to sign in?' }}</span></div>
        <button type="button" class="btn try-btn" @click="tryIt">
          <span class="icon sm">{{ auth.wasGuest ? 'arrow_back' : 'play_arrow' }}</span>{{ auth.wasGuest ? 'Back to my planner' : 'Try it without an account' }}
        </button>
        <p v-if="!auth.wasGuest" class="tiny muted">Opens a sample planner right away. It stays in this browser until you sign in, then it's yours to keep.</p>
      </div>
      <p class="auth-legal tiny muted">By continuing you agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
    </form>
  </div>
</template>

<style scoped>
/* phone: logo + headline, then the card (the thing to do), then the perks; desktop: pitch left, card right */
.auth-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 400px); grid-template-areas: 'pitch' 'card' 'perks'; justify-content: center; align-content: center; gap: 20px; padding: 20px 16px 32px; background: var(--bg); }
.auth-pitch { grid-area: pitch; text-align: center; }
.auth-card { grid-area: card; }
.perks { grid-area: perks; }
.auth-hero { display: block; width: 132px; height: auto; margin: 0 auto 12px; }
.kicker { display: none; margin: 0 0 8px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.headline { margin: 0; font: 700 26px/1.15 Inter, sans-serif; color: var(--text); text-wrap: balance; }
.lede { margin: 8px 0 0; font-size: 15px; line-height: 1.5; color: var(--muted); text-wrap: pretty; }
.perks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.perks li { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.45; color: var(--muted); }
.perks b { color: var(--text); font-weight: 600; }
.perks .icon { color: var(--accent); margin-top: 1px; flex: none; }
@media (min-width: 880px) {
  .auth-page { grid-template-columns: minmax(0, 460px) 400px; grid-template-rows: auto auto; grid-template-areas: 'pitch card' 'perks card'; column-gap: 64px; row-gap: 24px; align-items: start; padding: 40px 32px; }
  .auth-pitch { text-align: left; align-self: end; }
  .auth-hero { width: 220px; margin: 0 0 20px; }
  .kicker { display: block; }
  .headline { font-size: 38px; }
  .lede { font-size: 17px; }
  .auth-card { align-self: center; }
}
.auth-card { width: 100%; max-width: 400px; padding: 22px; display: flex; flex-direction: column; gap: 14px; justify-self: center; }
h1 { margin: 4px 0 0; font: 600 22px/28px Inter, sans-serif; }
.sub { margin: -8px 0 0; }
.big-in { height: 40px; font-size: 15px; padding: 0 10px; }
.auth-go { height: 40px; font-size: 15px; justify-content: center; }
.auth-go:disabled { opacity: 0.6; }
.auth-msg { margin: 0; font-size: 13px; }
.auth-links { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.inapp { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--warn); border-radius: 2px; }
.inapp p { margin: 0; font-size: 14px; line-height: 1.45; }
.inapp-go { height: 40px; font: 600 15px/1 Inter, sans-serif; justify-content: center; text-decoration: none; }
.linkish { background: none; border: 0; padding: 0; color: var(--info); cursor: pointer; font: inherit; }
.linkish:hover { text-decoration: underline; }
.ok { color: var(--accent); }
.google-btn { height: 44px; display: flex; align-items: center; justify-content: center; gap: 10px; border-radius: 2px; border: 1px solid var(--border); background: #fff; color: #1f1f1f; font: 600 15px/1 Inter, sans-serif; cursor: pointer; }
.google-btn:hover { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent); }
.try { display: flex; flex-direction: column; gap: 10px; }
.try p { margin: 0; }
.try-btn { height: 40px; justify-content: center; font: 500 15px/1 Inter, sans-serif; border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); color: var(--text); }
.try-btn .icon { color: var(--accent); }
.auth-legal { margin: 0; border-top: 1px solid var(--border); padding-top: 10px; }
.auth-legal a { color: var(--info); }
.auth-or { display: flex; align-items: center; gap: 10px; }
.auth-or::before, .auth-or::after { content: ''; flex: 1; border-top: 1px solid var(--border); }
.danger { color: var(--danger); }
</style>
