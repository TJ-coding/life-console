import { defineModule } from '../../src/sdk/registry.js'
import TodoInbox from '../../src/views/TodoInbox.vue'

export default defineModule({
  id: 'todos', title: 'Todos', icon: 'checklist',
  routes: [{ path: '/todos', name: 'todos', component: TodoInbox, meta: { title: 'Todo Inbox', screen: 'S-20' } }],
  nav: [{ key: 'todos', label: 'Todos', icon: 'checklist', to: '/todos', chord: 'I', tab: 'Todos' }],
})
