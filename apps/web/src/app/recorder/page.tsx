"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Mic, Pause, Play, Square, Trash2, FileText } from "lucide-react";
import { Button } from "@my-better-t-app/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { useRecorder, type WavChunk } from "@/hooks/use-recorder";
import {
  saveChunkToOPFS,
  uploadChunkFromOPFS,
  reconcile,
} from "@/hooks/use-opfs-uploader";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
}

function formatDuration(seconds: number) {
  return `${seconds.toFixed(1)}s`;
}

type ChunkStatus = "pending" | "uploading" | "done" | "error";

function ChunkRow({
  chunk,
  index,
  status,
}: {
  chunk: WavChunk;
  index: number;
  status: ChunkStatus;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
    } else {
      el.play();
      setPlaying(true);
    }
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = chunk.url;
    a.download = `chunk-${index + 1}.wav`;
    a.click();
  };

  const statusColor: Record<ChunkStatus, string> = {
    pending: "text-yellow-500",
    uploading: "text-blue-500",
    done: "text-green-500",
    error: "text-red-500",
  };

  const statusLabel: Record<ChunkStatus, string> = {
    pending: "queued",
    uploading: "uploading…",
    done: "uploaded ✓",
    error: "failed ✗",
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 bg-muted/30 px-3 py-2">
      <audio
        ref={audioRef}
        src={chunk.url}
        onEnded={() => setPlaying(false)}
        preload="none"
      />
      <span className="text-xs font-medium text-muted-foreground tabular-nums">
        #{index + 1}
      </span>
      <span className="text-xs tabular-nums">{formatDuration(chunk.duration)}</span>
      <span className={`text-xs tabular-nums ${statusColor[status]}`}>
        {statusLabel[status]}
      </span>
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="icon-xs" onClick={toggle}>
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={download}>
          <Download className="size-3" />
        </Button>
      </div>
    </div>
  );
}

interface TranscriptChunk {
  chunkId: string;
  bucketKey: string;
  ackedAt: string;
  transcript: string;
  speaker: string;
}

interface TranscriptResponse {
  sessionId: string;
  totalChunks: number;
  status: string;
  message: string;
  chunks: TranscriptChunk[];
}

export default function RecorderPage() {
  const [deviceId] = useState<string | undefined>();
  const sessionId = useRef(crypto.randomUUID());
  const [chunkStatuses, setChunkStatuses] = useState<Record<string, ChunkStatus>>({});
  const processedChunks = useRef<Set<string>>(new Set());
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  const { status, start, stop, pause, resume, chunks, elapsed, stream, clearChunks } =
    useRecorder({ chunkDuration: 5, deviceId });

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isActive = isRecording || isPaused;

  useEffect(() => {
    const latestChunk = chunks[chunks.length - 1];
    if (!latestChunk) return;
    if (processedChunks.current.has(latestChunk.id)) return;
    processedChunks.current.add(latestChunk.id);

    const upload = async () => {
      setChunkStatuses((prev) => ({ ...prev, [latestChunk.id]: "pending" }));
      await saveChunkToOPFS(latestChunk.id, latestChunk.blob);
      setChunkStatuses((prev) => ({ ...prev, [latestChunk.id]: "uploading" }));
      const ok = await uploadChunkFromOPFS(latestChunk.id, sessionId.current);
      setChunkStatuses((prev) => ({
        ...prev,
        [latestChunk.id]: ok ? "done" : "error",
      }));
    };

    upload();
  }, [chunks.length]);

  const handleStop = useCallback(async () => {
    stop();
    await reconcile(sessionId.current);
  }, [stop]);

  const handlePrimary = useCallback(() => {
    if (isActive) {
      handleStop();
    } else {
      sessionId.current = crypto.randomUUID();
      processedChunks.current.clear();
      setTranscript(null);
      start();
    }
  }, [isActive, handleStop, start]);

  const fetchTranscript = async () => {
    setLoadingTranscript(true);
    try {
      const res = await fetch(
        `${SERVER_URL}/api/chunks/transcript/${sessionId.current}`
      );
      const data = await res.json() as TranscriptResponse;
      setTranscript(data);
    } catch (err) {
      console.error("Transcript fetch failed:", err);
    } finally {
      setLoadingTranscript(false);
    }
  };

  return (
    <div className="container mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-8">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Recorder</CardTitle>
          <CardDescription>
            16 kHz / 16-bit PCM WAV — chunked every 5s — OPFS backed
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="overflow-hidden rounded-sm border border-border/50 bg-muted/20 text-foreground">
            <LiveWaveform
              active={isRecording}
              processing={isPaused}
              stream={stream}
              height={80}
              barWidth={3}
              barGap={1}
              barRadius={2}
              sensitivity={1.8}
              smoothingTimeConstant={0.85}
              fadeEdges
              fadeWidth={32}
              mode="static"
            />
          </div>
          <div className="text-center font-mono text-3xl tabular-nums tracking-tight">
            {formatTime(elapsed)}
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button
              size="lg"
              variant={isActive ? "destructive" : "default"}
              className="gap-2 px-5"
              onClick={handlePrimary}
              disabled={status === "requesting"}
            >
              {isActive ? (
                <><Square className="size-4" />Stop</>
              ) : (
                <><Mic className="size-4" />{status === "requesting" ? "Requesting..." : "Record"}</>
              )}
            </Button>
            {isActive && (
              <Button size="lg" variant="outline" className="gap-2" onClick={isPaused ? resume : pause}>
                {isPaused ? (
                  <><Play className="size-4" />Resume</>
                ) : (
                  <><Pause className="size-4" />Pause</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {chunks.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Chunks</CardTitle>
            <CardDescription>
              {chunks.length} recorded — session: {sessionId.current.slice(0, 8)}…
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {chunks.map((chunk, i) => (
              <ChunkRow
                key={chunk.id}
                chunk={chunk}
                index={i}
                status={chunkStatuses[chunk.id] ?? "pending"}
              />
            ))}
            <div className="mt-2 flex justify-between">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={fetchTranscript}
                disabled={loadingTranscript || isActive}
              >
                <FileText className="size-3" />
                {loadingTranscript ? "Loading…" : "Get Transcript"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive"
                onClick={clearChunks}
              >
                <Trash2 className="size-3" />
                Clear all
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {transcript && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
            <CardDescription>
              {transcript.totalChunks} chunks — {transcript.status}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{transcript.message}</p>
            {transcript.chunks.map((chunk, i) => (
              <div key={chunk.chunkId} className="rounded-sm border border-border/50 bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-blue-500">{chunk.speaker}</span>
                  <span className="text-xs text-muted-foreground">chunk #{i + 1}</span>
                </div>
                <p className="text-sm">{chunk.transcript}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}