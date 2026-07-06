import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit to handle base64 images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API Route for healthcheck
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Route to extract order details from work order screenshots
  app.post("/api/extract", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({
          error: "Por favor, configura tu API Key de Gemini en el panel de Configuración > Secrets para comenzar a usar la aplicación."
        });
      }

      const { imageBase64, mimeType } = req.body;
      if (!imageBase64 || !mimeType) {
        return res.status(400).json({ error: "Falta la imagen o el tipo MIME." });
      }

      // Initialize Gemini Client
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const prompt = `Analiza la imagen de la orden de trabajo (remolque, grúa, servicio, asistencia, etc.) y extrae de forma muy precisa la información solicitada en el esquema de respuesta.
      Ten en cuenta lo siguiente:
      1. 'ordenTrabajo': Busca el número de orden de trabajo o folio (por ejemplo "Orden de Trabajo #20,415 (Remolque)" o "Orden de Trabajo #20,411" o similar, o simplemente el número de folio al inicio de la página). Extrae el número de orden exacto con su formato.
      2. 'cliente': Busca el campo "Nombre" del cliente / club de asistencia (por ejemplo "CLUB DE ASISTENCIA" o "MULTIASISTENCIA").
      3. 'marca': Busca la marca del vehículo (por ejemplo "FORD - ESCAPE" o similar en la sección "Otros Datos").
      4. 'modelo': Busca el modelo o año si se especifica por separado, de lo contrario extrae lo que corresponda (por ejemplo "2011").
      5. 'color1': El color primario del vehículo (por ejemplo "BLANCO" o "AZUL").
      6. 'color2': El color secundario si existe (por ejemplo "-Ninguno-").
      7. 'placas': Las placas del vehículo (por ejemplo "XKG 272 C" o "YJS 695 C").
      8. 'serieMotor': Busca el número de serie de motor si se especifica en la casilla 'Serie Motor:' (déjalo vacío si está en blanco).
      9. 'asegurado': Busca el campo 'Asegurado:' (por ejemplo "VERONICA PADILLA //833186793"). Extrae el nombre completo del asegurado y cualquier número de teléfono asociado que aparezca en esa misma línea.
      10. 'tarifa': Busca el campo 'Tarifa:' dentro de la sección "Costos" (por ejemplo "03.-ALTAMIRA TIPO *A*_2024").
      11. 'ubicacion': El origen o ubicación actual. Se encuentra en el recuadro blanco de abajo a la izquierda etiquetado como "Origen:". Extrae todo el contenido de ese cuadro de texto, que incluye la dirección, referencias y coordenadas (por ejemplo "U. DE HARDVARD ESQUINA U. DE SORBONA COL. UNIVERSIDAD SUR EN TAMPICO //22.272366, -97.860679").
      12. 'coordenadas': Si dentro del recuadro de origen o la dirección hay coordenadas de latitud y longitud (como "22.272366, -97.860679" o similares), extráelas por separado en este campo en formato 'latitud, longitud' para poder generar un enlace de Google Maps.
      13. 'destino': El destino del servicio. Se encuentra en el recuadro blanco de abajo a la derecha etiquetado como "Destino:". Extrae todo el contenido de ese cuadro de texto (por ejemplo "COL. LA FLORIDA EN ALTAMIRA").

      Sé extremadamente preciso con las mayúsculas, minúsculas, barras diagonales (//) y formato. Si no encuentras un campo, devuélvelo como cadena vacía "".`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: imageBase64,
            }
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ordenTrabajo: { type: Type.STRING, description: "Número de orden de trabajo o folio" },
              cliente: { type: Type.STRING, description: "Nombre del cliente / Club de Asistencia" },
              marca: { type: Type.STRING, description: "Marca y submarca del vehículo" },
              modelo: { type: Type.STRING, description: "Modelo o año del vehículo" },
              color1: { type: Type.STRING, description: "Color principal" },
              color2: { type: Type.STRING, description: "Color secundario" },
              placas: { type: Type.STRING, description: "Placas del vehículo" },
              serieMotor: { type: Type.STRING, description: "Número de serie del motor" },
              asegurado: { type: Type.STRING, description: "Nombre del asegurado y/o teléfono" },
              tarifa: { type: Type.STRING, description: "Tarifa aplicada al servicio" },
              ubicacion: { type: Type.STRING, description: "Dirección de origen / ubicación completa con referencias y coordenadas" },
              coordenadas: { type: Type.STRING, description: "Coordenadas latitud, longitud si se detectan en la dirección (ej. 22.272366, -97.860679)" },
              destino: { type: Type.STRING, description: "Dirección de destino completa" },
            },
            required: [
              "ordenTrabajo", "cliente", "marca", "modelo", 
              "color1", "color2", "placas", "serieMotor", "asegurado", "tarifa", "ubicacion", 
              "coordenadas", "destino"
            ]
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("No se pudo obtener una respuesta válida de Gemini.");
      }

      const data = JSON.parse(text);
      return res.json(data);
    } catch (error: any) {
      console.error("Error en /api/extract:", error);
      return res.status(500).json({ error: error.message || "Error interno del servidor" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
