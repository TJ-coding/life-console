export const NAV = [
  { key: 'today', label: 'Command Center', icon: 'radar', to: '/', key1: 'T' },
  { key: 'week', label: 'Plan week', icon: 'calendar_month', to: '/week', key1: 'W' },
  { key: 'todos', label: 'Todos', icon: 'checklist', to: '/todos', key1: 'G I' },
  { key: 'deadlines', label: 'Deadlines', icon: 'alarm', to: '/deadlines', key1: 'G D' },
  { key: 'strategy', label: 'Strategy', icon: 'target', to: '/strategy', key1: 'G S' },
  { key: 'intelligence', label: 'Intelligence', icon: 'satellite_alt', to: '/m/intelligence' },
  { key: 'research', label: 'Research', icon: 'science', to: '/m/research' },
  { key: 'study', label: 'Study', icon: 'menu_book', to: '/m/study' },
  { key: 'wellbeing', label: 'Wellbeing', icon: 'ecg_heart', to: '/m/wellbeing' },
  { key: 'standards', label: 'Standards', icon: 'timer', to: '/m/standards' },
  { key: 'issues', label: 'Issues', icon: 'bug_report', to: '/issues', key1: 'G B' },
  { key: 'settings', label: 'Settings', icon: 'settings', to: '/settings' },
]

// Screens from the spec that are not built in this prototype yet.
export const PLANNED = {
  intelligence: ['S-40 IPB Project Overview', 'S-41 Operational Environment', 'S-42 Threat Overlay', 'S-43 Evaluate the Threat (CARVER)', 'S-44 Situation Template & COA', 'S-45 Decision Support Template', 'S-46 Information Collection Matrix'],
  research: ['S-50 Reading List + Ochiai Card', 'S-51 Problem Candidate Backlog', 'S-52 Emerging Trend Report', 'S-53 PIR / SIR Sheet', 'S-54 Tagged Notes'],
  study: ['S-55 Courses Index', 'S-56 Course Profile', 'S-57 Lecture & Homework Tracker', 'S-58 Read Ahead Lecture Sheet'],
  wellbeing: ['S-60 Sleep Log', 'S-61 Sleep Day Entry', 'S-62 Wellbeing Checklist', 'S-63 CES-D Check-in', 'S-64 Support Plans'],
  standards: ['S-70 Task Standard Sheet'],
}
