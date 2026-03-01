import {
  S5Node,
  S5UserIdentity,
  JSCryptoImplementation,
} from "@julesl23/s5js";
import { S5APIWithIdentity } from "@julesl23/s5js/dist/src/identity/api.js";
import { FS5 } from "@julesl23/s5js/dist/src/fs/fs5.js";
import { utf8ToBytes } from "@noble/ciphers/utils";
import { NodeKvStore } from "./nodeKvStore.js";

export interface S5Client {
  fs: FS5;
  identity: S5UserIdentity;
}

let clientInstance: S5Client | null = null;
let initPromise: Promise<S5Client> | null = null;

async function initS5(): Promise<S5Client> {
  const seedPhrase = process.env.S5_SEED_PHRASE;
  const portalUrl = process.env.S5_PORTAL_URL;
  const initialPeersRaw = process.env.S5_INITIAL_PEERS;

  if (!seedPhrase) throw new Error("S5_SEED_PHRASE is not configured");
  if (!portalUrl) throw new Error("S5_PORTAL_URL is not configured");

  const initialPeers = initialPeersRaw
    ? initialPeersRaw.split(",").map((p) => p.trim()).filter(Boolean)
    : ["wss://z2DWuPbL5pweybXnEB618pMnV58ECj2VPDNfVGm3tFqBvjF@s5.ninja/s5/p2p"];

  console.log("[S5] Initialising S5 node...");

  const crypto = new JSCryptoImplementation();
  const node = new S5Node(crypto);

  await node.init((name: string) => NodeKvStore.open(name));

  for (const uri of initialPeers) {
    node.p2p.connectToNode(uri);
  }

  await node.ensureInitialized();
  console.log("[S5] Node connected to network.");

  const authStore = NodeKvStore.open("auth");
  const identityKey = utf8ToBytes("identity_main");

  let identity: S5UserIdentity;

  if (await authStore.contains(identityKey)) {
    console.log("[S5] Loading existing identity...");
    const packed = await authStore.get(identityKey);
    identity = await S5UserIdentity.unpack(packed!);
  } else {
    console.log("[S5] Recovering identity from seed phrase...");
    identity = await S5UserIdentity.fromSeedPhrase(seedPhrase, crypto);
    await authStore.put(identityKey, identity.pack());
  }

  const apiWithIdentity = new S5APIWithIdentity(node, identity, authStore);

  try {
    await apiWithIdentity.registerAccount(portalUrl, undefined);
    console.log("[S5] Registered / logged in on portal:", portalUrl);
  } catch (err: any) {
    const msg = (err?.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("exist") || msg.includes("taken") || msg.includes("409") || msg.includes("400")) {
      console.log("[S5] Already registered on portal, proceeding.");
    } else {
      console.warn("[S5] Portal registration warning (non-fatal):", err?.message);
    }
  }

  await apiWithIdentity.initStorageServices();

  const fs = new FS5(apiWithIdentity, identity);
  await fs.ensureIdentityInitialized();
  console.log("[S5] Identity and filesystem ready.");

  return { fs, identity };
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
