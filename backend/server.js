import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const salesData = JSON.parse(readFileSync(path.join(__dirname, "data", "sales.json"), "utf-8"));
const clientsData = JSON.parse(readFileSync(path.join(__dirname, "data", "clients.json"), "utf-8"));

app.use(cors());
app.use(express.json());

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 8000);
const OLLAMA_TAGS_URL = (() => {
  try {
    const parsed = new URL(OLLAMA_URL);
    return `${parsed.origin}/api/tags`;
  } catch (_error) {
    return "http://localhost:11434/api/tags";
  }
})();

const systemPrompt = `
You interpret user intent.
Return ONLY JSON.
Possible intents:
- list_overdue_clients
- sales_report
- clarification_required

For sales_report include:
- period: "last_30_days" or "last_month"
- visualization: "line_chart" or "bar_chart"

If the user asks for sales but does not specify chart type, return clarification_required asking which chart type they want.

Examples:
User: mostrar clientes inadimplentes
Response:
{
 "intent": "list_overdue_clients",
 "days_overdue": 0
}

User: mostrar vendas do ultimo mes
Response:
{
 "intent": "sales_report",
 "period": "last_month",
 "visualization": "line_chart"
}

User: mostre os dados
Response:
{
 "intent": "clarification_required",
 "question": "Voce quer ver vendas ou clientes inadimplentes?",
 "options": [
   "mostrar vendas do ultimo mes",
   "mostrar clientes inadimplentes"
 ]
}

User: mostrar vendas
Response:
{
 "intent": "clarification_required",
 "question": "Qual tipo de grafico de vendas voce quer ver?",
 "options": [
   "mostrar vendas do ultimo mes em grafico de linha",
   "mostrar vendas do ultimo mes em grafico de barras"
 ]
}
`;

function normalizeIntent(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid AI payload.");
  }

  if (!["sales_report", "list_overdue_clients", "clarification_required"].includes(payload.intent)) {
    throw new Error("Unsupported intent from AI response.");
  }

  const normalized = { intent: payload.intent };

  if (payload.intent === "sales_report") {
    const rawVisualization = String(payload.visualization || "").toLowerCase();
    let visualization = "line_chart";

    if (rawVisualization.includes("bar")) {
      visualization = "bar_chart";
    } else if (rawVisualization.includes("line") || rawVisualization.includes("linha")) {
      visualization = "line_chart";
    }

    normalized.period = payload.period || "last_30_days";
    normalized.visualization = visualization;
  }

  if (payload.intent === "list_overdue_clients") {
    const rawDays = Number(payload.days_overdue);
    normalized.days_overdue = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
  }

  if (payload.intent === "clarification_required") {
    normalized.question = payload.question || "Voce quer ver vendas ou clientes inadimplentes?";
    const options = Array.isArray(payload.options) ? payload.options : [];
    normalized.options =
      options.length > 0
        ? options.filter((option) => typeof option === "string" && option.trim())
        : ["mostrar vendas do ultimo mes", "mostrar clientes inadimplentes"];
  }

  return normalized;
}

function extractJsonObject(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty Ollama response.");
  }

  // Accept outputs wrapped in markdown and extract the first JSON object.
  const codeFenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (codeFenceMatch?.[1]) {
    return JSON.parse(codeFenceMatch[1].trim());
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Could not find JSON object in Ollama response.");
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

function extractPeriodFromText(text) {
  if (text.includes("ultimo mes") || text.includes("último mês") || text.includes("ultimo mês")) {
    return "last_month";
  }
  return "last_30_days";
}

function buildMeta(source, confidence, latencyMs, note) {
  return {
    source,
    confidence,
    latency_ms: Math.max(0, Math.round(latencyMs)),
    note: note || null
  };
}

function fallbackInterpretIntent(query) {
  const text = String(query || "").toLowerCase();
  const salesSignals = ["venda", "fatur", "receita", "graf", "relatorio", "relatório"];
  const clientsSignals = ["inadimpl", "nao pag", "não pag", "atras", "cliente"];

  const hasSalesIntent = salesSignals.some((signal) => text.includes(signal));
  const hasClientsIntent = clientsSignals.some((signal) => text.includes(signal));

  if ((hasSalesIntent && hasClientsIntent) || (!hasSalesIntent && !hasClientsIntent)) {
    return {
      intent: "clarification_required",
      question: "Nao ficou claro. Voce quer ver vendas ou clientes inadimplentes?",
      options: ["mostrar vendas do ultimo mes", "mostrar clientes inadimplentes"]
    };
  }

  if (hasClientsIntent) {
    const numberMatch = text.match(/\d+/);
    const days = numberMatch ? Number(numberMatch[0]) : 30;
    return {
      intent: "list_overdue_clients",
      days_overdue: Number.isFinite(days) && days > 0 ? days : 30
    };
  }

  const wantsBarChart =
    text.includes("barra") || text.includes("barras") || text.includes("bar chart");
  const wantsLineChart =
    text.includes("linha") || text.includes("line chart") || text.includes("linear");

  if (!wantsBarChart && !wantsLineChart) {
    return {
      intent: "clarification_required",
      question: "Qual tipo de grafico de vendas voce quer ver?",
      options: [
        "mostrar vendas do ultimo mes em grafico de linha",
        "mostrar vendas do ultimo mes em grafico de barras"
      ]
    };
  }

  return {
    intent: "sales_report",
    period: extractPeriodFromText(text),
    visualization: wantsBarChart ? "bar_chart" : "line_chart"
  };
}

async function callOllama(prompt, timeoutMs = OLLAMA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama request failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function checkOllamaReachability(timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OLLAMA_TAGS_URL, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama health check failed: ${response.status} ${errorText}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

app.post("/intent", async (req, res) => {
  const { query, context } = req.body ?? {};

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Field 'query' is required and must be a string." });
  }

  const start = Date.now();

  try {
    const contextText =
      context && typeof context === "object"
        ? `\nConversation context: ${JSON.stringify(context)}`
        : "";
    const prompt = `${systemPrompt}\nUser query: ${query}${contextText}`;

    // Ollama integration:
    // 1) Send system instructions + user query to local model
    // 2) Enforce timeout to avoid hanging requests in live demos.
    const ollamaData = await callOllama(prompt);
    const parsed = extractJsonObject(ollamaData.response);
    const normalized = normalizeIntent(parsed);
    return res.json({
      ...normalized,
      meta: buildMeta("ollama", normalized.intent === "clarification_required" ? "medium" : "high", Date.now() - start)
    });
  } catch (error) {
    console.error("Error on /intent:", error);

    // If local model is unavailable or returns invalid output, keep the demo functional.
    const fallback = fallbackInterpretIntent(query);
    return res.json({
      ...fallback,
      meta: buildMeta("fallback", "low", Date.now() - start, "Using heuristic fallback due to Ollama failure.")
    });
  }
});

app.get("/health", async (_req, res) => {
  const start = Date.now();

  try {
    await checkOllamaReachability(Math.min(OLLAMA_TIMEOUT_MS, 5000));
    return res.json({
      status: "ok",
      backend: "up",
      ollama: {
        reachable: true,
        model: OLLAMA_MODEL,
        latency_ms: Date.now() - start
      }
    });
  } catch (error) {
    return res.status(503).json({
      status: "degraded",
      backend: "up",
      ollama: {
        reachable: false,
        model: OLLAMA_MODEL,
        latency_ms: Date.now() - start,
        error: error?.message || "Failed to reach Ollama."
      }
    });
  }
});

app.get("/sales", (_req, res) => {
  res.json(salesData);
});

app.get("/clients/overdue", (req, res) => {
  const days = Number(req.query.days ?? 30);
  const minDaysOverdue = Number.isFinite(days) && days > 0 ? days : 30;

  const overdueClients = clientsData.filter((client) => client.days_overdue >= minDaysOverdue);
  res.json(overdueClients);
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
