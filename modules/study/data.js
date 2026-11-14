// Pure data contract (no Vue). Study owns the fallback: a link that is no goal and has no known prefix is a course code.
// It will own the existing top-level `lectures` key in place (the platform plan, §4 rule 3).
export default {
  id: 'study',
  linkTypes: [{ kind: 'course', fallback: true }],
}
