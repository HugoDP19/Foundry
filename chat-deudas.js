import "dotenv/config";
import OpenAI from "openai";
import readLine from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Accesos
const CONFIG = {
  endpoint: process.env.endpoint,
  apiKey: process.env.apiKey,
  deploymentName: process.env.deployment_name
};

const openai = CONFIG.apiKey && new OpenAI({
  baseURL: CONFIG.endpoint,
  apiKey: CONFIG.apiKey
});

// Clientes de la tienda. El saldo se guarda en céntimos: 15000 equivale a S/ 150.00.
const clientes = [
  { dni: process.env.DNI_HUGO || "12345678", nombre: "Hugo", saldo: 15000 },
  { dni: "87654321", nombre: "Luis", saldo: 890 }
];

function soles(centimos) {
  return "S/ " + (centimos / 100).toFixed(2);
}

// Convierte "quiero pagar S/.85" o "85 soles" en "85".
function leerMonto(texto) {
  return texto.toLowerCase()
    .replace(/^(quiero\s+pagar|pagar|pago)\s+/, "")
    .replace(/^s\/\.?\s*/, "")
    .replace(/\s+m[aá]s$/, "")
    .replace(/\s+sol(es)?$/, "")
    .replace(",", ".");
}

// Funciones locales
function consultarDeuda(cliente) {
  if (cliente.saldo === 0) return "No tienes deuda pendiente.";
  return "Tu deuda actual es " + soles(cliente.saldo) + ".";
}

function pagarDeuda(cliente, texto) {
  if (!cliente) return "El cliente no existe.";
  if (cliente.saldo === 0) return "No tienes deuda pendiente.";
  if (!texto) return "Escribe el monto que deseas pagar.";

  const monto = leerMonto(texto);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(monto)) {
    return "Pago rechazado. Ingresa un monto positivo con hasta dos decimales.";
  }

  const pago = Math.round(Number(monto) * 100);
  if (pago === 0) return "El pago debe ser mayor que cero.";
  if (pago > cliente.saldo) return "El pago supera tu deuda de " + soles(cliente.saldo) + ".";

  cliente.saldo -= pago;
  return "Pago registrado: " + soles(pago) + ". Saldo pendiente: " + soles(cliente.saldo) + ".";
}

// Descripción de las funciones para el modelo. El cliente se identifica en la consola.
const sinParametros = { type: "object", properties: {}, additionalProperties: false, required: [] };
const tools = [
  { type: "function", name: "consultarDeuda", description: "Consultar el saldo.", parameters: sinParametros },
  { type: "function", name: "pagarDeuda", description: "Iniciar un pago.", parameters: sinParametros }
];

const INSTRUCCIONES = "Elige la función que solicita el cliente. Si la consulta es ambigua, ajena al tema o solo pregunta cómo pagar, no elijas una función.";

async function preguntar(texto) {
  const respuesta = await openai.responses.create({
    model: CONFIG.deploymentName,
    instructions: INSTRUCCIONES,
    input: texto,
    tools,
    parallel_tool_calls: false,
    reasoning: { effort: "low" },
    max_output_tokens: 256
  });

  for (const item of respuesta.output) {
    if (item.type === "function_call") return item.name;
  }
  return "";
}

// Conversación en la consola
const rl = readLine.createInterface({ input, output });

const menu = "1. Consultar mi deuda\n2. Pagar mi deuda\n3. Salir";

async function leer(pregunta) {
  const respuesta = await rl.question(pregunta);
  return respuesta.trim().toLowerCase();
}

async function identificarCliente() {
  while (true) {
    const dni = await leer("Ingresa tu DNI: ");
    if (dni === "salir") return;
    if (!/^\d{8}$/.test(dni)) {
      console.log("El DNI debe tener exactamente 8 dígitos.");
      continue;
    }
    const cliente = clientes.find(persona => persona.dni === dni);
    if (cliente) return cliente;
    console.log("DNI no registrado. Inténtalo nuevamente.");
  }
}

async function preguntarOtroPago() {
  while (true) {
    const respuesta = await leer("¿Quieres hacer otro pago? (1: Sí, 2: No y volver al menú, 3: Salir): ");
    if (["1", "sí", "si", "s"].includes(respuesta)) return "pagar";
    if (["2", "no"].includes(respuesta)) return "menu";
    if (["3", "salir"].includes(respuesta)) return "salir";
    console.log("Respuesta inválida. Escribe sí, no o el número de la opción.");
  }
}

async function atenderPagos(cliente, monto) {
  if (cliente.saldo === 0) {
    console.log(consultarDeuda(cliente));
    return;
  }

  while (cliente.saldo > 0) {
    if (!monto) {
      monto = await leer("Deuda: " + soles(cliente.saldo) + ". Monto en soles (o menú para volver): ");
      if (monto === "salir") return "salir";
      if (monto === "menu" || monto === "menú") return;
    }

    const saldoAnterior = cliente.saldo;
    console.log(pagarDeuda(cliente, monto));
    monto = "";
    if (cliente.saldo === saldoAnterior) continue; // Monto inválido: vuelve a pedirlo.
    if (cliente.saldo === 0) {
      console.log("Tu deuda está pagada. ¡Estás al día!");
      return;
    }

    const siguiente = await preguntarOtroPago();
    if (siguiente === "salir") return "salir";
    if (siguiente === "menu") {
      console.log(menu);
      return;
    }
  }
}

async function conversar(cliente) {
  console.log("Hola, " + cliente.nombre + ".");

  console.log(menu);

  while (true) {
    const texto = await leer("Selecciona una opción: ");
    if (texto === "3" || texto === "salir") break;

    if (/^(opci[oó]n|opciones|men[uú])$/i.test(texto)) {
      console.log(menu);
      continue;
    }
    if (/^[a-záéíóúñ]$/i.test(texto)) {
      console.log("Elige 1 para consultar, 2 para pagar o 3 para salir.");
      continue;
    }

    let opcion;
    let monto = "";
    if (texto === "1") opcion = "consultarDeuda";
    else if (texto === "2") opcion = "pagarDeuda";
    else if (/^(quiero\s+pagar|pagar|pago)\s+[s\d+.,-]/i.test(texto)) {
      opcion = "pagarDeuda";
      monto = texto;
    } else if (!texto || /^[+\d.,-]+$/.test(texto)) {
      console.log("Opción inválida. Elige 1, 2 o 3.");
      continue;
    } else {
      try {
        opcion = await preguntar(texto);
      } catch {
        console.log("No se pudo interpretar la consulta. Usa el menú.");
        continue;
      }
    }

    if (opcion === "consultarDeuda") {
      console.log(consultarDeuda(cliente));
    } else if (opcion === "pagarDeuda") {
      if (await atenderPagos(cliente, monto) === "salir") return;
    } else {
      console.log("Puedes consultar tu deuda o registrar un pago.");
    }
  }
}

console.log("Asistente de deudas de la tienda. Escribe salir para terminar.");
try {
  const cliente = await identificarCliente();
  if (cliente) await conversar(cliente);
} finally {
  console.log("Hasta luego.");
  rl.close();
}
