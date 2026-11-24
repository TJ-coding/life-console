CREATE TABLE "consent_nonces" (
	"nonce_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"action" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plugin_installs" (
	"user_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"hash" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_installs_user_id_package_name_pk" PRIMARY KEY("user_id","package_name")
);
--> statement-breakpoint
CREATE TABLE "plugin_packages" (
	"name" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'extension' NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_name" text NOT NULL,
	"hash" text DEFAULT '' NOT NULL,
	"reporter_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_versions" (
	"hash" text PRIMARY KEY NOT NULL,
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"code" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"pulled" boolean DEFAULT false NOT NULL,
	"pulled_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_secrets" (
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"site" text NOT NULL,
	"scheme" text DEFAULT 'bearer' NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "vault_secrets_user_id_name_pk" PRIMARY KEY("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_plugins" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_nonces" ADD CONSTRAINT "consent_nonces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installs" ADD CONSTRAINT "plugin_installs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_packages" ADD CONSTRAINT "plugin_packages_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_reports" ADD CONSTRAINT "plugin_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_versions" ADD CONSTRAINT "plugin_versions_package_name_plugin_packages_name_fk" FOREIGN KEY ("package_name") REFERENCES "public"."plugin_packages"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_secrets" ADD CONSTRAINT "vault_secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_nonces_user_idx" ON "consent_nonces" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plugin_packages_owner_idx" ON "plugin_packages" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "plugin_reports_pkg_idx" ON "plugin_reports" USING btree ("package_name");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_versions_pkg_version_key" ON "plugin_versions" USING btree ("package_name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_key" ON "users" USING btree ("handle");