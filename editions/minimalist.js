// Minimalist Console: today, a todo list and focus mode, and nothing else on screen.
// It only changes what is SHOWN. Data and settings stay the account's: a pomodoro sitting made in the base
// console still runs as one here, and switching back shows everything again.
export default {
  id: 'minimalist',
  name: 'Minimalist Console',
  short: 'Minimalist',
  tagline: 'Today, your list, and focus. Nothing else.',
  pitch: 'See what to do right now, keep one list of everything else, and press one key to hide the rest.', // sign-in screen
  landing: '/minimalist', // its landing page on the main domain (public/landing-minimalist.html)
  modules: ['today', 'todos', 'focus'],
  // view switches that core screens read (src/edition.js feature())
  features: { lsd: false, stamps: false, pomodoro: false },
  sidebar: 'collapsed', // on a device that hasn't chosen yet
  // starting values for a NEW account only (its first document); never applied to an existing one
  newAccount: { settings: { notify: { daily: false, wellbeing: false, pomodoro: false } } },
  /** The demo planner, from the base one: just today's and this week's tasks, no plans, goals or deadlines. */
  seed(doc) {
    const keep = new Set(['T-101', 'T-102', 'T-103', 'T-104', 'T-105', 'T-107', 'T-108'])
    return {
      ...doc,
      todos: doc.todos.filter((t) => keep.has(t.id)).map((t) => ({ ...t, links: [] })),
      timeBlocks: doc.timeBlocks.map((b) => ({ ...b, link: null })),
      plans: [],
      deadlines: [],
    }
  },
  tour: {
    moves: [2], // the Execute stops only (Command Center, ticking off, focus mode)
    welcome: { title: 'Just today', body: 'What to do now, your list, and focus. About thirty seconds.' },
    finish: { title: 'That’s all there is', body: 'Add a task with N, tick it off with X, press F to focus. Keep the demo to play with, or start empty.' },
  },
}
