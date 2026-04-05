import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { eq } from "drizzle-orm";
import { db, chunks } from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/server";
import { writeFile, mkdir, access } from "fs/promises";
import { join } from "path";

const app = new Hono();

app.use(logger());
app.use("/*", cors({
  origin: env.CORS_ORIGIN,
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

const BUCKET_DIR = join(process.cwd(), "local-bucket");

async function ensureDir(sessionId: string) {
  const dir = join(BUCKET_DIR, sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

app.get("/", (c) => c.text("OK"));

app.post("/api/chunks/upload", async (c) => {
  try {
    const { chunkId, sessionId, data } = await c.req.json<{
      chunkId: string;
      sessionId: string;
      data: string;
    }>();

    if (!chunkId || !sessionId || !data) {
      return c.json({ ok: false, error: "Missing fields" }, 400);
    }

    const dir = await ensureDir(sessionId);
    const filePath = join(dir, `${chunkId}.wav`);
    await writeFile(filePath, Buffer.from(data, "base64"));

    await db.insert(chunks)
      .values({ chunkId, sessionId, bucketKey: `${sessionId}/${chunkId}.wav` })
      .onConflictDoNothing();

    return c.json({ ok: true });
  } catch (err) {
    console.error("Upload error:", err);
    return c.json({ ok: false, error: "Upload failed" }, 500);
  }
});

app.get("/api/chunks/reconcile/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const ackedChunks = await db.select().from(chunks)
      .where(eq(chunks.sessionId, sessionId));

    const missing: string[] = [];
    await Promise.all(ackedChunks.map(async (chunk) => {
      const exists = await fileExists(join(BUCKET_DIR, chunk.bucketKey));
      if (!exists) missing.push(chunk.chunkId);
    }));

    return c.json({ missing });
  } catch (err) {
    console.error("Reconcile error:", err);
    return c.json({ missing: [] }, 500);
  }
});

app.get("/api/chunks/transcript/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const ackedChunks = await db.select().from(chunks)
    .where(eq(chunks.sessionId, sessionId));

  const mockTranscripts = [
    "Can we move the deadline to next Friday?",
    "Sure, that works for the team.",
    "I will update the project board accordingly.",
    "Thanks, let us sync again tomorrow.",
    "Sounds good, talk soon.",
  ];

  return c.json({
    sessionId,
    totalChunks: ackedChunks.length,
    status: "pipeline_ready",
    message: "In production: chunks sent to Whisper/Deepgram for transcription",
    chunks: ackedChunks.map((chunk, i) => ({
      chunkId: chunk.chunkId,
      bucketKey: chunk.bucketKey,
      ackedAt: chunk.ackedAt,
      speaker: i % 2 === 0 ? "Speaker A" : "Speaker B",
      transcript: mockTranscripts[i % mockTranscripts.length],
    })),
  });
});

export default app;