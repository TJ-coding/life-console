// Every module's UI manifest, in sidebar order. To add a module: modules/<id>/index.js (+ data.js, listed in
// modules/data.js too), then add it here. The guide is in CLAUDE.md ("Modules").
import today from './today/index.js'
import week from './week/index.js'
import focus from './focus/index.js'
import briefing from './briefing/index.js'
import todos from './todos/index.js'
import deadlines from './deadlines/index.js'
import strategy from './strategy/index.js'
import intelligence from './intelligence/index.js'
import research from './research/index.js'
import study from './study/index.js'
import wellbeing from './wellbeing/index.js'
import standards from './standards/index.js'

export default [today, week, focus, briefing, todos, deadlines, strategy, intelligence, research, study, wellbeing, standards]
