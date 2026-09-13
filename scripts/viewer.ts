import { parseArgs } from "node:util";
import { createViewerServer } from "../src/viewer/server.ts";

const { values } = parseArgs({ options: { port: { type: "string", default: "4310" } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535.");
const server = createViewerServer();
server.on("error", () => { console.error("Viewer could not start. Try npm run ui -- --port 4311"); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Beyond Green viewer: http://127.0.0.1:${port}\nSaved receipts only. Imports stay in your browser.`));
