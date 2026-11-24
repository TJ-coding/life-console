CREATE TABLE "actor_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"public_pem" text NOT NULL,
	"private_pem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_inbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"object_id" text DEFAULT '' NOT NULL,
	"activity" jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pod_resources" (
	"owner_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content_type" text DEFAULT 'application/ld+json' NOT NULL,
	"body" text NOT NULL,
	"etag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pod_resources_owner_id_path_pk" PRIMARY KEY("owner_id","path")
);
--> statement-breakpoint
CREATE TABLE "remote_actors" (
	"id" text PRIMARY KEY NOT NULL,
	"inbox" text NOT NULL,
	"public_pem" text NOT NULL,
	"handle" text DEFAULT '' NOT NULL,
	"moved_to" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" text NOT NULL,
	"actor" text NOT NULL,
	"access" text DEFAULT 'view' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pod_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moved_to" text;--> statement-breakpoint
ALTER TABLE "actor_keys" ADD CONSTRAINT "actor_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_inbox" ADD CONSTRAINT "federation_inbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_resources" ADD CONSTRAINT "pod_resources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "federation_inbox_user_idx" ON "federation_inbox" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shares_owner_idx" ON "shares" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "shares_actor_idx" ON "shares" USING btree ("actor");