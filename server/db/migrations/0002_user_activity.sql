CREATE TABLE "user_activity" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "user_activity_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_activity_day_idx" ON "user_activity" USING btree ("day");--> statement-breakpoint
-- backfill from the history we already have, so churn/retention aren't empty for the first two months:
-- sign-up day, last sign-in, sessions' last-seen day, and hourly planner snapshots (taken while a planner changes)
INSERT INTO "user_activity" ("user_id", "day")
SELECT "id", ("created_at" AT TIME ZONE 'UTC')::date FROM "users"
UNION SELECT "id", ("last_login_at" AT TIME ZONE 'UTC')::date FROM "users" WHERE "last_login_at" IS NOT NULL
UNION SELECT "user_id", ("last_seen_at" AT TIME ZONE 'UTC')::date FROM "sessions"
UNION SELECT "user_id", ("created_at" AT TIME ZONE 'UTC')::date FROM "planner_revisions"
UNION SELECT "user_id", ("updated_at" AT TIME ZONE 'UTC')::date FROM "planner_docs"
ON CONFLICT DO NOTHING;
