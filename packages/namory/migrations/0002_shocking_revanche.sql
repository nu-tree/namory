CREATE TABLE IF NOT EXISTS "crons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"schedule" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Seoul' NOT NULL,
	"prompt" text NOT NULL,
	"channel_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone
);
