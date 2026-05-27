ALTER TABLE "memories" ADD COLUMN "project" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_project_idx" ON "memories" USING btree ("project");