# WebMCP Demo: Music Composer

This project is a functional demonstration of the [WebMCP Protocol](https://webmcp.link/), illustrating how AI agents can interact with local browser contexts (tools) to achieve complex workflows autonomously.

You can try the live demo for free at: **[https://music.leanmcp.live](https://music.leanmcp.live)**  
*(Note: You must open this link in **[Google Chrome Canary](https://www.google.com/chrome/canary/)** and enable the WebMCP flag in `chrome://flags` for the WebMCP features to work best, otherwise, it'll use a polyfill.)*

## What is WebMCP?

WebMCP (Web Model Context Protocol) is PENDING standard allowing web applications to register "tools" directly with the browser or a connected AI agent. By natively exposing the application's capabilities, an AI can introspect the available tools and intelligently execute tasks. In this specific demo, the agent orchestrates a web-based audio sequencer using nothing but WebMCP tool calls.

To read the official specification, visit [webmcp.link](https://webmcp.link/).

## Local Setup

To run this protocol demonstration locally, you will need a LeanMCP API key and Google Chrome Canary.

### 1. Requirements

- [Node.js](https://nodejs.org/) installed on your machine.
- [Google Chrome Canary](https://www.google.com/chrome/canary/). Experimental WebMCP features are best tested on the bleeding-edge browser.
- A **LeanMCP API Token**. Get yours from the [LeanMCP API Keys dashboard](https://app.leanmcp.com/api-keys).
- **Adequate Credits** on your LeanMCP account. Manage your billing [here](https://app.leanmcp.com/billing).

### 2. Environment Variables

Navigate to this directory (`webmcp-react`). Copy the example environment file to configure your credentials:

```bash
cp .env.example .env
```

Edit `.env` and assign your actual API token:

```env
VITE_GATEWAY_API_KEY=your_actual_leanmcp_api_token_here
```

### 3. Installation & Running

Install the required npm dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

### 4. Experiencing the Protocol

1. Open **Google Chrome Canary**.
2. Navigate to `chrome://flags` and enable the **WebMCP** experimental feature. Relaunch the browser if prompted.
3. Navigate to the `localhost` URL provided by the Vite server (typically `http://localhost:5173`).
4. Use the interface to initiate an agent run. You'll observe the underlying WebMCP runtime expose the UI's capabilities as tools to an LLM, which autonomously handles the workflow and invokes operations back onto the page.
