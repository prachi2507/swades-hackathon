import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { eq } from "drizzle-orm";
import { db, chunks } from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/server";
import { writeFile, mkdir, access, readFile } from "fs/promises";
import { join } from "path";
import Groq from "groq-sdk";

const app = new Hono();

app.use(logger());
app.use("/*", cors({
  origin: env.CORS_ORIGIN,
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

const BUCKET_DIR = join(process.cwd(), "local-bucket");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
  try {
    const sessionId = c.req.param("sessionId");
    const ackedChunks = await db.select().from(chunks)
      .where(eq(chunks.sessionId, sessionId));

    if (ackedChunks.length === 0) {
      return c.json({ error: "No chunks found" }, 404);
    }

    const results = await Promise.all(
      ackedChunks.map(async (chunk, i) => {
        try {
          const filePath = join(BUCKET_DIR, chunk.bucketKey);
          const fileBuffer = await readFile(filePath);
          const file = new File([fileBuffer], "chunk.wav", { type: "audio/wav" });

          const transcription = await groq.audio.transcriptions.create({
            file,
            model: "whisper-large-v3",
            language: "en",
          });

          return {
            chunkId: chunk.chunkId,
            index: i + 1,
            speaker: i % 2 === 0 ? "Speaker A" : "Speaker B",
            transcript: transcription.text,
            ackedAt: chunk.ackedAt,
          };
        } catch (err) {
          console.error(`Transcription failed for chunk ${chunk.chunkId}:`, err);
          return {
            chunkId: chunk.chunkId,
            index: i + 1,
            speaker: i % 2 === 0 ? "Speaker A" : "Speaker B",
            transcript: "[transcription failed for this chunk]",
            ackedAt: chunk.ackedAt,
          };
        }
      })
    );

    return c.json({
      sessionId,
      totalChunks: ackedChunks.length,
      status: "transcribed",
      message: "Transcribed using Whisper via Groq API",
      chunks: results,
    });
  } catch (err) {
    console.error("Transcript error:", err);
    return c.json({ error: "Transc