import "dotenv/config";
import OpenAI from "openai";
import fs from "node:fs" //Fyle system

// Accesos
const endpoint = "https://foundry14792191.services.ai.azure.com/openai/v1/";
const deployment_name = "gpt-5.4-mini";
const apiKey = process.env.apiKey;

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: apiKey
});

const imageBase64 = fs.readFileSync("factura.png").toString("base64")

const res = await openai.responses.create({
  model: deployment_name,
  instructions: "Responde siempre en español",
  input : [
    {
      role: "user",
      content: [
        { type : "input_text", text: "¿Qué dice este documento?, retorna los datos del cliente y el total de la factura" },
        { type : "input_image", image_url: `data:image/png;base64,${imageBase64}` }
      ]
    }
  ]
})

console.log(res.output_text)