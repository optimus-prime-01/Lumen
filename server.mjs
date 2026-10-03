import { createServer } from "node:http";
import { handleChat, handleHealth, serveStatic, sendJson, getProviderConfig } from "./lib/core.mjs";

const port = Number(process.env.PORT || 3000);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/\.js$/, "").replace(/\/+$/, "") || "/";

    if (request.method === "GET" && pathname === "/api/health") {
      return handleHealth(request, response);
    }

    if (request.method === "POST" && pathname === "/api/chat") {
      return handleChat(request, response);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return serveStatic(url.pathname, request.method, response);
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("Request failed:", error.message);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Something went wrong on the server." });
    } else {
      response.end();
    }
  }
});

server.listen(port, () => {
  const config = getProviderConfig();
  console.log(`Lumen is running at http://localhost:${port}`);
  console.log(`Provider: ${config.provider} · Model: ${config.model}`);
  if (!config.apiKey) {
    console.log(`Add ${config.keyName} to .env or environment variables before sending a message.`);
  }
});
