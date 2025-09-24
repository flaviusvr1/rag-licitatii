import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

console.log("🔑 OPENAI_API_KEY =", process.env.OPENAI_API_KEY?.slice(0, 15) + "...");
console.log("🔑 PINECONE_API_KEY =", process.env.PINECONE_API_KEY?.slice(0, 15) + "...");
console.log("🔑 PINECONE_INDEX =", process.env.PINECONE_INDEX);
