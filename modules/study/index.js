import { defineModule } from '../../src/sdk/registry.js'
import data from './data.js'

// Not built yet: /m/study shows the spec's planned screens (src/views/ModulePlaceholder.vue).
export default defineModule({
  data, title: 'Study', icon: 'menu_book',
  nav: [{ key: 'study', label: 'Study', icon: 'menu_book', to: '/m/study' }],
  planned: [
    'S-55 Courses Index',
    'S-56 Course Profile',
    'S-57 Lecture & Homework Tracker',
    'S-58 Read Ahead Lecture Sheet',
  ],
})
