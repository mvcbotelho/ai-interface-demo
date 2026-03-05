import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from "recharts";

const API_BASE_URL = "http://localhost:3001";
const HISTORY_STORAGE_KEY = "ai-interface-demo:query-history";
const SUGGESTED_PROMPTS = [
  "mostrar vendas do ultimo mes",
  "mostrar vendas dos ultimos 30 dias",
  "mostrar clientes inadimplentes",
  "clientes com mais de 45 dias de atraso"
];

function formatDateBR(dateValue) {
  if (typeof dateValue !== "string") {
    return dateValue;
  }

  const parts = dateValue.split("-");
  if (parts.length !== 3) {
    return dateValue;
  }

  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function describeIntent(intentData) {
  if (!intentData?.intent) return "";

  if (intentData.intent === "sales_report") {
    const periodText = intentData.period === "last_month" ? "ultimo mes" : "ultimos 30 dias";
    const vizText = intentData.visualization === "bar_chart" ? "em grafico de barras" : "em grafico de linha";
    return `Entendi: relatorio de vendas (${periodText}) ${vizText}.`;
  }

  if (intentData.intent === "list_overdue_clients") {
    return `Entendi: listar clientes com pelo menos ${intentData.days_overdue ?? 30} dias de atraso.`;
  }

  if (intentData.intent === "clarification_required") {
    return "Preciso de uma confirmacao para continuar.";
  }

  return "";
}

function quickActions(intentData) {
  if (!intentData?.intent) return [];

  if (intentData.intent === "sales_report") {
    return [
      "mostrar vendas do ultimo mes em grafico de barras",
      "mostrar vendas do ultimo mes em grafico de linha",
      "mostrar clientes inadimplentes",
      "clientes com mais de 60 dias de atraso"
    ];
  }

  if (intentData.intent === "list_overdue_clients") {
    return [
      "mostrar vendas do ultimo mes",
      "mostrar vendas dos ultimos 30 dias"
    ];
  }

  return [];
}

function App() {
  const [query, setQuery] = useState("");
  const [intentResponse, setIntentResponse] = useState(null);
  const [sales, setSales] = useState([]);
  const [overdueClients, setOverdueClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState([]);
  const [health, setHealth] = useState({ status: "checking", label: "Verificando..." });

  useEffect(() => {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHistory(parsed.slice(0, 5));
      }
    } catch (_error) {
      // Ignore localStorage parse errors and keep a clean state.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 5)));
  }, [history]);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${API_BASE_URL}/health`);
        if (!res.ok) {
          setHealth({ status: "degraded", label: "Ollama indisponivel" });
          return;
        }
        setHealth({ status: "ok", label: "Ollama online" });
      } catch (_error) {
        setHealth({ status: "degraded", label: "Sem conexao com backend" });
      }
    }

    checkHealth();
  }, []);

  const appendHistory = (value) => {
    setHistory((prev) => {
      const cleanValue = value.trim();
      if (!cleanValue) return prev;
      const next = [cleanValue, ...prev.filter((item) => item !== cleanValue)];
      return next.slice(0, 5);
    });
  };

  const runQuery = async (nextQuery, context = null) => {
    const cleanQuery = String(nextQuery || "").trim();
    if (!cleanQuery) return;

    setQuery(cleanQuery);
    setLoading(true);
    setError("");
    setNotice("");
    setIntentResponse(null);
    setSales([]);
    setOverdueClients([]);

    try {
      const intentRes = await fetch(`${API_BASE_URL}/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context ? { query: cleanQuery, context } : { query: cleanQuery })
      });

      if (!intentRes.ok) {
        throw new Error("Nao foi possivel interpretar a consulta.");
      }

      const intentData = await intentRes.json();
      setIntentResponse(intentData);
      appendHistory(cleanQuery);

      if (intentData.intent === "sales_report") {
        const salesRes = await fetch(`${API_BASE_URL}/sales`);
        if (!salesRes.ok) {
          throw new Error("Nao foi possivel carregar os dados de vendas.");
        }
        const salesData = await salesRes.json();
        setSales(salesData);
      }

      if (intentData.intent === "list_overdue_clients") {
        const days = intentData.days_overdue ?? 30;
        const clientsRes = await fetch(`${API_BASE_URL}/clients/overdue?days=${days}`);
        if (!clientsRes.ok) {
          throw new Error("Nao foi possivel carregar os clientes inadimplentes.");
        }
        const clientsData = await clientsRes.json();
        setOverdueClients(clientsData);
      }

      if (intentData.meta?.source === "fallback") {
        if (health.status === "degraded") {
          setNotice("Ollama indisponivel no momento. Resultado exibido via fallback local.");
        } else {
          setNotice("Interpretacao realizada em modo fallback local.");
        }
      }
    } catch (err) {
      setError(err.message || "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await runQuery(query);
  };

  const healthClass =
    health.status === "ok"
      ? "border-emerald-800 bg-emerald-950/60 text-emerald-300"
      : "border-amber-800 bg-amber-950/60 text-amber-300";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">AI Interface Demo</h1>
              <p className="mt-2 text-slate-400">
                Digite uma solicitacao em linguagem natural e veja a interface se adaptar automaticamente.
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-sm font-medium ${healthClass}`}>
              {health.label}
            </span>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 md:flex-row">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Ex: "mostrar vendas do ultimo mes"'
              className="h-14 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 text-lg outline-none transition focus:border-blue-500"
              required
            />
            <button
              type="submit"
              className="h-14 rounded-xl bg-blue-500 px-6 text-base font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={loading}
            >
              {loading ? "Processando..." : "Enviar"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => runQuery(prompt)}
                className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-sm text-slate-300 transition hover:border-blue-500 hover:text-blue-300"
              >
                {prompt}
              </button>
            ))}
          </div>

          {history.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Historico recente</p>
              <div className="flex flex-wrap gap-2">
                {history.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => runQuery(item)}
                    className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300"
                  >
                    Reexecutar: {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
            <h2 className="mb-3 text-xl font-semibold">Resposta Estruturada</h2>
            {intentResponse?.meta && (
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300">
                  source: {intentResponse.meta.source}
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300">
                  confidence: {intentResponse.meta.confidence}
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300">
                  latency: {intentResponse.meta.latency_ms}ms
                </span>
              </div>
            )}
            <pre className="min-h-44 overflow-auto rounded-xl bg-slate-950 p-4 text-sm text-cyan-300">
              {intentResponse ? JSON.stringify(intentResponse, null, 2) : "Aguardando entrada..."}
            </pre>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
            <h2 className="mb-3 text-xl font-semibold">Conteudo Dinamico</h2>

            {error && (
              <div className="rounded-xl border border-red-900 bg-red-950/60 p-4 text-red-300">{error}</div>
            )}

            {!error && notice && (
              <div className="rounded-xl border border-amber-900 bg-amber-950/50 p-4 text-amber-300">{notice}</div>
            )}

            {!error && loading && (
              <div className="space-y-3 rounded-xl bg-slate-950 p-4">
                <p className="text-sm text-slate-400">Interpretando intencao...</p>
                <div className="h-5 animate-pulse rounded bg-slate-800" />
                <div className="h-5 w-5/6 animate-pulse rounded bg-slate-800" />
                <div className="h-40 animate-pulse rounded bg-slate-900" />
              </div>
            )}

            {!error && !intentResponse && (
              <p className="rounded-xl bg-slate-950 p-4 text-slate-400">
                Envie uma consulta para ver o resultado renderizado.
              </p>
            )}

            {!error && intentResponse && (
              <div className="mb-3 rounded-xl border border-blue-900 bg-blue-950/40 p-3 text-sm text-blue-200">
                {describeIntent(intentResponse)}
              </div>
            )}

            {!error && intentResponse?.intent === "clarification_required" && (
              <div className="rounded-xl bg-slate-950 p-4">
                <h3 className="mb-2 text-base font-medium text-slate-200">{intentResponse.question}</h3>
                <div className="flex flex-wrap gap-2">
                  {(intentResponse.options || []).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        runQuery(option, {
                          reason: "clarification_answer",
                          original_query: query,
                          question: intentResponse.question
                        })
                      }
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!error && intentResponse?.intent === "sales_report" && (
              <div className="rounded-xl bg-slate-950 p-4">
                <h3 className="mb-4 text-sm font-medium text-slate-400">
                  Grafico de Vendas ({intentResponse.visualization === "bar_chart" ? "Barras" : "Linha"})
                </h3>
                <div className="h-72 w-full">
                  {intentResponse.visualization === "bar_chart" ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sales}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" stroke="#94a3b8" tickFormatter={formatDateBR} />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#0f172a",
                            border: "1px solid #334155",
                            borderRadius: "8px"
                          }}
                          labelStyle={{ color: "#e2e8f0" }}
                          itemStyle={{ color: "#60a5fa" }}
                          cursor={{ fill: "#1e293b", opacity: 0.35 }}
                          labelFormatter={formatDateBR}
                        />
                        <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sales}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" stroke="#94a3b8" tickFormatter={formatDateBR} />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#0f172a",
                            border: "1px solid #334155",
                            borderRadius: "8px"
                          }}
                          labelStyle={{ color: "#e2e8f0" }}
                          itemStyle={{ color: "#60a5fa" }}
                          cursor={{ stroke: "#64748b", strokeWidth: 1 }}
                          labelFormatter={formatDateBR}
                        />
                        <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )}

            {!error && intentResponse?.intent === "list_overdue_clients" && (
              <div className="rounded-xl bg-slate-950 p-4">
                <h3 className="mb-4 text-sm font-medium text-slate-400">Clientes Inadimplentes</h3>
                {overdueClients.length === 0 ? (
                  <p className="text-slate-400">Nenhum cliente encontrado.</p>
                ) : (
                  <ul className="space-y-3">
                    {overdueClients.map((client) => (
                      <li
                        key={client.name}
                        className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
                      >
                        <span className="font-medium">{client.name}</span>
                        <span className="text-sm text-amber-300">{client.days_overdue} dias em atraso</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {!error && intentResponse && intentResponse.intent !== "clarification_required" && (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Acoes sugeridas</p>
                <div className="flex flex-wrap gap-2">
                  {quickActions(intentResponse).map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => runQuery(action)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}

export default App;
