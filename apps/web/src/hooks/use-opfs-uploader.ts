const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

// Save a chunk blob to OPFS (browser's private filesystem)
export async function saveChunkToOPFS(
  chunkId: string,
  blob: Blob
): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(`${chunkId}.wav`, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// Upload a chunk from OPFS to the server
export async function uploadChunkFromOPFS(
  chunkId: string,
  sessionId: string
): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(`${chunkId}.wav`);
    const file = await fileHandle.getFile();
    const base64 = await blobToBase64(file);

    const res = await fetch(`${SERVER_URL}/api/chunks/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkId, sessionId, data: base64 }),
    });

    if (!res.ok) return false;

    // Only delete from OPFS after server confirmed both bucket + DB
    await root.removeEntry(`${chunkId}.wav`);
    return true;
  } catch (err) {
    console.error(`Failed to upload chunk ${chunkId}:`, err);
    return false;
  }
}

// Check DB acks vs bucket — re-upload anything missing
export async function reconcile(sessionId: string): Promise<void> {
  try {
    const res = await fetch(
      `${SERVER_URL}/api/chunks/reconcile/${sessionId}`
    );
    const { missing } = (await res.json()) as { missing: string[] };

    if (missing.length === 0) return;

    console.log(`Reconciling ${missing.length} missing chunks...`);
    await Promise.allSettled(
      missing.map((chunkId) => uploadChunkFromOPFS(chunkId, sessionId))
    );
  } catch (err) {
    console.error("Reconcile failed:", err);
  }
}

// Helper: Blob → base64 string
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (base64) resolve(base64);
      else reject(new Error("Failed to convert blob to base64"));
    };
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}