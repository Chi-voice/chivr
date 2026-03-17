import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Polyfill WebSocket for Node.js 20 (required by @julesl23/s5js P2P layer)
if (typeof globalThis.WebSocket === "undefined") {
  const WS = require("ws");
  (globalThis as any).WebSocket = WS;
}

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import archiveRouter from "./routes/archive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const IS_PROD = process.env.NODE_ENV === "production";
const distDir = path.join(__dirname, "..", "dist");
const PORT = parseInt(process.env.PORT || (IS_PROD ? "5000" : "3001"), 10);

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "chivr-api" });
});

app.use("/api", archiveRouter);

// In production, serve the Vite-built frontend from dist/
if (IS_PROD) {
  app.use(express.static(distDir));
  // SPA fallback — all non-API routes return index.html
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] Running on port ${PORT} (${IS_PROD ? "production" : "development"})`);
});
