CREATE TABLE "public"."whatsapp_events" (
    "id" BIGSERIAL NOT NULL,
    "wamid" VARCHAR(131) NOT NULL,
    "event_name" VARCHAR(36) NOT NULL,
    "code" BIGINT NOT NULL,
    "category" VARCHAR(16),
    "content" JSON,
    "event_at" TIMESTAMP(0) NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    CONSTRAINT "whatsapp_message_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_events_event_at_idx" ON "public"."whatsapp_events"("event_at" DESC);
CREATE INDEX "whatsapp_events_events_wamid_idx" ON "public"."whatsapp_events"("wamid");
CREATE INDEX "whatsapp_events_events_event_name_idx" ON "public"."whatsapp_events"("event_name");
