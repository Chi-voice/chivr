import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".s5data");

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

function storeFile(name: string) {
  return join(DATA_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function toKey(key: Uint8Array): string {
  return Buffer.from(key).toString("hex");
}

/**
 * File-backed KV store — use for data that must survive restarts (auth tokens,
 * identity packs). Writes are synchronous but infrequent.
 */
export class FileKvStore {
  private data: Record<string, number[]>;
  private file: string;

  private constructor(file: string, data: Record<string, number[]>) {
    this.file = file;
    this.data = data;
  }

  static open(name: string): FileKvStore {
    const file = storeFile(name);
    let data: Record<string, number[]> = {};
    if (existsSync(file)) {
      try {
        data = JSON.parse(readFileSync(file, "utf-8"));
      } catch {
        data = {};
      }
    }
    return new FileKvStore(file, data);
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.data), "utf-8");
  }

  async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    this.data[toKey(key)] = Array.from(value);
    this.save();
  }

  async get(key: Uint8Array): Promise<Uint8Array | undefined> {
    const val = this.data[toKey(key)];
    return val ? new Uint8Array(val) : undefined;
  }

  async contains(key: Uint8Array): Promise<boolean> {
    return toKey(key) in this.data;
  }
}

/**
 * In-memory KV store — use for volatile P2P data (registry entries, blob
 * locations). Fast, no disk I/O, does not persist across restarts.
 */
export class MemoryKvStore {
  private data = new Map<string, Uint8Array>();

  static open(_name: string): MemoryKvStore {
    return new MemoryKvStore();
  }

  async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    this.data.set(toKey(key), value instanceof Uint8Array ? value : new Uint8Array(value));
  }

  async get(key: Uint8Array): Promise<Uint8Array | undefined> {
    return this.data.get(toKey(key));
  }

  async contains(key: Uint8Array): Promise<boolean> {
    return this.data.has(toKey(key));
  }
}
