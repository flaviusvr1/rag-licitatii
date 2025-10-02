import dotenv from "dotenv";
dotenv.config({ path: ".env.local" }); 

const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error("❌ Lipseste OPENAI_API_KEY din .env.local");
  process.exit(1);
}

async function main() {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "text-embedding-3-large",  // avem index Pinecone de 3072
      input: "Acesta este un test de embedding cu OpenAI."
    })
  });

  if (!res.ok) {
    console.error("❌ HTTP", res.status, await res.text());
    process.exit(1);
  }

  const json = await res.json();
  console.log("✅ Dimensiune vector:", json.data[0].embedding.length);
  console.log("Primele valori:", json.data[0].embedding.slice(0, 5));
}

main()