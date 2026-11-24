CREATE TABLE "plugin_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_name" text NOT NULL,
	"from_hash" text NOT NULL,
	"author_id" uuid,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "plugin_packages" ADD COLUMN "forked_from" text;--> statement-breakpoint
ALTER TABLE "plugin_proposals" ADD CONSTRAINT "plugin_proposals_package_name_plugin_packages_name_fk" FOREIGN KEY ("package_name") REFERENCES "public"."plugin_packages"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_proposals" ADD CONSTRAINT "plugin_proposals_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugin_proposals_pkg_idx" ON "plugin_proposals" USING btree ("package_name");