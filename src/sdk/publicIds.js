// Which modules are Public plugins installed for this account: they're shown whatever the edition (an install is
// per account, platform/whitepaper.md), so src/edition.js asks here. Kept apart to avoid an import cycle.
import { reactive } from 'vue'
export const publicIds = reactive(new Set())
