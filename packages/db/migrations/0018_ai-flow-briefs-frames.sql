CREATE TABLE "ai_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"design_id" text NOT NULL,
	"section_id" text NOT NULL,
	"words" text NOT NULL,
	"picture_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"reference_key" text,
	"logo_key" text,
	"liked_key" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"mode" text NOT NULL,
	"plan" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_frames" (
	"design_id" text NOT NULL,
	"frame_id" text NOT NULL,
	"brief_id" text,
	"job_id" text NOT NULL,
	"call_index" integer NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"asset_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_frames_design_id_frame_id_pk" PRIMARY KEY("design_id","frame_id")
);
--> statement-breakpoint
CREATE TABLE "ai_refines" (
	"id" text PRIMARY KEY NOT NULL,
	"design_id" text NOT NULL,
	"frame_id" text NOT NULL,
	"message" text NOT NULL,
	"marks_key" text,
	"summary" text,
	"result_asset_id" text,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_grants" ADD COLUMN "layer_size" integer DEFAULT 512 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_briefs" ADD CONSTRAINT "ai_briefs_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_frames" ADD CONSTRAINT "ai_frames_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_frames" ADD CONSTRAINT "ai_frames_brief_id_ai_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."ai_briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_frames" ADD CONSTRAINT "ai_frames_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_refines" ADD CONSTRAINT "ai_refines_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_refines" ADD CONSTRAINT "ai_refines_result_asset_id_assets_id_fk" FOREIGN KEY ("result_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_briefs_design" ON "ai_briefs" USING btree ("design_id");--> statement-breakpoint
CREATE INDEX "ai_frames_job" ON "ai_frames" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ai_refines_frame" ON "ai_refines" USING btree ("design_id","frame_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_grants" ADD CONSTRAINT "ai_grants_layer_size" CHECK ("ai_grants"."layer_size" in (512, 1024));--> statement-breakpoint
INSERT INTO "ai_step_models" ("step", "model", "options") VALUES ('flow.round-plan-full', 'gpt-6.2-sol', '{}')
ON CONFLICT ("step") DO NOTHING;