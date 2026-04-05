import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  chunkId: text("chunk_id").notNull().unique(),
  sessionId: text("session_id").notNull(),
  bucketKey: text("bucket_key").notNull(),
  ackedAt: timestamp("acked_at").defaultNow(),
});