import fs from "fs";
import { splitMarkdown } from "../lib/split.js";

const text = fs.readFileSync("storage/markdown/Raport de expertiza tehnica - scanat.md", "utf-8");
const chunks = splitMarkdown(text, 1000, 200);

console.log("Total chunks:", chunks.length);
console.log("Primul chunk:\n", chunks[0]);
