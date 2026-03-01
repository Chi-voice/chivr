import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  S5Node,
  S5UserIdentity,
  JSCryptoImplementation,
} from "@julesl23/s5js";
import { S5APIWithIdentity } from "@julesl23/s5js/dist/src/identity/api.js";
import { S5Portal } from "@julesl23/s5js/dist/src/account/portal.js";
import { deriveHashInt } from "@julesl23/s5js/dist/src/util/derive_hash.js";
import { utf8ToBytes, bytesToUtf8 } from "@noble/ciphers/utils";
import { FileKvStore, MemoryKvStore } from "./nodeKvStore.js";

export interface S5Client {
  apiWithIdentity: S5APIWithIdentity;
  identity: S5UserIdentity;
}

let clientInstance: S5Client | null = null;
let initPromise: Promise<S5Client> | null = null;

// FileKvStore keys for persisted state
const KEY_IDENTITY   = utf8ToBytes("identity_main");
const KEY_ACCOUNTS   = utf8ToBytes("s5_accounts_json");
const KEY_AUTH_TOKEN = (id: string) => utf8ToBytes(`auth_${id}`);

/**
 * Derives an S5UserIdentity from a standard 12-word BIP39 mnemonic.
 *
 * The S5 SDK's `fromSeedPhrase` only accepts 15-word Skynet-format phrases.
 * We bypass that by converting BIP39 entropy → Blake3 master seed → the same
 * deriveHashInt chain the SDK uses internally to produce all child seeds.
 */
async function buildIdentityFromBip39(
  seedPhrase: string,
  crypto: JSCryptoImplementation
): Promise<S5UserIdentity> {
  const entropyBytes = mnemonicToEntropy(seedPhrase.trim().toLowerCase(), wordlist);
  const masterSeed   = crypto.hashBlake3Sync(entropyBytes);

  const mainIdentitySeed   = deriveHashInt(masterSeed, 0,  crypto);
  const publicIdentitySeed = deriveHashInt(mainIdentitySeed, 1, crypto);
  const publicSubSeed      = deriveHashInt(publicIdentitySeed, 0, crypto);
  const privateDataSeed    = deriveHashInt(mainIdentitySeed, 64, crypto);
  const privateSubSeed     = deriveHashInt(privateDataSeed, 0, crypto);

  const seeds = new Map<number, Uint8Array>();
  seeds.set(2,   deriveHashInt(publicSubSeed,  2,   crypto));
  seeds.set(3,   deriveHashInt(publicSubSeed,  3,   crypto));
  seeds.set(4,   deriveHashInt(publicSubSeed,  4,   crypto));
  seeds.set(5,   deriveHashInt(publicSubSeed,  5,   crypto));
  seeds.set(6,   deriveHashInt(publicSubSeed,  6,   crypto));
  seeds.set(65,  deriveHashInt(privateSubSeed, 65,  crypto));
  seeds.set(66,  deriveHashInt(privateSubSeed, 66,  crypto));
  seeds.set(67,  deriveHashInt(privateSubSeed, 67,  crypto));
  seeds.set(68,  deriveHashInt(privateSubSeed, 68,  crypto));
  seeds.set(69,  deriveHashInt(privateSubSeed, 69,  crypto));
  seeds.set(127, deriveHashInt(privateSubSeed, 127, crypto));

  return new S5UserIdentity(seeds);
}

async function initS5(): Promise<S5Client> {
  const seedPhrase      = process.env.S5_SEED_PHRASE;
  const portalUrl       = process.env.S5_PORTAL_URL;
  const initialPeersRaw = process.env.S5_INITIAL_PEERS;

  if (!seedPhrase) throw new Error("S5_SEED_PHRASE is not configured");
  if (!portalUrl)  throw new Error("S5_PORTAL_URL is not configured");

  const initialPeers = initialPeersRaw
    ? initialPeersRaw.split(",").map((p) => p.trim()).filter(Boolean)
    : ["wss://z2DWuPbL5pweybXnEB618pMnV58ECj2VPDNfVGm3tFqBvjF@s5.ninja/s5/p2p"];

  console.log("[S5] Initialising S5 node...");

  const crypto = new JSCryptoImplementation();
  const node   = new S5Node(crypto);

  // MemoryKvStore for all volatile P2P data — avoids blocking the event loop
  // with file I/O on every incoming P2P message.
  await node.init((_name: string) => MemoryKvStore.open(_name));

  for (const uri of initialPeers) {
    node.p2p.connectToNode(uri);
  }

  await node.ensureInitialized();
  console.log("[S5] Node connected to network.");

  // Keep cachedOnlyMode = true for the entire session.
  // This prevents the infinite blob-download loop that occurs when the
  // registry finds existing entries from a prior app using the same identity.
  // Uploads go directly to the portal via HTTP and do not need P2P reads.
  (node as any).registry.cachedOnlyMode = true;

  const authStore = FileKvStore.open("auth");

  // --- Identity ---
  let identity: S5UserIdentity;
  if (await authStore.contains(KEY_IDENTITY)) {
    console.log("[S5] Loading cached identity...");
    identity = S5UserIdentity.unpack((await authStore.get(KEY_IDENTITY))!);
  } else {
    console.log("[S5] Deriving identity from BIP39 seed phrase...");
    identity = await buildIdentityFromBip39(seedPhrase, crypto);
    await authStore.put(KEY_IDENTITY, identity.pack());
    console.log("[S5] Identity derived and cached.");
  }

  const apiWithIdentity = new S5APIWithIdentity(node, identity, authStore);
  const uri             = new URL(portalUrl);
  const portalHost      = uri.hostname + (uri.port ? `:${uri.port}` : "");
  const portalProto     = uri.protocol.replace(":", "").toLowerCase();

  // --- Portal account ---
  if (await authStore.contains(KEY_ACCOUNTS)) {
    console.log("[S5] Loading saved portal account config...");
    const accountsBytes = (await authStore.get(KEY_ACCOUNTS))!;
    const accounts      = JSON.parse(bytesToUtf8(accountsBytes));
    (apiWithIdentity as any).accounts = accounts;

    for (const id of accounts["active"] ?? []) {
      const authTokenKey = KEY_AUTH_TOKEN(id);
      if (await authStore.contains(authTokenKey)) {
        const authToken    = bytesToUtf8((await authStore.get(authTokenKey))!);
        const portalConfig = new S5Portal(portalProto, portalHost, {
          Authorization: `Bearer ${authToken}`,
        });
        (apiWithIdentity as any).accountConfigs[id] = portalConfig;
        console.log(`[S5] Restored portal account: ${id}`);
      }
    }
  } else {
    console.log("[S5] Registering on portal (first run)...");
    try {
      await apiWithIdentity.registerAccount(portalUrl, undefined);
      console.log("[S5] Registered on portal:", portalUrl.toUpperCase());
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("exist") || msg.includes("taken")) {
        console.log("[S5] Already registered — using existing account.");
      } else {
        console.warn("[S5] Portal registration warning:", err?.message ?? err);
      }
    }

    // Persist accounts + individual auth tokens for future restarts
    const accounts = (apiWithIdentity as any).accounts;
    await authStore.put(KEY_ACCOUNTS, utf8ToBytes(JSON.stringify(accounts)));
    for (const id of accounts["active"] ?? []) {
      const sdkKey = utf8ToBytes(`identity_main_account_${id}_auth_token`);
      if (await authStore.contains(sdkKey)) {
        const token = (await authStore.get(sdkKey))!;
        await authStore.put(KEY_AUTH_TOKEN(id), token);
      }
    }
    console.log("[S5] Portal accounts saved for next restart.");
  }

  console.log("[S5] Ready to archive uploads.");

  return { apiWithIdentity, identity };
}

export async function getS5Client(): Promise<S5Client> {
  if (clientInstance) return clientInstance;

  if (!initPromise) {
    initPromise = initS5()
      .then((client) => {
        clientInstance = client;
        return client;
      })
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }

  return initPromise;
}
