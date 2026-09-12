CREATE TABLE "ai_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"token_cipher" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"model" text NOT NULL,
	"judge_model" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credentials_org_uq" ON "ai_credentials" USING btree ("organization_id");