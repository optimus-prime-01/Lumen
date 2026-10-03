const elements = {
  composer: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  sendButton: document.querySelector("#send-button"),
  attachButton: document.querySelector("#attach-button"),
  fileInput: document.querySelector("#file-input"),
  imageTray: document.querySelector("#image-tray"),
  messages: document.querySelector("#messages"),
  welcome: document.querySelector("#welcome"),
  chatScroll: document.querySelector("#chat-scroll"),
  newChat: document.querySelector("#new-chat"),
  chatTitle: document.querySelector("#chat-title"),
  providerLabel: document.querySelector("#provider-label"),
  statusDot: document.querySelector("#status-dot"),
  providerSelect: document.querySelector("#provider-select"),
  modelSelect: document.querySelector("#model-select"),
  providerOrb: document.querySelector("#provider-orb"),
  keyStatus: document.querySelector("#key-status"),
  themeToggle: document.querySelector("#theme-toggle"),
  toast: document.querySelector("#toast"),
  dropOverlay: document.querySelector("#drop-overlay"),
  sidebar: document.querySelector("#sidebar"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  menuButton: document.querySelector("#menu-button"),
  sidebarClose: document.querySelector("#sidebar-close"),
};

const state = {
  messages: [],
  pendingImages: [],
  streaming: false,
  controller: null,
  toastTimer: null,
  providers: [],
  provider: "",
  model: "",
  theme: "light",
};

initialize();

function initialize() {
  initializeTheme();
  bindEvents();
  updateComposer();
  checkProvider();
  elements.prompt.focus();
}

function bindEvents() {
  elements.composer.addEventListener("submit", handleSubmit);
  elements.prompt.addEventListener("input", () => {
    autoResize();
    updateComposer();
  });
  elements.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (state.streaming) return;
      if (canSend()) elements.composer.requestSubmit();
    }
  });

  elements.attachButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", (event) => addImages([...event.target.files]));
  elements.newChat.addEventListener("click", startNewChat);
  elements.themeToggle.addEventListener("click", () => {
    setTheme(state.theme === "light" ? "dark" : "light");
  });
  elements.providerSelect.addEventListener("change", () => {
    state.provider = elements.providerSelect.value;
    populateModels();
    updateProviderUi();
    updateComposer();
  });
  elements.modelSelect.addEventListener("change", () => {
    state.model = elements.modelSelect.value;
    updateProviderUi();
  });
  elements.sendButton.addEventListener("click", (event) => {
    if (!state.streaming) return;
    event.preventDefault();
    state.controller?.abort();
  });

  document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      elements.prompt.value = button.dataset.prompt || "";
      autoResize();
      updateComposer();
      elements.prompt.focus();
    });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      startNewChat();
    }
  });

  document.addEventListener("paste", (event) => {
    const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (images.length) addImages(images);
  });

  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    elements.dropOverlay.classList.add("visible");
  });
  window.addEventListener("dragover", (event) => {
    if (hasDraggedFiles(event)) event.preventDefault();
  });
  window.addEventListener("dragleave", (event) => {
    if (!hasDraggedFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) elements.dropOverlay.classList.remove("visible");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    elements.dropOverlay.classList.remove("visible");
    addImages([...event.dataTransfer.files]);
  });

  elements.menuButton.addEventListener("click", openSidebar);
  elements.sidebarClose.addEventListener("click", closeSidebar);
  elements.sidebarScrim.addEventListener("click", closeSidebar);
}

function initializeTheme() {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  const nextTheme = theme === "light" ? "dark" : "light";
  elements.themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
  elements.themeToggle.title = `Switch to ${nextTheme} mode`;
}

async function checkProvider() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    state.providers = Array.isArray(data.providers) ? data.providers : [];
    state.provider = state.providers.some((provider) => provider.id === data.defaultProvider)
      ? data.defaultProvider
      : state.providers[0]?.id || "";

    elements.providerSelect.innerHTML = state.providers
      .map((provider) => `<option value="${provider.id}">${provider.name}</option>`)
      .join("");
    elements.providerSelect.value = state.provider;
    elements.providerSelect.disabled = false;
    populateModels();
    updateProviderUi();
    updateComposer();
  } catch {
    elements.providerLabel.textContent = "Server unavailable";
    elements.statusDot.classList.add("missing");
    elements.keyStatus.textContent = "Offline";
    elements.keyStatus.classList.add("missing");
  }
}

function populateModels() {
  const provider = getSelectedProvider();
  if (!provider) return;

  elements.modelSelect.innerHTML = provider.models
    .map((model) => `<option value="${model.id}" title="${model.note}">${model.name}</option>`)
    .join("");
  state.model = provider.models.some((model) => model.id === provider.defaultModel)
    ? provider.defaultModel
    : provider.models[0]?.id || "";
  elements.modelSelect.value = state.model;
  elements.modelSelect.disabled = false;
}

function updateProviderUi() {
  const provider = getSelectedProvider();
  const model = provider?.models.find((option) => option.id === state.model);
  if (!provider || !model) return;

  elements.providerOrb.className = `provider-orb ${provider.id}`;
  elements.keyStatus.textContent = provider.configured ? "Key ready" : "Key needed";
  elements.keyStatus.classList.toggle("missing", !provider.configured);
  elements.statusDot.className = `status-dot ${provider.configured ? "ready" : "missing"}`;
  elements.providerLabel.textContent = `${provider.name} · ${model.name}${provider.configured ? "" : " · key needed"}`;
  elements.sendButton.title = provider.configured ? `Send with ${model.name}` : `Add ${provider.name} API key to .env`;
}

function getSelectedProvider() {
  return state.providers.find((provider) => provider.id === state.provider);
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.streaming || !canSend()) return;

  const content = elements.prompt.value.trim();
  const userMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content,
    images: state.pendingImages.map((image) => ({ ...image })),
  };

  state.messages.push(userMessage);
  if (state.messages.filter((message) => message.role === "user").length === 1) {
    elements.chatTitle.textContent = makeChatTitle(content, userMessage.images.length);
  }

  elements.prompt.value = "";
  state.pendingImages = [];
  elements.fileInput.value = "";
  autoResize();
  updateComposer();
  renderMessages();
  closeSidebar();

  const assistantMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    images: [],
    pending: true,
    error: false,
  };
  state.messages.push(assistantMessage);
  state.streaming = true;
  state.controller = new AbortController();
  updateComposer();
  renderMessages();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: state.provider,
        model: state.model,
        messages: state.messages
          .filter((message) => !message.pending && !message.error)
          .map(({ role, content: text, images }) => ({
            role,
            content: text,
            images: images.map(({ dataUrl, name, type }) => ({ dataUrl, name, type })),
          })),
      }),
      signal: state.controller.signal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed with status ${response.status}.`);
    }

    if (!response.body) throw new Error("The server returned an empty response.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    assistantMessage.pending = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      assistantMessage.content += decoder.decode(value, { stream: true });
      updateAssistantMessage(assistantMessage);
    }

    assistantMessage.content += decoder.decode();
    if (!assistantMessage.content.trim()) throw new Error("The model returned no text.");
  } catch (error) {
    assistantMessage.pending = false;
    if (error.name === "AbortError") {
      if (!assistantMessage.content) {
        state.messages = state.messages.filter((message) => message.id !== assistantMessage.id);
      }
    } else {
      assistantMessage.error = true;
      assistantMessage.content = error.message;
      showToast(error.message);
    }
  } finally {
    state.streaming = false;
    state.controller = null;
    updateComposer();
    renderMessages();
    elements.prompt.focus();
  }
}

function renderMessages() {
  elements.welcome.classList.toggle("hidden", state.messages.length > 0);
  elements.messages.innerHTML = state.messages.map(renderMessage).join("");

  elements.messages.querySelectorAll("[data-copy-message]").forEach((button) => {
    button.addEventListener("click", async () => {
      const message = state.messages.find((item) => item.id === button.dataset.copyMessage);
      if (!message) return;
      await navigator.clipboard.writeText(message.content);
      showToast("Copied to clipboard");
    });
  });

  elements.messages.querySelectorAll("[data-copy-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.closest(".code-block")?.querySelector("code")?.textContent;
      if (!code) return;
      await navigator.clipboard.writeText(code);
      const label = button.querySelector("span");
      if (label) label.textContent = "Copied";
      showToast("Code copied to clipboard");
      window.setTimeout(() => {
        if (label) label.textContent = "Copy code";
      }, 1600);
    });
  });

  scrollToBottom();
}

function renderMessage(message) {
  if (message.role === "user") {
    const images = message.images.length
      ? `<div class="user-images">${message.images
          .map((image) => `<img src="${image.dataUrl}" alt="${escapeAttribute(image.name || "Attached image")}" />`)
          .join("")}</div>`
      : "";
    const text = message.content ? `<div class="user-bubble">${escapeHtml(message.content)}</div>` : "";

    return `<article class="message user" id="message-${message.id}">
      <div class="user-message-content">${images}${text}</div>
    </article>`;
  }

  const body = message.pending
    ? '<div class="typing-indicator" aria-label="Lumen is thinking"><span></span><span></span><span></span></div>'
    : message.error
      ? `<p class="error-text">${escapeHtml(message.content)}</p>`
      : renderMarkdown(message.content);
  const actions = !message.pending && !message.error
    ? `<div class="message-actions">
        <button class="action-button" data-copy-message="${message.id}" aria-label="Copy response" title="Copy response">
          <svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
        </button>
      </div>`
    : "";

  return `<article class="message assistant" id="message-${message.id}">
    <div class="assistant-content">
      <div class="assistant-header">
        <span class="assistant-avatar" aria-hidden="true">
          <svg viewBox="0 0 32 32"><path d="M16 4c1.55 5.3 2.7 6.45 8 8-5.3 1.55-6.45 2.7-8 8-1.55-5.3-2.7-6.45-8-8 5.3-1.55 6.45-2.7 8-8Zm7 14c.7 2.4 1.2 2.9 3.6 3.6-2.4.7-2.9 1.2-3.6 3.6-.7-2.4-1.2-2.9-3.6-3.6 2.4-.7 2.9-1.2 3.6-3.6Z"/></svg>
        </span>
        <span>Lumen</span>
      </div>
      <div class="markdown">${body}</div>
      ${actions}
    </div>
  </article>`;
}

function updateAssistantMessage(message) {
  const container = document.querySelector(`#message-${message.id} .markdown`);
  if (!container) {
    renderMessages();
    return;
  }
  container.innerHTML = renderMarkdown(message.content);
  scrollToBottom();
}

async function addImages(files) {
  const availableSlots = 3 - state.pendingImages.length;
  if (availableSlots <= 0) {
    showToast("You can attach up to 3 images.");
    return;
  }

  const imageFiles = files.filter((file) => ["image/png", "image/jpeg"].includes(file.type));
  if (imageFiles.length !== files.length) showToast("Only PNG and JPEG images are supported.");

  for (const file of imageFiles.slice(0, availableSlots)) {
    if (file.size > 8 * 1024 * 1024) {
      showToast(`${file.name} is larger than 8 MB.`);
      continue;
    }

    const dataUrl = await readAsDataUrl(file);
    state.pendingImages.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      dataUrl,
    });
  }

  elements.fileInput.value = "";
  renderImageTray();
  updateComposer();
}

function renderImageTray() {
  elements.imageTray.classList.toggle("visible", state.pendingImages.length > 0);
  elements.imageTray.innerHTML = state.pendingImages
    .map(
      (image) => `<div class="image-preview">
        <img src="${image.dataUrl}" alt="${escapeAttribute(image.name)}" />
        <button class="image-remove" type="button" data-remove-image="${image.id}" aria-label="Remove ${escapeAttribute(image.name)}">×</button>
      </div>`,
    )
    .join("");

  elements.imageTray.querySelectorAll("[data-remove-image]").forEach((button) => {
    button.addEventListener("click", () => {
      state.pendingImages = state.pendingImages.filter((image) => image.id !== button.dataset.removeImage);
      renderImageTray();
      updateComposer();
    });
  });
}

function startNewChat() {
  if (state.streaming) state.controller?.abort();
  state.messages = [];
  state.pendingImages = [];
  elements.prompt.value = "";
  elements.fileInput.value = "";
  elements.chatTitle.textContent = "New conversation";
  renderImageTray();
  autoResize();
  updateComposer();
  renderMessages();
  closeSidebar();
  elements.prompt.focus();
}

function updateComposer() {
  const enabled = canSend();
  elements.sendButton.disabled = state.streaming ? false : !enabled;
  elements.sendButton.classList.toggle("streaming", state.streaming);
  elements.sendButton.setAttribute("aria-label", state.streaming ? "Stop response" : "Send message");
  elements.attachButton.disabled = state.streaming;
  elements.prompt.disabled = state.streaming;
  elements.providerSelect.disabled = state.streaming || state.providers.length === 0;
  elements.modelSelect.disabled = state.streaming || state.providers.length === 0;
}

function canSend() {
  return Boolean(elements.prompt.value.trim() || state.pendingImages.length) && Boolean(getSelectedProvider()?.configured);
}

function autoResize() {
  elements.prompt.style.height = "auto";
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 180)}px`;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    elements.chatScroll.scrollTop = elements.chatScroll.scrollHeight;
  });
}

function renderMarkdown(source) {
  if (!source) return "";

  const codeBlocks = [];
  let text = escapeHtml(source).replace(/```([\w+#.-]*)\n?([\s\S]*?)```/g, (_, language, code) => {
    const token = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push(
      `<div class="code-block">
        <div class="code-toolbar">
          <button class="code-copy-button" type="button" data-copy-code aria-label="Copy code">
            <svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
            <span>Copy code</span>
          </button>
          ${language ? `<div class="code-label">${language}</div>` : ""}
        </div>
        <pre><code>${code.replace(/^\n|\n$/g, "")}</code></pre>
      </div>`,
    );
    return `\n${token}\n`;
  });

  const lines = text.split("\n");
  const output = [];
  let listType = null;

  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const codeMatch = line.trim().match(/^@@CODEBLOCK(\d+)@@$/);
    if (codeMatch) {
      closeList();
      output.push(codeBlocks[Number(codeMatch[1])]);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (bullet || numbered) {
      const nextListType = bullet ? "ul" : "ol";
      if (listType !== nextListType) {
        closeList();
        output.push(`<${nextListType}>`);
        listType = nextListType;
      }
      output.push(`<li>${formatInline((bullet || numbered)[1])}</li>`);
      continue;
    }

    closeList();
    if (/^###\s+/.test(line)) output.push(`<h3>${formatInline(line.replace(/^###\s+/, ""))}</h3>`);
    else if (/^##\s+/.test(line)) output.push(`<h2>${formatInline(line.replace(/^##\s+/, ""))}</h2>`);
    else if (/^#\s+/.test(line)) output.push(`<h1>${formatInline(line.replace(/^#\s+/, ""))}</h1>`);
    else if (/^>\s?/.test(line)) output.push(`<blockquote>${formatInline(line.replace(/^>\s?/, ""))}</blockquote>`);
    else if (/^---+$/.test(line.trim())) output.push("<hr>");
    else output.push(`<p>${formatInline(line)}</p>`);
  }

  closeList();
  return output.join("");
}

function formatInline(text) {
  const inlineCode = [];
  const inlineMath = [];
  let formatted = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@INLINECODE${inlineCode.length}@@`;
    inlineCode.push(`<code>${code}</code>`);
    return token;
  });

  formatted = formatted
    .replace(/\$([^$\n]+)\$/g, (_, expression) => {
      const token = `@@INLINEMATH${inlineMath.length}@@`;
      inlineMath.push(`<span class="math-inline">${formatMath(expression)}</span>`);
      return token;
    })
    .replace(/\\\(([^\n]+?)\\\)/g, (_, expression) => {
      const token = `@@INLINEMATH${inlineMath.length}@@`;
      inlineMath.push(`<span class="math-inline">${formatMath(expression)}</span>`);
      return token;
    });

  formatted = formatted
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  inlineCode.forEach((code, index) => {
    formatted = formatted.replace(`@@INLINECODE${index}@@`, code);
  });
  inlineMath.forEach((math, index) => {
    formatted = formatted.replace(`@@INLINEMATH${index}@@`, math);
  });
  return formatted;
}

function formatMath(expression) {
  return expression
    .trim()
    .replace(/\\mathcal\{([^}]+)\}/g, "$1")
    .replace(/\\mathrm\{([^}]+)\}/g, "$1")
    .replace(/\\mathbf\{([^}]+)\}/g, "<strong>$1</strong>")
    .replace(/\\Theta/g, "Θ")
    .replace(/\\Omega/g, "Ω")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\log/g, "log")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\^\{([^}]+)\}/g, "<sup>$1</sup>")
    .replace(/\^([A-Za-z0-9+-])/g, "<sup>$1</sup>")
    .replace(/_\{([^}]+)\}/g, "<sub>$1</sub>")
    .replace(/_([A-Za-z0-9+-])/g, "<sub>$1</sub>")
    .replace(/[{}]/g, "")
    .replace(/\\,/g, " ")
    .replace(/\\ /g, " ");
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function makeChatTitle(content, imageCount) {
  const fallback = imageCount === 1 ? "Image conversation" : imageCount > 1 ? "Images conversation" : "New conversation";
  if (!content) return fallback;
  return content.length > 34 ? `${content.slice(0, 34).trim()}…` : content;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function hasDraggedFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

function openSidebar() {
  elements.sidebar.classList.add("open");
  elements.sidebarScrim.classList.add("visible");
}

function closeSidebar() {
  elements.sidebar.classList.remove("open");
  elements.sidebarScrim.classList.remove("visible");
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
