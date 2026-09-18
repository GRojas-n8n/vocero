CREATE TABLE "contact_note" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"scenario" text,
	"text" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_source_message_id_message_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_note_org_contact_idx" ON "contact_note" USING btree ("organization_id","contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_note_contact_hash_uq" ON "contact_note" USING btree ("contact_id","content_hash");