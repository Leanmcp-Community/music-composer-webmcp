import type { CompositionState, RuntimeMetrics, ToolCallRecord, ReplayRun } from "../types";

export interface SharePayload {
  composition: CompositionState;
  prompt: string;
  model: string;
  endpoint: string;
  metrics: RuntimeMetrics;
  toolCallHistory: ToolCallRecord[];
  replayRun: ReplayRun | null;
  firebaseUid?: string;
  createdAt?: unknown;
}

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ID_LENGTH = 8;

function generateShortId(): string {
  let id = "";
  const array = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(array);
  for (const byte of array) {
    id += CHARS[byte % CHARS.length];
  }
  return id;
}

async function getDb() {
  const [{ db }, { collection, doc, setDoc, getDoc, serverTimestamp }] = await Promise.all([
    import("./firebase"),
    import("firebase/firestore"),
  ]);
  return { db, collection, doc, setDoc, getDoc, serverTimestamp };
}

export async function saveShare(payload: Omit<SharePayload, "createdAt">): Promise<string> {
  const { db, collection, doc, setDoc, getDoc, serverTimestamp } = await getDb();
  const col = collection(db, "shares");
  let id = generateShortId();
  let attempts = 0;
  while (attempts < 5) {
    const ref = doc(col, id);
    const existing = await getDoc(ref);
    if (!existing.exists()) break;
    id = generateShortId();
    attempts++;
  }
  const ref = doc(col, id);
  await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
  return id;
}

export async function loadShare(id: string): Promise<SharePayload | null> {
  const { db, collection, doc, getDoc } = await getDb();
  const ref = doc(collection(db, "shares"), id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as SharePayload;
}
