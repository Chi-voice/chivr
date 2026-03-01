import { S5 } from "@julesl23/s5js";

let s5Instance: S5 | null = null;
let initPromise: Promise<S5> | null = null;

async function initS5(): Promise<S5> {
  const seedPhrase = process.env.S5_SEED_PHRASE;
  const portalUrl = process.env.S5_PORTAL_URL;
  const initialPeersRaw = process.env.S5_INITIAL_PEERS;

  if (!seedPhrase) throw new Error("S5_SEED_PHRASE is not configured");
  if (!portalUrl) throw new Error("S5_PORTAL_URL is not configured");

  const initialPeers = initialPeersRaw
    ? initialPeersRaw.split(",").map((p) => p.trim()).filter(Boolean)
    : ["wss://z2DWuPbL5pweybXnEB618pMnV58ECj2VPDNfVGm3tFqBvjF@s5.ninja/s5/p2p"];

  console.log("[S5] Initialising S5 client...");
  const s5 = await S5.create({ initialPeers });

  await s5.recoverIdentityFromSeedPhrase(seedPhrase);

  try {
    await s5.registerOnNewPortal(portalUrl);
    console.log("[S5] Registered on portal:", portalUrl);
  } catch (err: any) {
    if (
      err?.message?.toLowerCase().includes("already") ||
      err?.message?.toLowerCase().includes("exists")
    ) {
      console.log("[S5] Already registered on portal, continuing.");
    } else {
      throw err;
    }
  }

  await s5.fs.ensureIdentityInitialized();
  console.log("[S5] Identity initialised. Client ready.");
  return s5;
}

export async function getS5Client(): Promise<S5> {
  if (s5Instance) return s5Instance;

  if (!initPromise) {
    initPromise = initS5()
      .then((s5) => {
        s5Instance = s5;
        return s5;
      })
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }

  return initPromise;
}
