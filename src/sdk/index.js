// The app's registry: every module (modules/index.js) plus the shell's own entries, checked once at startup.
import MODULES from '../../modules/index.js'
import core from './core.js'
import { buildRegistry } from './registry.js'

export { defineModule } from './registry.js'
export const registry = buildRegistry([...MODULES, core])
