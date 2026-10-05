import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, "public");
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 3;
const MAX_TEXT_LENGTH = 30_000;

export const PROVIDER_MODELS = Object.freeze({
  anthropic: {
    name: "Claude",
    keyName: "ANTHROPIC_API_KEY",
    envModel: "ANTHROPIC_MODEL",
    models: [
      { id: "claude-opus-5", name: "Claude Opus 5", note: "Most capable" },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", note: "Balanced" },
      { id: "claude-fable-5", name: "Claude Fable 5", note: "Fast" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", note: "Balanced & capable" },
    ],
  },
});

loadEnv(join(ROOT_DIR, ".env"));

export function getDefaultProvider() {
  const requested = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  return requested in PROVIDER_MODELS ? requested : "anthropic";
}

export function getProviderCatalog() {
  return Object.entries(PROVIDER_MODELS).map(([id, definition]) => ({
    id,
    name: definition.name,
    configured: Boolean(process.env[definition.keyName]),
    defaultModel: getDefaultModel(id),
    models: definition.models,
  }));
}

export function getDefaultModel(provider) {
  const definition = PROVIDER_MODELS[provider];
  const requested = process.env[definition.envModel] || "";
  return definition.models.some((model) => model.id === requested) ? requested : definition.models[0].id;
}

export function getProviderConfig(requestedProvider, requestedModel) {
  const provider = (requestedProvider || getDefaultProvider()).toLowerCase();
  const definition = PROVIDER_MODELS[provider];
  if (!definition) throw new Error("Unsupported AI provider.");

  const model = requestedModel || getDefaultModel(provider);
  if (!definition.models.some((option) => option.id === model)) {
    throw new Error(`Unsupported model for ${definition.name}.`);
  }

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY || "";
    return {
      provider,
      apiKey,
      keyName: definition.keyName,
      model,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
    };
  }

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    return {
      provider,
      apiKey,
      keyName: definition.keyName,
      model,
      endpoint: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
  }

  const apiKey = process.env.OPENAI_API_KEY || "";
  return {
    provider,
    apiKey,
    keyName: definition.keyName,
    model,
    endpoint: "https://api.openai.com/v1/responses",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
  };
}

export function handleHealth(request, response) {
  const providers = getProviderCatalog();
  return sendJson(response, 200, {
    ok: true,
    defaultProvider: getDefaultProvider(),
    providers,
  });
}

export async function handleChat(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
    return sendJson(response, status, { error: error.message });
  }

  let config;
  try {
    config = getProviderConfig(payload.provider, payload.model);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  if (!config.apiKey) {
    return sendJson(response, 503, {
      error: `${config.keyName} is missing. Add it to environment variables on Render/Vercel.`,
    });
  }

  let messages;
  try {
    messages = validateMessages(payload.messages);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  if (messages.length === 0) {
    return sendJson(response, 400, { error: "At least one message is required." });
  }

  try {
    const upstream = await fetch(config.endpoint, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify(buildProviderPayload(config, messages)),
      signal: AbortSignal.timeout(120_000),
    });

    if (!upstream.ok) {
      const details = await upstream.text();
      const message = getUpstreamError(details, upstream.status, config.provider);
      return sendJson(response, upstream.status, { error: message });
    }

    if (!upstream.body) {
      return sendJson(response, 502, { error: "The AI provider returned an empty response." });
    }

    if (typeof response.setHeader === "function") {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.setHeader("X-Content-Type-Options", "nosniff");
      if (typeof response.status === "function") {
        response.status(200);
      } else {
        response.statusCode = 200;
      }
    } else {
      response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Content-Type-Options": "nosniff",
      });
    }

    await pipeProviderStream(upstream.body, response, config.provider);
  } catch (error) {
    if (error.name === "TimeoutError") {
      return sendJson(response, 504, { error: "The AI provider took too long to respond." });
    }

    if (error.name === "AbortError") {
      response.end();
      return;
    }

    console.error("Provider request failed:", error.message);
    if (!response.headersSent) {
      return sendJson(response, 502, { error: "Could not connect to the AI provider." });
    }
    response.end();
  }
}

function buildProviderPayload(config, messages) {
  const systemPrompt =
    "You are Lumen, a thoughtful and clear AI assistant. Be concise by default, explain carefully when useful, and use Markdown for readable answers.";

  if (config.provider === "gemini") {
    return {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [
          { text: message.content || "Please describe this image." },
          ...message.images.map((image) => ({
            inlineData: {
              mimeType: image.mediaType,
              data: image.base64,
            },
          })),
        ],
      })),
      generationConfig: {
        maxOutputTokens: 4096,
      },
    };
  }

  if (config.provider === "anthropic") {
    return {
      model: config.model,
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages: messages.map((message) => ({
        role: message.role,
        content: [
          ...message.images.map((image) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: image.base64,
            },
          })),
          { type: "text", text: message.content || "Please describe this image." },
        ],
      })),
    };
  }

  if (config.provider === "openai") {
    return {
      model: config.model,
      stream: true,
      instructions: systemPrompt,
      input: messages.map((message) => ({
        role: message.role,
        content:
          message.images.length === 0
            ? message.content
            : [
                { type: "input_text", text: message.content || "Please describe this image." },
                ...message.images.map((image) => ({
                  type: "input_image",
                  image_url: image.dataUrl,
                })),
              ],
      })),
    };
  }

  return {
    model: config.model,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((message) => ({
        role: message.role,
        content:
          message.images.length === 0
            ? message.content
            : [
                { type: "text", text: message.content || "Please describe this image." },
                ...message.images.map((image) => ({
                  type: "image_url",
                  image_url: { url: image.dataUrl },
                })),
              ],
      })),
    ],
  };
}

async function pipeProviderStream(body, response, provider) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const event = JSON.parse(data);
        const text =
          provider === "anthropic"
            ? event.type === "content_block_delta" && event.delta?.type === "text_delta"
              ? event.delta.text
              : ""
            : provider === "gemini"
              ? extractGeminiText(event)
              : event.type === "response.output_text.delta"
                ? event.delta || ""
                : "";

        if (text) response.write(text);
      } catch {
        // Ignore non-JSON keepalive events from the upstream provider.
      }
    }

    if (done) break;
  }

  response.end();
}

function extractGeminiText(event) {
  const parts = event.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

function validateMessages(input) {
  if (!Array.isArray(input)) throw new Error("Messages must be an array.");

  return input.map((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) {
      throw new Error("Each message must have a valid role.");
    }

    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (content.length > MAX_TEXT_LENGTH) {
      throw new Error(`Each message is limited to ${MAX_TEXT_LENGTH.toLocaleString()} characters.`);
    }

    const rawImages = Array.isArray(message.images) ? message.images : [];
    if (rawImages.length > MAX_IMAGES_PER_MESSAGE) {
      throw new Error(`You can attach up to ${MAX_IMAGES_PER_MESSAGE} images per message.`);
    }

    const images = rawImages.map((image) => parseImage(image?.dataUrl));
    if (!content && images.length === 0) throw new Error("A message cannot be empty.");

    return { role: message.role, content, images };
  });
}

function parseImage(dataUrl) {
  if (typeof dataUrl !== "string") throw new Error("Invalid image data.");
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("Only PNG and JPEG images are supported.");

  const base64 = match[2].replace(/\s/g, "");
  const estimatedBytes = Math.floor((base64.length * 3) / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES) throw new Error("Each image must be smaller than 8 MB.");

  return { dataUrl: `data:${match[1]};base64,${base64}`, mediaType: match[1], base64 };
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request is too large. Use smaller images.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

export async function serveStatic(pathname, method, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(method === "HEAD" ? undefined : file);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function contentTypeFor(filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  return types[extname(filePath)] || "application/octet-stream";
}

function getUpstreamError(raw, status, provider) {
  try {
    const parsed = JSON.parse(raw);
    const rawMsg = parsed.error?.message || parsed.error?.type || "";
    if (status === 404 && rawMsg.startsWith("model:")) {
      return `Model not available for your ${provider} key (${rawMsg}). Ensure your API key has active credits at console.anthropic.com.`;
    }
    if (status === 401 || status === 403) {
      return `Authentication failed for ${provider} (status ${status}). Please check your API key in environment variables.`;
    }
    return rawMsg || `${provider} returned error ${status}.`;
  } catch {
    return `${provider} returned error ${status}.`;
  }
}

export function sendJson(response, status, data) {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (typeof response.status === "function" && typeof response.json === "function") {
    return response.status(status).json(data);
  }
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
