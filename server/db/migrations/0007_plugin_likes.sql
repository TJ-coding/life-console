CREATE TABLE "plugin_likes" (
	"user_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_likes_user_id_package_name_pk" PRIMARY KEY("user_id","package_name")
);
--> statement-breakpoint
ALTER TABLE "plugin_likes" ADD CONSTRAINT "plugin_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_likes" ADD CONSTRAINT "plugin_likes_package_name_plugin_packages_name_fk" FOREIGN KEY ("package_name") REFERENCES "public"."plugin_packages"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugin_likes_pkg_idx" ON "plugin_likes" USING btree ("package_name");