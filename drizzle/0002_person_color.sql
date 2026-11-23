ALTER TABLE "people" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_color_hex" CHECK ("people"."color" IS NULL OR "people"."color" ~ '^#[0-9a-f]{6}$');