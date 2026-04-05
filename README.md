# Reliable Recording Chunking Pipeline

Built for Swades AI Hackathon by Prachi Bane.

## What it does
Records audio in the browser, splits into 5-second WAV chunks, stores durably via OPFS, uploads to storage bucket, and acknowledges in PostgreSQL. Includes reconciliation to detect and repair any missing chunks.

## Stack
- Next.js 16 + Hono + Bun + Drizzle ORM + PostgreSQL (Neon) + TailwindCSS

## Flow
1. Record audio -> split into 5s WAV chunks
2. Save each chunk to OPFS (browser durable storage)
3. Upload chunk to storage bucket
4. Acknowledge in PostgreSQL
5. On stop: reconcile DB acks vs bucket to catch any missing chunks

## Key features
- Zero data loss: OPFS acts as durable buffer
- Idempotent uploads: safe to retry without duplicates
- Reconciliation: detects and repairs bucket/DB mismatches
- Transcript ready: pipeline built for Whisper/Deepgram STT

## Run locally
npm install
npm run db:push
npm run dev
