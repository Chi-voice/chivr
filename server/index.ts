import express from "express";
import cors from "cors";
import archiveRouter from "./routes/archive.js";

const app = express();
const PORT = parseInt(process.env.API_PORT || "3001", 10);

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "chivr-api" });
});

app.use("/api", archiveRouter);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] API server running on port ${PORT}`);
});
