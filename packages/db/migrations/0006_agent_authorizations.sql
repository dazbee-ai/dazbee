CREATE TABLE "agent_authorizations" (
	"hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text,
	"code_challenge" text NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"brand_ids" jsonb,
	"writes" boolean,
	"expires_at" timestamp with time zone NOT NULL,
	"access_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_authorizations_kind" CHECK ("agent_authorizations"."kind" in ('request', 'code'))
);
--> statement-breakpoint
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_client_id_agent_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."agent_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_access_id_agent_accesses_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."agent_accesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_authorizations_expires" ON "agent_authorizations" USING btree ("expires_at");