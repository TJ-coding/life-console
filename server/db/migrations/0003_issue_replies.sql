ALTER TABLE "issues" ADD COLUMN "reporter_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "replies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "issues" SET "reporter_seen_at" = "resolved_at" WHERE "status" IN ('fixed', 'wontfix') AND "resolved_at" < '2026-11-21T00:00:00Z';
