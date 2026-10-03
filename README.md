# Lumen — Claude-Style AI Chat

A lightweight, high-performance AI chat web application supporting multi-provider AI (Google Gemini, OpenAI GPT, Anthropic Claude) with text and image input. It keeps conversations strictly in browser memory without database overhead.

---

## 🚀 Quick Start (Local Development)

Requires **Node.js 18+**.

1. Clone the repository and navigate into the folder:
   ```bash
   git clone https://github.com/optimus-prime-01/Lumen.git
   cd Lumen
   ```

2. Copy `.env.example` to `.env` and set your API keys:
   ```bash
   cp .env.example .env
   ```

3. Start the dev server:
   ```bash
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🌐 Deployment Instructions

### Option 1: Deploy on Render

Render hosts Lumen as a continuous Node.js Web Service.

1. **Push your repository to GitHub** (`https://github.com/optimus-prime-01/Lumen.git`).
2. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** -> **Web Service**.
3. Connect your GitHub repository (`Lumen`).
4. Configure service settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Under **Environment Variables**, add:
   - `AI_PROVIDER`: `gemini` (or `openai` / `anthropic`)
   - `GEMINI_API_KEY`: `your_actual_gemini_api_key`
   - `GEMINI_MODEL`: `gemini-3.8-flash`
6. Click **Create Web Service**. Render will automatically build and launch your application!

---

### Option 2: Deploy on Vercel

Vercel hosts Lumen using Serverless Functions and global CDN for static assets.

#### Via Vercel Web Dashboard:
1. Go to [Vercel Dashboard](https://vercel.com/new) and click **Import Project**.
2. Select your GitHub repository (`Lumen`).
3. Under **Environment Variables**, set:
   - `AI_PROVIDER` = `gemini`
   - `GEMINI_API_KEY` = `your_actual_gemini_api_key`
4. Click **Deploy**. Vercel will automatically build and deploy your app.

#### Via Vercel CLI:
```bash
npm install -g vercel
vercel login
vercel --prod
```

---

## 🔑 Environment Variables Reference

| Variable | Default / Example | Description |
| :--- | :--- | :--- |
| `AI_PROVIDER` | `gemini` | Primary AI provider (`gemini`, `openai`, `anthropic`) |
| `GEMINI_API_KEY` | - | API key from Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model ID |
| `OPENAI_API_KEY` | - | API key from OpenAI Platform |
| `OPENAI_MODEL` | `gpt-5.6-terra` | OpenAI model ID |
| `ANTHROPIC_API_KEY` | - | API key from Anthropic Console |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Anthropic model ID |
| `PORT` | `3000` | Port for standalone Node server |

---

## 🛡️ Key Features & Security

- **Zero Database / Zero Persistence**: Chats reside in browser RAM only.
- **Server-side Key Protection**: API keys are strictly kept in environment variables on the backend and are never exposed to the client.
- **Streaming Responses**: Real-time response streaming for smooth UI updates.
- **Image Input Support**: Attach up to 3 PNG/JPEG images per message (up to 8 MB per image).
