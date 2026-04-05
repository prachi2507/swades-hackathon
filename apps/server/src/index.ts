import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { eq } from "drizzle-orm";
import { db, chunks } from "@my-better-t-app/db";
import { writeFile, mkdir, access } from "fs/promises";
import { join } from "path";

const app = new Hono();

app.use(logger());
app.use("/*", cors({ origin: "*" }));

const BUCKET_DIR = join(process.cwd(), "local-bucket");

// ✅ ensure directory exists
async function ensureDir(sessionId: string) {
  const dir = join(BUCKET_DIR, sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ✅ check if file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ✅ health check
app.get("/", (c) => c.text("OK"));


// ✅ UPLOAD CHUNK
app.post("/api/chunks/upload", async (c) => {
  try {
    const { chunkId, sessionId, data } = await c.req.json();

    if (!chunkId || !sessionId || !data) {
      return c.json({ ok: false, error: "Missing fields" }, 400);
    }

    // 1. Save to local bucket
    const dir = await ensureDir(sessionId);
    const filePath = join(dir, `${chunkId}.wav`);

    await writeFile(filePath, Buffer.from(data, "base64"));

    // 2. Insert DB ack (idempotent)
    await db.insert(chunks)
      .values({
        chunkId,
        sessionId,
        bucketKey: `${sessionId}/${chunkId}.wav`,
      })
      .onConflictDoNothing();

    return c.json({ ok: true });
  } catch (err) {
    console.error("Upload error:", err);
    return c.json({ ok: false, error: "Upload failed" }, 500);
  }
});


// ✅ RECONCILIATION API
app.get("/api/chunks/reconcile/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");

    const ackedChunks = await db.select().from(chunks)
      .where(eq(chunks.sessionId, sessionId));

    const missing: string[] = [];

    await Promise.all(
      ackedChunks.map(async (chunk) => {
        const exists = await fileExists(
          join(BUCKET_DIR, chunk.bucketKey)
        );

        if (!exists) missing.push(chunk.chunkId);
      })
    );

    return c.json({ missing });
  } catch (err) {
    console.error("Reconcile error:", err);
    return c.json({ missing: [] }, 500);
  }
});


// ✅ SIMPLE TRANSCRIPT (MOCK — NO API)
app.get("/api/chunks/transcript/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");

    const ackedChunks = await db.select().from(chunks)
      .where(eq(chunks.sessionId, sessionId));

    return c.json({
      sessionId,
      totalChunks: ackedChunks.length,
      status: "mocked",
      chunks: ackedChunks.map((chunk, i) => ({
        chunkId: chunk.chunkId,
        index: i + 1,
        speaker: i % 2 === 0 ? "Speaker A" : "Speaker B",
        transcript: "This is a mock transcript for demo",
      })),
    });
  } catch (err) {
    console.error("Transcript error:", err);
    return c.json({ error: "failed" }, 500);
  }
});

export default app;