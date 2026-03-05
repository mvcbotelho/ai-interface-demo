# AI Interface Demo

Demo fullstack para apresentar como IA interpreta linguagem natural e transforma isso em acoes estruturadas no frontend usando Ollama local.

## Estrutura

```text
ai-interface-demo
  backend
  frontend
```

## Funcionalidades

- Entrada em linguagem natural (ex.: "mostrar vendas dos ultimos 30 dias")
- Backend interpreta intencao com Ollama local e devolve JSON estruturado
- Frontend exibe metadados da interpretacao (`source`, `confidence`, `latency_ms`)
- Fluxo de clarificacao para consultas ambiguas
- Historico local das ultimas consultas com reexecucao em 1 clique
- Endpoint de saude para validar backend + Ollama
- Frontend renderiza automaticamente:
  - `sales_report` -> grafico de vendas (Recharts)
  - `list_overdue_clients` -> lista de clientes inadimplentes

## 1) Instalar Ollama

- Baixe e instale Ollama: [https://ollama.com/download](https://ollama.com/download)

## 2) Rodar modelo local

```bash
ollama run llama3
```

## 3) Instalar backend

```bash
cd backend
npm install
```

## 4) Rodar backend

1. Crie o arquivo `.env` baseado no `.env.example`
2. Confira os valores de `OLLAMA_URL`, `OLLAMA_MODEL` e `OLLAMA_TIMEOUT_MS`
3. Inicie:

```bash
npm run dev
```

Backend disponivel em: `http://localhost:3001`

## 5) Instalar frontend

Em outro terminal:

```bash
cd frontend
npm install
```

## 6) Rodar frontend

```bash
npm run dev
```

Frontend disponivel em: `http://localhost:5173`

## Endpoints do backend

- `POST /intent`
  - Body:
    ```json
    { "query": "mostrar vendas do ultimo mes" }
    ```
  - Exemplo de retorno:
    ```json
    {
      "intent": "sales_report",
      "period": "last_30_days",
      "visualization": "chart",
      "meta": {
        "source": "ollama",
        "confidence": "high",
        "latency_ms": 132
      }
    }
    ```

- `GET /sales`
- `GET /clients/overdue?days=30`
- `GET /health`

## Endpoint de saude

`GET /health` retorna o status do backend e conectividade com o Ollama.

- `200`: backend e Ollama online
- `503`: backend online, Ollama indisponivel (modo degradado)

## Dados mock

- `backend/data/sales.json`
- `backend/data/clients.json`

## Exemplos para a demo

- "mostrar vendas do ultimo mes" -> mostra grafico
- "clientes que nao pagaram" -> mostra lista de inadimplentes
- "mostre os dados" -> backend solicita clarificacao (vendas ou inadimplentes)

## Roteiro de apresentacao (sugestao)

1. Rodar `GET /health` para provar que o ambiente local esta pronto.
2. Prompt de vendas: "mostrar vendas do ultimo mes".
3. Prompt de inadimplencia: "clientes com mais de 45 dias de atraso".
4. Prompt ambiguo: "mostre os dados" para demonstrar clarificacao inteligente.
5. Mostrar reexecucao por historico e acoes sugeridas no frontend.

## Contingencia para palco

- Se o Ollama cair, o backend usa fallback heuristico e ainda responde `/intent`.
- O frontend exibe aviso de fallback sem interromper a UX da demo.
