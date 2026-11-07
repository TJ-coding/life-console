// drizzle-kit config: `npm run db:generate` turns changes in server/db/schema.js into a new SQL
// migration in server/db/migrations/. Commit the generated files; the server applies them on start.
export default {
  dialect: 'postgresql',
  schema: './server/db/schema.js',
  out: './server/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL || 'postgres://localhost/life_console' },
  strict: true,
}
