// Pure data contract (no Vue). Goal numbers can be renamed to any short name, so store.js linkType() looks the
// person's own goal names up before any prefix; PSG-/SIG- here cover goals that don't exist (yet).
export default {
  id: 'strategy',
  linkTypes: [
    { kind: 'goal', prefix: 'PSG-' }, { kind: 'goal', prefix: 'SIG-' },
    { kind: 'plan', prefix: 'SP-' }, { kind: 'risk', prefix: 'R-' },
  ],
}
