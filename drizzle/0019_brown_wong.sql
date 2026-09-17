CREATE TABLE "booking_change_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"original_booking_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "additional_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_change_request" ADD CONSTRAINT "booking_change_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_change_request" ADD CONSTRAINT "booking_change_request_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_change_request" ADD CONSTRAINT "booking_change_request_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_change_request" ADD CONSTRAINT "booking_change_request_original_booking_id_booking_id_fk" FOREIGN KEY ("original_booking_id") REFERENCES "public"."booking"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_change_request_contact_idx" ON "booking_change_request" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_change_request_pending_uq" ON "booking_change_request" USING btree ("organization_id","contact_id") WHERE "booking_change_request"."status" = 'pending';--> statement-breakpoint
-- Auditoría 2026-09-17 — instalaciones que ya venían con el bug (más de una
-- cita activa "normal" para el mismo contacto, como el caso reportado) no
-- pueden recibir el índice único de abajo tal cual: violaría datos que ya
-- existen. Esto NO cancela ni reprograma nada — ningún status, horario,
-- enlace o nota cambia — solo marca como `additional_confirmed` las citas
-- duplicadas más ANTIGUAS de cada contacto (se conserva como "canónica" la
-- más reciente), para que el índice se pueda crear sin tocar la historia. De
-- aquí en adelante, una segunda cita para el mismo contacto exige la
-- confirmación explícita que este cambio introduce.
WITH "ranked" AS (
	SELECT "id",
		row_number() OVER (
			PARTITION BY "organization_id", "contact_id"
			ORDER BY "created_at" DESC, "id" DESC
		) AS "rn"
	FROM "booking"
	WHERE "status" IN ('agendada', 'realizada')
		AND "is_test" = false
		AND "contact_id" IS NOT NULL
)
UPDATE "booking"
SET "additional_confirmed" = true
WHERE "id" IN (SELECT "id" FROM "ranked" WHERE "rn" > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "booking_org_contact_single_active_uq" ON "booking" USING btree ("organization_id","contact_id") WHERE "booking"."status" in ('agendada','realizada') and "booking"."is_test" = false and "booking"."additional_confirmed" = false and "booking"."contact_id" is not null;