CREATE TABLE "agent_accesses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_ids" jsonb,
	"writes" boolean NOT NULL,
	"client_id" text,
	"client_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"hash" text PRIMARY KEY NOT NULL,
	"access_id" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"swapped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tokens_kind" CHECK ("agent_tokens"."kind" in ('access', 'refresh'))
);
--> statement-breakpoint
ALTER TABLE "agent_accesses" ADD CONSTRAINT "agent_accesses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_accesses" ADD CONSTRAINT "agent_accesses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_accesses" ADD CONSTRAINT "agent_accesses_client_id_agent_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."agent_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_access_id_agent_accesses_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."agent_accesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_accesses_member" ON "agent_accesses" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "agent_tokens_access" ON "agent_tokens" USING btree ("access_id");