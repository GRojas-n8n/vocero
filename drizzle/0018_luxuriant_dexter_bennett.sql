CREATE TABLE "agent_profile_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"tone" text,
	"instructions" text,
	"escalation_rules" text,
	"greeting" text,
	"changed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "is_draft_preview" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile_version" ADD CONSTRAINT "agent_profile_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_version" ADD CONSTRAINT "agent_profile_version_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_profile_version_org_idx" ON "agent_profile_version" USING btree ("organization_id","created_at");