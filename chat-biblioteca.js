/*
El modelo utilizará funciones locales para responder.
La comunicación se hará de manera bidireccional.
*/

import "dotenv/config";
import OpenAI from "openai";
import readLine from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Accesos
const CONFIG = {
  endpoint: "https://foundry14792191.services.ai.azure.com/openai/v1/",
  apiKey: process.env.apiKey,
  deploymentName: "gpt-5.4-mini"
};

// Configuración del SDK
const openai = new OpenAI({
  baseURL: CONFIG.endpoint,
  apiKey: CONFIG.apiKey,
  timeout: 60000,
  maxRetries: 1
});

// USER > MODEL > APP > MODEL > USER

// Catálogo de libros
const libros = [
  {
    titulo: "JavaScript The Good Parts",
    autor: "Douglas Crockford",
    tema: "Programación",
    copias: 2
  },
  {
    titulo: "Clean Code",
    autor: "Robert Martin",
    tema: "Programación",
    copias: 1
  },
  {
    titulo: "Introducción a la base de datos",
    autor: "C. Date",
    tema: "Base de datos",
    copias: 0
  },
  {
    titulo: "Redes de computadores",
    autor: "Andrew Tanenbaum",
    tema: "Redes",
    copias: 3
  },
  {
    titulo: "Inteligencia artificial",
    autor: "Russell",
    tema: "Inteligencia Artificial",
    copias: 1
  }
];

// Normalizar textos
const normalizar = (texto) =>
  texto.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// Funciones que utilizará la IA
function buscarLibro({ consulta }) {
  const q = normalizar(consulta);

  const encontrados = libros.filter((libro) =>
    normalizar(`${libro.titulo} ${libro.autor} ${libro.tema}`).includes(q)
  );

  return encontrados.length > 0
    ? { encontrados }
    : { encontrados: [], mensaje: "No encontramos el libro" };
}

function listarDisponibles() {
  return {
    disponibles: libros.filter((libro) => libro.copias > 0)
  };
}

function prestarLibro({ titulo }) {
  const q = normalizar(titulo);

  const coincidencias = libros.filter((libro) =>
    normalizar(libro.titulo).includes(q)
  );

  if (coincidencias.length === 0) {
    return {
      exito: false,
      mensaje: "No existe un libro con este título"
    };
  }

  if (coincidencias.length > 1) {
    return {
      exito: false,
      mensaje: "Hay varios libros con ese nombre",
      opciones: coincidencias.map((libro) => libro.titulo)
    };
  }

  const libro = coincidencias[0];

  if (libro.copias === 0) {
    return {
      exito: false,
      mensaje: `No quedan copias disponibles de: ${libro.titulo}`
    };
  }

  libro.copias -= 1;

  return {
    exito: true,
    titulo: libro.titulo,
    copiasRestantes: libro.copias
  };
}

// Colección de funciones
const funciones = {
  buscarLibro,
  listarDisponibles,
  prestarLibro
};

// Descripción de funciones para el modelo
const tools = [
  {
    type: "function",
    name: "buscarLibro",
    description: "Busca libros por título, autor o tema.",
    parameters: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description: "Texto a buscar"
        }
      },
      required: ["consulta"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "listarDisponibles",
    description: "Lista los libros con copias disponibles.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "prestarLibro",
    description: "Registra un préstamo y descuenta una copia. Solo usar cuando el usuario confirme el préstamo.",
    parameters: {
      type: "object",
      properties: {
        titulo: {
          type: "string",
          description: "Título del libro a prestar"
        }
      },
      required: ["titulo"],
      additionalProperties: false
    },
    strict: true
  }
];

// Instrucciones del asistente
const INSTRUCCIONES = `
Eres el asistente de una biblioteca educativa.
Responde siempre en español, de forma amable y breve.
Usa las funciones para consultar o modificar el catálogo.
No inventes libros ni cantidades.
Si preguntan qué libros hay, usa listarDisponibles.
Si preguntan por un tema o título, usa buscarLibro.
Antes de prestar un libro, solicita confirmación.
`;

// Ciclo de conversación
let ultimaRespuestaId = null;

async function preguntar(textoUsuario) {
  let inputActual = [
    { role: "user", content: textoUsuario }
  ];

  // Máximo 5 vueltas para evitar ciclos infinitos
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const response = await openai.responses.create({
      model: CONFIG.deploymentName,
      instructions: INSTRUCCIONES,
      input: inputActual,
      tools,
      previous_response_id: ultimaRespuestaId ?? undefined,
      max_output_tokens: 1000,
      reasoning: { effort: "low" }
    });

    // Mantener la conversación
    ultimaRespuestaId = response.id;

    // Obtener las funciones solicitadas
    const llamadas = response.output.filter(
      (item) => item.type === "function_call"
    );

    // Respuesta final
    if (llamadas.length === 0) {
      return response.output_text;
    }

    // Ejecutar las funciones solicitadas
    inputActual = llamadas.map((llamada) => {
      let resultado;

      try {
        const args = JSON.parse(llamada.arguments);

        console.log(`[Función] ${llamada.name}(${JSON.stringify(args)})`);

        if (!funciones[llamada.name]) {
          throw new Error("Función no encontrada");
        }

        resultado = funciones[llamada.name](args);
      } catch (e) {
        resultado = { error: e.message };
      }

      console.log(`[Resultado] ${JSON.stringify(resultado)}`);

      return {
        type: "function_call_output",
        call_id: llamada.call_id,
        output: JSON.stringify(resultado)
      };
    });
  }

  return "No puedo completar la solicitud. Intenta nuevamente.";
}

// VERIFICAR LA FUNCIONALIDAD
const rl = readLine.createInterface({ input, output });

console.log("Asistente de biblioteca. Escribe 'salir' para terminar.");
console.log("Prueba con: ¿Qué libros tienes de programación?");

while (true) {
  const texto = await rl.question("\nTú: ");

  if (texto.trim().toLowerCase() === "salir") break;
  if (!texto.trim()) continue;

  try {
    const respuesta = await preguntar(texto);
    console.log(`\nIA: ${respuesta}`);
  } catch (e) {
    console.error("\nError:", e.message);
    if (e.status) console.error("Estado HTTP:", e.status);
  }
}

rl.close();
