import { ChatOpenAI } from "@langchain/openai";
import { Tool } from "@langchain/core/tools";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import readline from "readline";
import OpenAI from "openai";


dotenv.config();

// Narzędzie do czytania materiałów
class ReadMaterialTool extends Tool {
  name = "read_material";
  description = "Czyta zawartość pliku materiału edukacyjnego. Input: nazwa pliku (np. s01e05-zarzadzanie...)";

  async _call(filename) {
    const filepath = path.join("./meterials.lessons", filename);
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
    const files = fs.readdirSync("./meterials.lessons");
    return "Dostępne materiały:\n" + files.join("\n");
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

  const tools = [new ReadMaterialTool(), new ListMaterialsTool()];

  const agent = await createOpenAIAgent({
    llm: model,
    tools,
    prompt: "Jesteś pomocnym agentem do nauki. Używaj narzędzi, aby odpowiadać na pytania o materiały edukacyjne. Najpierw sprawdź dostępne materiały, jeśli użytkownik pyta o nie.",
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

  console.log("🤖 Agent do nauki gotów!");
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

        console.log("Result:", result); // Debug

        const responseText = result.output;
        console.log(`\nAgent: ${responseText}\n`);
      } catch (error) {
        console.error("❌ Błąd:", error?.message || error || "Nieznany błąd");
        console.error("Full error:", error); // Debug
      }

      askQuestion();
    });
  };

  askQuestion();
}


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

testAgent();
