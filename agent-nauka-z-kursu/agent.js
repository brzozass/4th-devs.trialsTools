import { ChatOpenAI } from "@langchain/openai";
import { Tool } from "@langchain/core/tools";
import { createOpenAIAgent } from "@langchain/experimental/agents";
import { AgentExecutor } from "@langchain/agents";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import readline from "readline";
import OpenAI from "openai";

dotenv.config();

// Pamięć konwersacji (prosta struktura w pamięci)
let conversationMemory = {
  readMaterials: new Set(), // Zbiór przeczytanych materiałów
  progress: {}, // Postęp nauki (np. { "s01e03": "podsumowane" })
};

// Narzędzie do czytania materiałów
class ReadMaterialTool extends Tool {
  name = "read_material";
  description = "Czyta zawartość pliku materiału edukacyjnego. Input: nazwa pliku (np. s01e05-zarzadzanie-jawnymi-oraz-niejawnymi-limitami-modeli-1773377197.md)";

  async _call(filename) {
    const filepath = path.join("./meterials.lessons", filename);
    try {
      const content = fs.readFileSync(filepath, "utf-8");
      conversationMemory.readMaterials.add(filename); // Dodaj do pamięci
      return content;
    } catch (error) {
      return `Nie mogę otworzyć pliku: ${filename}. Sprawdź nazwę pliku.`;
    }
  }
}

// Narzędzie do listowania materiałów
class ListMaterialsTool extends Tool {
  name = "list_materials";
  description = "Wyświetla dostępne materiały do nauki i zaznacza przeczytane";

  async _call() {
    const files = fs.readdirSync("./meterials.lessons");
    const markedFiles = files.map(file => 
      conversationMemory.readMaterials.has(file) ? `[PRZECZYTANE] ${file}` : file
    );
    return "Dostępne materiały:\n" + markedFiles.join("\n");
  }
}

// Nowe narzędzie: Podsumowywanie lekcji
class SummarizeMaterialTool extends Tool {
  name = "summarize_material";
  description = "Podsumowuje kluczowe punkty z lekcji. Input: nazwa pliku";

  async _call(filename) {
    const filepath = path.join("./meterials.lessons", filename);
    try {
      const content = fs.readFileSync(filepath, "utf-8");
      // Proste podsumowanie: wyciągnij nagłówki i pierwsze zdania
      const lines = content.split('\n');
      const summary = lines.filter(line => line.startsWith('#') || line.startsWith('##')).slice(0, 10).join('\n');
      conversationMemory.progress[filename] = "podsumowane";
      return `Podsumowanie lekcji ${filename}:\n${summary}`;
    } catch (error) {
      return `Błąd podczas podsumowywania: ${error.message}`;
    }
  }
}

// Nowe narzędzie: Pomoc w zadaniach
class HelpWithTaskTool extends Tool {
  name = "help_with_task";
  description = "Czyta instrukcje zadania z końca pliku i generuje wskazówki lub kod. Input: nazwa pliku";

  async _call(filename) {
    const filepath = path.join("./meterials.lessons", filename);
    try {
      const content = fs.readFileSync(filepath, "utf-8");
      // Znajdź sekcję zadania (zakładamy, że zaczyna się od "## Zadanie")
      const taskIndex = content.indexOf('## Zadanie');
      if (taskIndex === -1) return "Brak zadania w tym pliku.";
      const taskContent = content.slice(taskIndex);
      // Tutaj można dodać logikę do generowania kodu/wskazówek, np. wywołanie AI
      return `Instrukcje zadania z ${filename}:\n${taskContent}\n\nWskazówka: Skorzystaj z narzędzi AI do generowania kodu dla tego zadania.`;
    } catch (error) {
      return `Błąd podczas czytania zadania: ${error.message}`;
    }
  }
}

// Nowe narzędzie: Sprawdzanie postępów
class CheckProgressTool extends Tool {
  name = "check_progress";
  description = "Sprawdza postęp nauki na podstawie przeczytanych materiałów";

  async _call() {
    const readCount = conversationMemory.readMaterials.size;
    const totalFiles = fs.readdirSync("./meterials.lessons").length;
    const progressList = Object.entries(conversationMemory.progress).map(([file, status]) => `${file}: ${status}`).join('\n');
    return `Przeczytane materiały: ${readCount}/${totalFiles}\nPostęp:\n${progressList}`;
  }
}

async function initializeAgent() {
  const provider = process.env.AI_PROVIDER ?? "openai";
  const apiKey = provider === "openrouter" 
    ? process.env.OPENROUTER_API_KEY 
    : process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;
  const baseURL = provider === "openrouter" 
    ? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/v1"
    : undefined;
  const modelName = provider === "openrouter" 
    ? (process.env.OPENROUTER_MODEL ?? "gpt-4-turbo")
    : "gpt-4-turbo";

  console.log("Using provider:", provider);
  console.log("Using API Key:", apiKey ? apiKey.substring(0, 10) + "..." : "none");
  console.log("Using baseURL:", baseURL || "default");
  console.log("Using model:", modelName);

  let model;
  if (provider === "openrouter") {
    model = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://your-site.example",
        "X-Title": process.env.OPENROUTER_APP_NAME || "AI_devs_examples",
      },
    });
  } else {
    model = new ChatOpenAI({
      apiKey: apiKey,
      modelName: modelName,
    });
  }

  const tools = [
    new ReadMaterialTool(), 
    new ListMaterialsTool(), 
    new SummarizeMaterialTool(), 
    new HelpWithTaskTool(), 
    new CheckProgressTool()
  ];

  const agent = await createOpenAIAgent({
    llm: model,
    tools,
    prompt: `Jesteś doświadczonym nauczycielem i tutorem do nauki z kursu AI_Devs4. Twoim celem jest pomóc użytkownikowi ogarnąć materiały edukacyjne z folderu materials.lessons.

Zasady działania:
- Aktywnie analizuj materiały: podsumowuj lekcje, wyciągaj kluczowe punkty, wyjaśniaj trudne koncepcje.
- Pomagaj w zadaniach: Czytaj instrukcje zadań na końcu plików i generuj wskazówki, kod lub wyjaśnienia.
- Śledź postęp: Pamiętaj przeczytane materiały i postęp nauki.
- Bądź proaktywny: Jeśli użytkownik pyta o naukę, najpierw sprawdź dostępne materiały i zaproponuj plan.
- Używaj narzędzi: Zawsze korzystaj z narzędzi do czytania, podsumowywania itp., zamiast zgadywać.

Rozpocznij od sprawdzenia dostępnych materiałów i zaproponuj plan nauki.`,
  });

  const executor = new AgentExecutor({
    agent,
    tools,
  });

  return executor;
}

// Główna pętla
async function main() {
  const agent = await initializeAgent();

  console.log("🤖 Agent do nauki gotów! Pomogę Ci ogarnąć materiały z kursu.");
  console.log('Wpisz pytanie lub "exit" aby wyjść\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question("Ty: ", async (input) => {
      if (input.toLowerCase() === "exit") {
        console.log("Do widzenia! 👋");
        rl.close();
        return;
      }

      try {
        console.log("⏳ Agent myśli...");

        const result = await agent.call({
          input: input,
        });

        const responseText = result.output;
        console.log(`\nAgent: ${responseText}\n`);
      } catch (error) {
        console.error("❌ Błąd:", error?.message || error || "Nieznany błąd");
      }

      askQuestion();
    });
  };

  askQuestion();
}

// Test function (bez zmian)
async function testAgent() {
  try {
    const provider = process.env.AI_PROVIDER ?? "openai";
    const apiKey = provider === "openrouter" 
      ? process.env.OPENROUTER_API_KEY 
      : process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;
    const baseURL = provider === "openrouter" 
      ? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/v1"
      : undefined;
    const modelName = provider === "openrouter" 
      ? (process.env.OPENROUTER_MODEL ?? "gpt-3.5-turbo")
      : "gpt-4-turbo";

    console.log("Testing with provider:", provider);
    console.log("API Key:", apiKey ? apiKey.substring(0, 10) + "..." : "none");
    console.log("baseURL:", baseURL);
    console.log("model:", modelName);

    if (provider === "openrouter") {
      const client = new OpenAI({
        apiKey: apiKey,
        baseURL: baseURL,
        defaultHeaders: {
          "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://your-site.example",
          "X-Title": process.env.OPENROUTER_APP_NAME || "AI_devs_examples",
        },
      });

      const response = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: "user", content: "Jakie materiały mam dostępne?" }],
      });

      console.log("Full response:", JSON.stringify(response, null, 2));
      console.log("Response:", response.choices[0].message.content);
    } else {
      const model = new ChatOpenAI({
        apiKey: apiKey,
        modelName: modelName,
      });

      const response = await model.invoke([{ role: "user", content: "Jakie materiały mam dostępne?" }]);
      console.log("Response:", response.content);
    }
  } catch (error) {
    console.error("❌ Błąd podczas testu:", error?.message || error || "Nieznany błąd");
    console.error("Full error:", error);
  }
}

main().catch(console.error);
