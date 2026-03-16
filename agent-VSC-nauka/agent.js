import { createAgent, Tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import readline from "readline";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const localEnvPath = path.join(__dirname, ".env");
const rootEnvPath = path.join(__dirname, "..", ".env");

dotenv.config({ path: rootEnvPath });
dotenv.config({ path: localEnvPath, override: true });

if (process.platform === "win32") {
  try {
    const winCA = require("win-ca");
    if (typeof winCA?.inject === "function") {
      winCA.inject("+");
    } else if (typeof winCA === "function") {
      winCA();
    }
  } catch (error) {
    console.warn("Nie udalo sie zaladowac certyfikatow systemowych Windows:", error?.message || error);
  }
}

const lessonsDir = path.join(__dirname, "meterials.lessons");

const resolveProvider = () => {
  const requestedProvider = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (requestedProvider === "openrouter") {
    return "openrouter";
  }

  if (requestedProvider === "openai") {
    return "openai";
  }

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return "openrouter";
  }

  return "openai";
};

const resolveModelName = (provider) => {
  const configuredModel = (
    process.env.OPENROUTER_MODEL
    ?? process.env.OPENAI_MODEL
    ?? process.env.MODEL
    ?? ""
  ).trim();

  if (configuredModel) {
    if (provider === "openrouter" && configuredModel.startsWith("gpt-") && !configuredModel.includes("/")) {
      return `openai/${configuredModel}`;
    }

    return configuredModel;
  }

  return provider === "openrouter" ? "openai/gpt-4o-mini" : "gpt-4o-mini";
};

const resolveOpenRouterBaseUrl = () => {
  const configuredBaseUrl = process.env.OPENROUTER_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return "https://openrouter.ai/api/v1";
  }

  if (configuredBaseUrl === "https://openrouter.ai/v1") {
    return "https://openrouter.ai/api/v1";
  }

  return configuredBaseUrl;
};

// Narzędzie do czytania materiałów
class ReadMaterialTool extends Tool {
  name = "read_material";
  description = "Czyta zawartość pliku materiału edukacyjnego. Input: nazwa pliku (np. s01e05-zarzadzanie...)";

  async _call(filename) {
    const filepath = path.join(lessonsDir, filename);
    try {
      const content = fs.readFileSync(filepath, "utf-8");
      return content;
    } catch (error) {
      return `Nie mogę otworzyć pliku: ${filename}`;
    }
  }
}

// Narzędzie do listowania materiałów
class ListMaterialsTool extends Tool {
  name = "list_materials";
  description = "Wyświetla dostępne materiały do nauki";

  async _call() {
    const files = fs.readdirSync(lessonsDir);
    return "Dostępne materiały:\n" + files.join("\n");
  }
}

const findLatestAiMessage = (messages) => (messages ?? [])
  .slice()
  .reverse()
  .find((message) => {
    if (typeof message?._getType === "function") {
      return message._getType() === "ai";
    }

    return message?.role === "ai" || message?.role === "assistant";
  });

const extractMessageText = (message) => {
  if (!message) {
    return "(Brak odpowiedzi)";
  }

  if (typeof message.text === "string" && message.text.trim()) {
    return message.text;
  }

  if (typeof message.content === "string" && message.content.trim()) {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part?.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("\n")
      .trim() || "(Brak odpowiedzi)";
  }

  return "(Brak odpowiedzi)";
};

async function initializeAgent() {
  const provider = resolveProvider();
  const apiKey = provider === "openrouter"
    ? process.env.OPENROUTER_API_KEY?.trim()
    : process.env.OPENAI_API_KEY?.trim();
  const modelName = resolveModelName(provider);
  const baseURL = provider === "openrouter"
    ? resolveOpenRouterBaseUrl()
    : undefined;
  const defaultHeaders = provider === "openrouter"
    ? {
        ...(process.env.OPENROUTER_HTTP_REFERER?.trim()
          ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER.trim() }
          : {}),
        ...(process.env.OPENROUTER_APP_NAME?.trim()
          ? { "X-Title": process.env.OPENROUTER_APP_NAME.trim() }
          : {}),
      }
    : undefined;

  if (!apiKey) {
    throw new Error(
      provider === "openrouter"
        ? "Brak OPENROUTER_API_KEY. Ustaw klucz w agent-nauka-z-kursu/.env albo w głównym .env repo."
        : "Brak OPENAI_API_KEY. Ustaw klucz w agent-nauka-z-kursu/.env albo w głównym .env repo."
    );
  }

  if (!fs.existsSync(lessonsDir)) {
    throw new Error(`Nie znaleziono katalogu z materiałami: ${lessonsDir}`);
  }

  console.log("Using API Key:", apiKey ? apiKey.substring(0, 10) + "..." : "none");
  console.log("Using provider:", provider);
  console.log("Using baseURL:", baseURL ?? "default OpenAI endpoint");
  console.log("Using model:", modelName);

  const model = new ChatOpenAI({
    model: modelName,
    apiKey: apiKey,
    temperature: 0,
    configuration: {
      ...(baseURL ? { baseURL } : {}),
      ...(defaultHeaders ? { defaultHeaders } : {}),
    },
  });

  const tools = [new ReadMaterialTool(), new ListMaterialsTool()];

  const agent = createAgent({
    model,
    tools,
    systemPrompt: "Jesteś pomocnym agentem do nauki. Używaj narzędzi, aby odpowiadać na pytania o materiały edukacyjne. Najpierw sprawdź dostępne materiały, jeśli użytkownik pyta o nie.",
  });

  return agent;
}

// Główna pętla
async function main() {
  const agent = await initializeAgent();

  console.log("Agent do nauki gotow.");
  console.log('Wpisz pytanie lub "exit" aby wyjsc\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question("Ty: ", async (input) => {
      if (input.toLowerCase() === "exit") {
        console.log("Do widzenia!");
        rl.close();
        return;
      }

      try {
        console.log("Agent mysli...");

        const result = await agent.invoke({
          messages: [{ role: "human", content: input }],
        });

        console.log("Result:", result); // Debug

        const aiMessage = findLatestAiMessage(result.messages);
        const responseText = extractMessageText(aiMessage);
        console.log(`\nAgent: ${responseText}\n`);
      } catch (error) {
        console.error("Blad:", error?.message || error || "Nieznany blad");
        console.error("Full error:", error); // Debug
      }

      askQuestion();
    });
  };

  askQuestion();
}


async function testAgent() {
  try {
    const agent = await initializeAgent();
    console.log("Testuje agenta z pytaniem: 'Jakie materialy mam dostepne?'");

    const result = await agent.invoke({
      messages: [{ role: "human", content: "Jakie materiały mam dostępne?" }],
    });

    console.log("Result:", result); // Debug

    const aiMessage = findLatestAiMessage(result.messages);
    const responseText = extractMessageText(aiMessage);
    console.log(`\nAgent: ${responseText}\n`);
  } catch (error) {
    console.error("Blad podczas testu:", error?.message || error || "Nieznany blad");
    if (error?.cause?.cause?.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
      console.error("Wskazowka: Node nie ufa certyfikatowi TLS w tym systemie. Agent probuje zaladowac Windows CA przez win-ca, ale jesli blad pozostaje, uruchom terminal z Node 24 i sprawdz proxy/antywirusa przechwytujacego HTTPS.");
    }
    console.error("Full error:", error); // Debug
  }
}

if (process.argv.includes("--test")) {
  await testAgent();
} else {
  await main();
}
