import React, { useState, useEffect } from "react";
import { 
  Upload, 
  Send, 
  Copy, 
  MapPin, 
  History, 
  Loader2, 
  Check, 
  Laptop, 
  Trash2, 
  RefreshCw,
  FileText,
  FileCode,
  Sparkles,
  ClipboardList,
  Phone,
  Mail
} from "lucide-react";
import Tesseract from "tesseract.js";
import { OrderData, SavedMessage } from "./types";
import { addDoc, getDocs, deleteDoc, doc, query, orderBy, limit } from "firebase/firestore";
import { db, ordersCollection } from "./lib/firebase";

// Default demonstration state matching the user's requested data from the official screenshot
const DEFAULT_ORDER: OrderData = {
  ordenTrabajo: "#20,415 (Remolque)",
  cliente: "CLUB DE ASISTENCIA",
  marca: "FORD - ESCAPE",
  modelo: "2011",
  color1: "BLANCO",
  color2: "-Ninguno-",
  placas: "XKG 272 C",
  serieMotor: "",
  asegurado: "VERONICA PADILLA //833186793",
  tarifa: "03.-ALTAMIRA TIPO *A*_2024",
  ubicacion: "U. DE HARDVARD ESQUINA U. DE SORBONA COL. UNIVERSIDAD SUR EN TAMPICO //22.272366, -97.860679",
  coordenadas: "22.272366, -97.860679",
  destino: "COL. LA FLORIDA EN ALTAMIRA"
};

// Extremely robust synchronous parser for extracting key properties from any OCR or noisy text string
export const computeParsedFields = (text: string): OrderData => {
  const result: OrderData = {
    ordenTrabajo: "",
    cliente: "",
    marca: "",
    modelo: "",
    color1: "",
    color2: "",
    placas: "",
    serieMotor: "",
    asegurado: "",
    tarifa: "",
    ubicacion: "",
    coordenadas: "",
    destino: ""
  };

  if (!text) return result;
  
  // Normalize whitespace and split into lines
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // 1. Extract Lat, Lng coordinates anywhere in the text (e.g. 22.282221, -97.873095)
  const coordsRegex = /(-?\d{1,2}\.\d{4,9})\s*,\s*(-?\d{1,3}\.\d{4,9})/;
  const coordsMatch = text.match(coordsRegex);
  if (coordsMatch) {
    result.coordenadas = `${coordsMatch[1].trim()}, ${coordsMatch[2].trim()}`;
  }

  // 2. Extract Order Number (matches: Orden de Trabajo #20,411 or similar)
  const otRegexes = [
    /(?:Orden de Trabajo|Folio|Orden|OT|O\.T\.)\s*[:#]?\s*([0-9A-Za-z,.\-/() \t]+)/i,
    /#\s*([0-9,.]+)/,
    /\b(?:OT|OT#|FOLIO)\s*([0-9]+)/i
  ];
  for (const regex of otRegexes) {
    const match = text.match(regex);
    if (match && match[1]) {
      let val = match[1].trim();
      if (!val.startsWith("#")) val = "#" + val;
      result.ordenTrabajo = val;
      break;
    }
  }

  // 3. Extract Client / Nombre (Nombre: CLUB DE ASISTENCIA)
  const clientRegexes = [
    /(?:Nombre|Cliente|Aseguradora|Asegurado|Compañía|Compania)\s*:\s*([^\n\r\t]+)/i,
    /(?:MULTIASISTENCIA|GNP|MAPFRE|AXA|QUALITAS|HDI|ABA|SURA|QUALITAS|CHUBB|ASISTENCIAS)/i
  ];
  for (const regex of clientRegexes) {
    const match = text.match(regex);
    if (match) {
      if (match[1]) {
        result.cliente = match[1].trim();
        break;
      } else {
        if (text.toUpperCase().includes("MULTIASISTENCIA")) {
          result.cliente = "MULTIASISTENCIA (ASISTENCIAS)";
          break;
        }
      }
    }
  }

  // 4. Extract Brand / Marca / Vehículo (e.g. VOLKSWAGEN - JETTA)
  const brandRegexes = [
    /Marca\s*(?:\/\s*Tipo)?\s*:\s*([^\n\r\t]+)/i,
    /Vehículo\s*:\s*([^\n\r\t]+)/i,
    /(?:VOLKSWAGEN|NISSAN|FORD|CHEVROLET|TOYOTA|HONDA|MAZDA|KIA|HYUNDAI|BMW|AUDI|MERCEDES|JEEP|DODGE|CHRYSLER|SEAT|RENAULT|PEUGEOT|SUZUKI|MG|BYD)\s*[-–]?\s*[A-Z0-9\s-]*/i
  ];
  for (const regex of brandRegexes) {
    const match = text.match(regex);
    if (match) {
      if (match[1]) {
        result.marca = match[1].trim();
        break;
      } else {
        result.marca = match[0].trim();
        break;
      }
    }
  }

  // 5. Extract Model
  const modelRegexes = [
    /Modelo\s*:\s*([^\n\r\t]*)/i,
    /Año\s*:\s*([0-9]{4})/i,
    /\b(20[0-2][0-9]|19[8-9][0-9])\b/
  ];
  for (const regex of modelRegexes) {
    const match = text.match(regex);
    if (match) {
      result.modelo = match[1] ? match[1].trim() : match[0].trim();
      break;
    }
  }

  // 6. Extract Color 1 & Color 2
  const color1Regex = /Color\s*(?:1)?\s*:\s*([^\n\r\t/]+)/i;
  const color1Match = text.match(color1Regex);
  if (color1Match) {
    result.color1 = color1Match[1].trim();
  } else {
    const colors = ["AZUL", "ROJO", "NEGRO", "BLANCO", "GRIS", "PLATA", "VERDE", "AMARILLO", "NARANJA", "CAFE", "VINO"];
    for (const c of colors) {
      if (text.toUpperCase().includes(c)) {
        result.color1 = c;
        break;
      }
    }
  }

  const color2Regex = /Color 2\s*:\s*([^\n\r\t]+)/i;
  const color2Match = text.match(color2Regex);
  if (color2Match) {
    result.color2 = color2Match[1].trim();
  }

  // 7. Extract Plates (Placas)
  const platesRegexes = [
    /Placas\s*:\s*([A-Z0-9-\s]+)/i,
    /\b([A-Z]{3}\s*-\s*\d{3}\s*-\s*[A-Z]|\d{3}\s*-\s*[A-Z]{3}|[A-Z]{3}\s*\d{3}\s*[A-Z]|[A-Z]{3}\s*\d{2}\s*\d[A-Z]|[A-Z0-9]{3,8})\b/i
  ];
  for (const regex of platesRegexes) {
    const match = text.match(regex);
    if (match) {
      const val = match[1] ? match[1].trim() : match[0].trim();
      if (val.length >= 4 && val.length <= 15) {
        result.placas = val.toUpperCase();
        break;
      }
    }
  }

  // 8. Extract Serie Motor
  const serieMotorRegex = /(?:Serie Motor|Serie|Nº Serie|Motor)\s*:\s*([^\n\r\t]+)/i;
  const serieMotorMatch = text.match(serieMotorRegex);
  if (serieMotorMatch) {
    result.serieMotor = serieMotorMatch[1].trim();
  }

  // 9. Extract Asegurado
  const aseguradoRegex = /Asegurado\s*:\s*([^\n\r\t]+)/i;
  const aseguradoMatch = text.match(aseguradoRegex);
  if (aseguradoMatch) {
    result.asegurado = aseguradoMatch[1].trim();
  }

  // 10. Extract Tarifa
  const tarifaRegex = /Tarifa\s*:\s*([^\n\r\t]+)/i;
  const tarifaMatch = text.match(tarifaRegex);
  if (tarifaMatch) {
    result.tarifa = tarifaMatch[1].trim();
  }

  // 11. Extract Location (Origen / Ubicación)
  // De acuerdo con la indicación del usuario: el dato de origen es el texto donde están las coordenadas
  let foundUbicacion = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (coordsRegex.test(line) && !line.toUpperCase().includes("DESTINO")) {
      foundUbicacion = line;
      break;
    }
  }

  // Si no se encuentra una línea con coordenadas, buscar bajo la palabra "Origen" o similares
  if (!foundUbicacion) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/Origen|Ubicación|Ubicacion|Dirección Origen/i.test(line)) {
        let nextLine = "";
        let nextIdx = i + 1;
        while (nextIdx < lines.length) {
          const possible = lines[nextIdx].trim();
          const upperPoss = possible.toUpperCase();
          if (possible && 
              possible !== "v" && 
              !upperPoss.startsWith("DESTINO") && 
              !upperPoss.includes("CLIENTE") &&
              !upperPoss.includes("MARCA") &&
              !upperPoss.includes("MODELO") &&
              !upperPoss.includes("PLACAS") &&
              !upperPoss.includes("SERIE")) {
            if (upperPoss.includes("-NINGUNO-") || upperPoss === "NINGUNO") {
              nextIdx++;
              continue;
            }
            nextLine = possible;
            break;
          }
          nextIdx++;
        }
        if (nextLine) {
          foundUbicacion = nextLine;
          break;
        }
      }
    }
  }

  if (foundUbicacion) {
    result.ubicacion = foundUbicacion;
  } else {
    const locationSectionRegex = /(?:\*ubicación\*|Ubicación|Origen|Dirección Origen|Ubicacion)\s*:\s*([\s\S]*?)(?=\*destino\*|Destino|Color 2|$)/i;
    const locMatch = text.match(locationSectionRegex);
    if (locMatch && locMatch[1]) {
      let candidate = locMatch[1].trim();
      candidate = candidate.replace(/[-─]Ninguno[-─](?:\s*v)?/gi, "").trim();
      result.ubicacion = candidate;
    } else {
      const addressKeywords = ["AVE", "COL.", "C.", "CALLE", "BOULEVARD", "BLVD", "CARRERA", "CARRETERA", "FRENTE", "AUTOZONE", "ESQUINA", "COLONIA", "U. DE"];
      const locLines: string[] = [];
      for (const line of lines) {
        const upperLine = line.toUpperCase();
        if (addressKeywords.some(kw => upperLine.includes(kw)) && !upperLine.includes("DESTINO") && !upperLine.includes("RECIDENCIAL")) {
          locLines.push(line);
        }
      }
      if (locLines.length > 0) {
        result.ubicacion = locLines.join(" // ");
      }
    }
  }

  if (result.ubicacion) {
    result.ubicacion = result.ubicacion.replace(/^[-─]*Ninguno[-─]*(?:\s*v)?/gi, "").trim();
  }

  // 12. Extract Destino (Destination)
  let foundDestino = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/Destino|Dirección Destino|Entregar en/i.test(line)) {
      let nextLine = "";
      let nextIdx = i + 1;
      while (nextIdx < lines.length) {
        const possible = lines[nextIdx].trim();
        const upperPoss = possible.toUpperCase();
        if (possible && 
            possible !== "v" && 
            !upperPoss.startsWith("ORIGEN") && 
            !upperPoss.includes("CLIENTE") &&
            !upperPoss.includes("MARCA") &&
            !upperPoss.includes("MODELO") &&
            !upperPoss.includes("PLACAS") &&
            !upperPoss.includes("SERIE")) {
          if (upperPoss.includes("-NINGUNO-") || upperPoss === "NINGUNO") {
            nextIdx++;
            continue;
          }
          nextLine = possible;
          break;
        }
        nextIdx++;
      }
      if (nextLine) {
        foundDestino = nextLine;
        break;
      }
    }
  }

  if (foundDestino) {
    result.destino = foundDestino;
  } else {
    const destinationSectionRegex = /(?:\*destino\*|Destino|Dirección Destino|Entregar en)\s*:\s*([\s\S]*?)$/i;
    const destMatch = text.match(destinationSectionRegex);
    if (destMatch && destMatch[1]) {
      let candidate = destMatch[1].trim();
      candidate = candidate.replace(/[-─]Ninguno[-─](?:\s*v)?/gi, "").trim();
      result.destino = candidate;
    } else {
      const destKeywords = ["RECIDENCIAL", "LAGUNAS", "ALTAMIRA", "DESTINO", "ENTREGA", "MIRALTA", "TALLER", "AGENCIA", "COL. LA", "FLORIDA"];
      const destLines: string[] = [];
      for (const line of lines) {
        const upperLine = line.toUpperCase();
        if (destKeywords.some(kw => upperLine.includes(kw)) && !upperLine.includes("ORIGEN") && !upperLine.includes("UBICACION")) {
          destLines.push(line);
        }
      }
      if (destLines.length > 0) {
        result.destino = destLines.join(" // ");
      }
    }
  }

  if (result.destino) {
    result.destino = result.destino.replace(/^[-─]*Ninguno[-─]*(?:\s*v)?/gi, "").trim();
  }

  // Clean values from trailing symbols like "*", ":"
  const cleanField = (val: string) => {
    if (!val) return "";
    return val.replace(/^[:\s*-]+|[:\s*-]+$/g, "").trim();
  };

  result.ordenTrabajo = cleanField(result.ordenTrabajo) || "#20,415 (Remolque)";
  result.cliente = cleanField(result.cliente) || "CLUB DE ASISTENCIA";
  result.marca = cleanField(result.marca) || "FORD - ESCAPE";
  result.modelo = cleanField(result.modelo) || "2011";
  result.color1 = cleanField(result.color1) || "BLANCO";
  result.color2 = cleanField(result.color2) || "-Ninguno-";
  result.placas = cleanField(result.placas) || "XKG 272 C";
  result.serieMotor = cleanField(result.serieMotor);
  result.asegurado = cleanField(result.asegurado) || "VERONICA PADILLA //833186793";
  result.tarifa = cleanField(result.tarifa) || "03.-ALTAMIRA TIPO *A*_2024";
  result.ubicacion = cleanField(result.ubicacion) || "U. DE HARDVARD ESQUINA U. DE SORBONA COL. UNIVERSIDAD SUR EN TAMPICO //22.272366, -97.860679";
  result.coordenadas = cleanField(result.coordenadas) || "22.272366, -97.860679";
  result.destino = cleanField(result.destino) || "COL. LA FLORIDA EN ALTAMIRA";

  return result;
};

export default function App() {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  // App state
  const [orderData, setOrderData] = useState<OrderData>(DEFAULT_ORDER);
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [history, setHistory] = useState<SavedMessage[]>([]);
  const [activeTab, setActiveTab] = useState<"compose" | "history">("compose");
  
  // New input tab for NO-AI / Text OCR Parser
  const [ingestionMode, setIngestionMode] = useState<"ai-vision" | "paste-ocr">("ai-vision");
  const [pastedText, setPastedText] = useState<string>("");

  // New OCR state controls (Local browser OCR vs Cloud AI Gemini)
  const [ocrMethod, setOcrMethod] = useState<"local" | "gemini">("local");
  const [ocrProgress, setOcrProgress] = useState<string>("");
  const [ocrProgressPercent, setOcrProgressPercent] = useState<number>(0);
  const [pasteSuccess, setPasteSuccess] = useState<boolean>(false);

  // Global clipboard paste listener (Ctrl + V) to process screenshots instantly
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            // Prevent default behavior to avoid pasting files as raw text into focused inputs if it's an image
            e.preventDefault();
            
            const reader = new FileReader();
            reader.onload = async (event) => {
              if (event.target?.result) {
                const base64 = event.target.result as string;
                setSelectedImage(base64);
                setImageFile(file);
                setIngestionMode("ai-vision");
                setPasteSuccess(true);
                setError(null);
                
                // Clear notification after 4 seconds
                setTimeout(() => setPasteSuccess(false), 4000);
                
                // Instantly trigger the appropriate scan method for maximum speed
                if (ocrMethod === "local") {
                  await runLocalOCRForImage(base64);
                } else {
                  await runGeminiOCRForImage(base64, file.type || "image/png");
                }
              }
            };
            reader.readAsDataURL(file);
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [ocrMethod]); // Re-bind when ocrMethod changes so auto-start uses correct tech

  // Load history from localStorage and Firestore on mount
  useEffect(() => {
    // 1. First load from localStorage for instant preview
    try {
      const saved = localStorage.getItem("whatsapp_orders_history");
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Error loading local history", e);
    }

    // 2. Fetch from Firebase Firestore for live cloud syncing
    const fetchFirestoreHistory = async () => {
      try {
        const q = query(ordersCollection, orderBy("createdAt", "desc"), limit(50));
        const querySnapshot = await getDocs(q);
        const fbHistory: SavedMessage[] = [];
        querySnapshot.forEach((doc) => {
          const val = doc.data();
          fbHistory.push({
            id: doc.id,
            timestamp: val.timestamp,
            data: val.data,
            formattedText: val.formattedText,
            phoneNumber: val.phoneNumber,
          });
        });

        if (fbHistory.length > 0) {
          setHistory(fbHistory);
          localStorage.setItem("whatsapp_orders_history", JSON.stringify(fbHistory));
        }
      } catch (err) {
        console.warn("Firestore fetch error or empty database, falling back to local storage:", err);
      }
    };

    fetchFirestoreHistory();
  }, []);

  // Live parser for raw text (Manual OCR or shared text copy)
  const parseRawTextToFields = (text: string) => {
    if (!text.trim()) return;
    const parsed = computeParsedFields(text);
    setOrderData(parsed);
  };

  // Run text parser whenever pastedText changes
  useEffect(() => {
    if (ingestionMode === "paste-ocr" && pastedText) {
      parseRawTextToFields(pastedText);
    }
  }, [pastedText, ingestionMode]);

  // Save history helper with Firebase Cloud synchronization
  const saveToHistory = async (item: SavedMessage) => {
    // Immediate optimistic local update for ultra-snappy interface
    const tempId = item.id || Date.now().toString();
    const updated = [{ ...item, id: tempId }, ...history].slice(0, 50);
    setHistory(updated);
    localStorage.setItem("whatsapp_orders_history", JSON.stringify(updated));

    // Async save to Firestore
    try {
      const docRef = await addDoc(ordersCollection, {
        timestamp: item.timestamp,
        data: item.data,
        formattedText: item.formattedText,
        phoneNumber: item.phoneNumber || "",
        createdAt: Date.now()
      });
      
      // Update local item with real Firestore doc.id
      setHistory(prev => prev.map(msg => msg.id === tempId ? { ...msg, id: docRef.id } : msg));
    } catch (err) {
      console.error("Error saving to Firestore:", err);
    }
  };

  const deleteFromHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Immediate local update
    const updated = history.filter(item => item.id !== id);
    setHistory(updated);
    localStorage.setItem("whatsapp_orders_history", JSON.stringify(updated));

    // Delete from Firestore if it is a valid Firestore doc id
    try {
      if (id && isNaN(Number(id))) {
        await deleteDoc(doc(db, "whatsapp_orders", id));
      }
    } catch (err) {
      console.error("Error deleting from Firestore:", err);
    }
  };

  // Generate formatting based strictly on user's exact template with new fields
  const generateMessageText = (data: OrderData): string => {
    let mapsLink = "";
    if (data.coordenadas && data.coordenadas.trim()) {
      // Create clean coordinates link
      const coords = data.coordenadas.replace(/\s+/g, "");
      mapsLink = `\nhttps://www.google.com/maps/search/?api=1&query=${coords}`;
    }

    return `Orden de Trabajo: ${data.ordenTrabajo || ""}
Nombre: *${data.cliente || ""}*
Marca: ${data.marca || ""}
Modelo: ${data.modelo || ""}
Color 1: ${data.color1 || ""}
Placas: ${data.placas || ""}
Serie Motor: ${data.serieMotor || ""}

Origen
${data.ubicacion || ""}${mapsLink}

Destino
${data.destino || ""}`;
  };

  const formattedMessage = generateMessageText(orderData);

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      processSelectedFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const processSelectedFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Por favor, sube únicamente archivos de imagen (PNG, JPG, JPEG, WEBP).");
      return;
    }
    setError(null);
    setImageFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setSelectedImage(event.target.result as string);
        setIngestionMode("ai-vision"); // auto-switch to image tab
      }
    };
    reader.readAsDataURL(file);
  };

  // Modern modular OCR Runners accepting direct image inputs (essential for paste trigger)
  const runLocalOCRForImage = async (imageSrc: string) => {
    try {
      setLoading(true);
      setError(null);
      setOcrProgress("Iniciando motor de reconocimiento local (Tesseract)...");
      setOcrProgressPercent(10);
      
      const result = await Tesseract.recognize(
        imageSrc,
        "spa+eng",
        {
          logger: m => {
            if (m.status === "recognizing text") {
              setOcrProgress(`Analizando imagen localmente: ${Math.round(m.progress * 100)}%`);
              setOcrProgressPercent(20 + Math.round(m.progress * 80));
            } else {
              setOcrProgress(`Cargando diccionarios de idioma...`);
              setOcrProgressPercent(10);
            }
          }
        }
      );

      const text = result.data.text;
      if (!text || !text.trim()) {
        throw new Error("El escáner local no pudo leer texto en esta imagen. Por favor intenta con otra captura.");
      }

      const parsed = computeParsedFields(text);
      setOrderData(parsed);
      setPastedText(text);

      const historyItem: SavedMessage = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date().toLocaleDateString(),
        data: parsed,
        formattedText: generateMessageText(parsed),
      };
      saveToHistory(historyItem);

      setOcrProgress("");
      setOcrProgressPercent(0);
    } catch (err: any) {
      console.error(err);
      setError(`Error en Escáner Local: ${err.message || err}. Puedes usar la pestaña "Pegar Texto" para pegar el texto de la imagen directamente.`);
    } finally {
      setLoading(false);
    }
  };

  const runGeminiOCRForImage = async (imageSrc: string, mime: string) => {
    try {
      setLoading(true);
      setError(null);
      setOcrProgress("Enviando imagen a Gemini...");
      setOcrProgressPercent(15);

      const commaIndex = imageSrc.indexOf(",");
      if (commaIndex === -1) {
        throw new Error("Formato de imagen inválido.");
      }
      const base64Data = imageSrc.substring(commaIndex + 1);

      const res = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageBase64: base64Data,
          mimeType: mime
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Ocurrió un error al procesar la imagen con Gemini.");
      }

      setOrderData(data);
      
      const historyItem: SavedMessage = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date().toLocaleDateString(),
        data: data,
        formattedText: generateMessageText(data),
      };
      saveToHistory(historyItem);
      setOcrProgress("");
      setOcrProgressPercent(0);
    } catch (err: any) {
      console.error("Gemini failed, falling back to local OCR:", err);
      setError(`Aviso: El servicio de IA está saturado en este momento. Activamos automáticamente el Escáner Local Gratuito para procesar tu imagen al instante...`);
      await runLocalOCRForImage(imageSrc);
    } finally {
      setLoading(false);
    }
  };

  // Call API to analyze using local OCR or cloud Gemini with auto-fallback
  const handleAnalyzeImage = async () => {
    if (!selectedImage) {
      setError("Por favor selecciona o arrastra una imagen de orden de trabajo primero.");
      return;
    }

    if (ocrMethod === "local") {
      await runLocalOCRForImage(selectedImage);
    } else {
      await runGeminiOCRForImage(selectedImage, imageFile?.type || "image/png");
    }
  };

  // Copy to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(formattedMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // WhatsApp Sender
  const handleSendWhatsApp = (mode: "web" | "api") => {
    const textEncoded = encodeURIComponent(formattedMessage);
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    
    let url = "";
    if (mode === "web") {
      url = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${textEncoded}`;
    } else {
      url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${textEncoded}`;
    }

    // Save current state to history before opening
    const historyItem: SavedMessage = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date().toLocaleDateString(),
      data: { ...orderData },
      formattedText: formattedMessage,
      phoneNumber: phoneNumber || undefined
    };
    saveToHistory(historyItem);

    window.open(url, "_blank");
  };

  // Load demonstration preset of the requested screenshot data
  const handleLoadDemoData = () => {
    setOrderData(DEFAULT_ORDER);
    setPastedText(`Orden de Trabajo #20,415 (Remolque)
Nombre:\tCLUB DE ASISTENCIA
Marca:\tFORD - ESCAPE\tModelo:\t2011
Color 1:\tBLANCO\tColor 2:\t-Ninguno-
Placas:\tXKG 272 C\tSerie Motor:\t
Asegurado:\tVERONICA PADILLA //833186793
Tarifa:\t03.-ALTAMIRA TIPO *A*_2024

*Origen*
U. DE HARDVARD ESQUINA U. DE SORBONA COL. UNIVERSIDAD SUR EN TAMPICO //22.272366, -97.860679

*Destino*
COL. LA FLORIDA EN ALTAMIRA`);
    setError(null);
  };

  return (
    <div id="app-root" className="flex flex-col min-h-screen bg-[#F3F4F6] text-slate-800 font-sans antialiased selection:bg-[#FFD400]/40 selection:text-slate-900">
      
      {/* Dynamic Clipboard Paste Toast Notification */}
      {pasteSuccess && (
        <div className="fixed top-24 left-1/2 transform -translate-x-1/2 z-50 animate-bounce">
          <div className="bg-slate-900 text-[#FFD400] text-xs font-bold uppercase tracking-wider px-5 py-3 rounded-xl shadow-2xl border-2 border-[#FFD400] flex items-center gap-3.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FFD400] animate-ping"></span>
            <span>📋 ¡Imagen pegada desde el portapapeles! Iniciando escaneo automático...</span>
          </div>
        </div>
      )}

      {/* CSS Utilities for Corporativo Aries brand styling */}
      <style>{`
        .glass-panel {
          background: #ffffff;
          border: 1px solid #E5E7EB;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.03), 0 2px 4px -1px rgba(0, 0, 0, 0.02);
        }
        .brand-glow {
          box-shadow: 0 4px 20px rgba(255, 212, 0, 0.2);
        }
        .brand-gradient {
          background: linear-gradient(135deg, #FFD400 0%, #FFB700 100%);
        }
        .brand-gradient-hover {
          background: linear-gradient(135deg, #FFE043 0%, #FFC400 100%);
        }
        /* Custom scrollbar */
        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: #F3F4F6;
        }
        ::-webkit-scrollbar-thumb {
          background: #CBD5E1;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #94A3B8;
        }
      `}</style>

      {/* Top Gold/Yellow Information Bar exactly like official website */}
      <div className="bg-[#FFD400] text-[#111827] px-6 md:px-12 py-2 flex flex-col sm:flex-row justify-between items-center text-xs font-bold gap-2 border-b border-yellow-500/20 select-none">
        <div className="flex items-center gap-6">
          <a href="tel:8332171010" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Phone size={13} className="text-[#111827] fill-[#111827]" />
            <span>833-217-1010</span>
          </a>
          <a href="mailto:info@corporativoaries.mx" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Mail size={13} className="text-[#111827]" />
            <span>info@corporativoaries.mx</span>
          </a>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-slate-800 uppercase tracking-widest font-extrabold">Síguenos:</span>
          <div className="flex items-center gap-3 text-[#111827] font-extrabold text-[11px]">
            <span className="hover:opacity-75 cursor-pointer">f</span>
            <span className="hover:opacity-75 cursor-pointer">𝕏</span>
            <span className="hover:opacity-75 cursor-pointer">📸</span>
            <span className="hover:opacity-75 cursor-pointer">▶</span>
            <span className="hover:opacity-75 cursor-pointer">🎵</span>
          </div>
        </div>
      </div>

      {/* Main Corporate Navbar with Grúas Aries Logo & Menu Links */}
      <nav id="navbar" className="flex flex-col md:flex-row items-center justify-between px-6 md:px-12 py-4 border-b border-slate-200 bg-white sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-4 mb-4 md:mb-0">
          {/* Brand Logo image exactly matching official page */}
          <div className="flex items-center gap-3 select-none">
            <img 
              src="https://corporativoaries.com/wp-content/uploads/2026/02/logo-web.png" 
              alt="Grúas Aries Logo" 
              className="h-14 md:h-20 w-auto object-contain select-none transition-transform duration-300 hover:scale-[1.03]"
              referrerPolicy="no-referrer"
              onError={(e) => {
                // Sencillo fallback en texto por si el sitio web corporativo de la empresa está caído o bloquea las peticiones de origen cruzado
                e.currentTarget.style.display = 'none';
                const fallbackEl = document.getElementById('logo-fallback');
                if (fallbackEl) fallbackEl.style.display = 'flex';
              }}
            />
            {/* Fallback Text if logo fails to load */}
            <div id="logo-fallback" className="hidden flex-col items-start leading-none">
              <div className="flex items-center gap-2">
                <span className="text-xl md:text-2xl font-black tracking-tighter text-[#1A1A1A] uppercase">GRUAS</span>
                <div className="w-10 h-10 flex items-center justify-center bg-[#FFD400] text-slate-950 rounded-full font-black text-xl shadow-inner border border-black/10">
                  🐏
                </div>
                <span className="text-xl md:text-2xl font-black tracking-tighter text-[#1A1A1A] uppercase">ARIES</span>
              </div>
              <span className="text-[8px] font-black tracking-[0.25em] text-slate-500 uppercase mt-1">CORPORATIVOARIES.MX</span>
            </div>
          </div>
          
          <div className="hidden lg:block border-l border-slate-300 h-8 mx-2"></div>
          
          <div className="hidden lg:block">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">Módulo Operador</span>
            <span className="text-[9px] text-emerald-600 font-extrabold uppercase tracking-widest flex items-center gap-1 leading-none mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Conexión Activa
            </span>
          </div>
        </div>

        {/* Navigation Menu Options mirroring the corporate website */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mb-3 md:mb-0">
          <span className="text-[11px] font-extrabold text-[#FFD400] cursor-pointer border-b-2 border-[#FFD400] pb-0.5 uppercase tracking-wider transition-all">HOME</span>
          <span className="text-[11px] font-extrabold text-slate-500 hover:text-slate-800 cursor-pointer uppercase tracking-wider transition-all" onClick={() => alert("Corporativo Aries - Soluciones integrales de arrastre, salvamento y logística especializada con cobertura nacional.")}>SOBRE NOSOTROS</span>
          <span className="text-[11px] font-extrabold text-slate-500 hover:text-slate-800 cursor-pointer uppercase tracking-wider transition-all" onClick={() => alert("Asistencia Vial 24/7 de Grúas en Tampico, Madero, Altamira y todo México.")}>SERVICIOS</span>
          <span className="text-[11px] font-extrabold text-slate-500 hover:text-slate-800 cursor-pointer uppercase tracking-wider transition-all" onClick={() => alert("Contamos con equipos de arrastre para automóviles, tractocamiones y grúas de plataforma industriales de última generación.")}>EQUIPOS</span>
          <span className="text-[11px] font-extrabold text-slate-500 hover:text-slate-800 cursor-pointer uppercase tracking-wider transition-all" onClick={() => alert("Últimas noticias sobre seguridad vial, reglamentos de tránsito y logística.")}>BLOG</span>
          <span className="text-[11px] font-extrabold text-slate-500 hover:text-slate-800 cursor-pointer uppercase tracking-wider transition-all" onClick={() => alert("Línea de Emergencia y Soporte Técnico: 833-217-1010")}>CONTACTO</span>
        </div>

        {/* Tab Switcher Actions */}
        <div className="flex gap-2.5">
          <button 
            onClick={() => setActiveTab("compose")}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 border ${
              activeTab === "compose" 
                ? "bg-[#FFD400] text-slate-950 border-[#FFD400] font-extrabold shadow-sm" 
                : "bg-slate-50 text-slate-600 hover:text-slate-950 border-slate-200 hover:bg-slate-100"
            }`}
          >
            Panel de Envío
          </button>
          <button 
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 border flex items-center gap-1.5 ${
              activeTab === "history" 
                ? "bg-[#FFD400] text-slate-950 border-[#FFD400] font-extrabold shadow-sm" 
                : "bg-slate-50 text-slate-600 hover:text-slate-950 border-slate-200 hover:bg-slate-100"
            }`}
          >
            <History size={14} />
            Historial ({history.length})
          </button>
        </div>
      </nav>

      {/* Main Container */}
      <main id="main-content" className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 flex flex-col lg:flex-row gap-6">
        
        {activeTab === "compose" ? (
          <>
            {/* Left Column: Image / Text Ingestion & Fields Form */}
            <div id="col-capture" className="flex-1 flex flex-col gap-5">
              
              {/* Step 1 Title & Tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FFD400] animate-pulse"></span>
                  <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-700">
                    Paso 1: Método de Entrada de Datos
                  </h2>
                </div>
                
                <div className="flex gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    onClick={() => setIngestionMode("ai-vision")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      ingestionMode === "ai-vision"
                        ? "bg-[#FFD400] text-slate-950 shadow-sm font-extrabold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <Sparkles size={12} />
                    Escáner IA (Vision)
                  </button>
                  <button
                    onClick={() => setIngestionMode("paste-ocr")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      ingestionMode === "paste-ocr"
                        ? "bg-[#FFD400] text-slate-950 shadow-sm font-extrabold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <FileCode size={12} />
                    Pegar Texto (Sin IA)
                  </button>
                </div>
              </div>

              {/* Ingestion Panel Body */}
              <div className="glass-panel rounded-2xl p-4 md:p-6 flex flex-col gap-4 bg-white">
                
                {ingestionMode === "ai-vision" ? (
                  /* IMAGE VISION OCR (GEMINI / TESSERACT) */
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <Upload size={14} className="text-[#FFD400]" />
                          Escáner de Orden de Trabajo (Imagen o Ctrl + V)
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5 font-sans">
                          Sube la captura, arrástrala, o presiona <kbd className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono font-bold">Ctrl + V</kbd> en cualquier parte para iniciar el escaneo inmediato.
                        </p>
                      </div>
                      <button 
                        onClick={handleLoadDemoData}
                        className="self-start text-xs text-slate-700 hover:text-slate-950 bg-slate-50 hover:bg-[#FFD400]/20 px-3 py-1.5 rounded-lg border border-slate-200 flex items-center gap-1.5 transition-all font-bold"
                        title="Carga datos pre-configurados del ejemplo"
                      >
                        <RefreshCw size={12} />
                        Cargar Demo
                      </button>
                    </div>

                    {/* Method Selector: Local OCR vs Gemini IA */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Tecnología de Lectura:</span>
                        <span className="text-[9px] text-slate-600 bg-white px-2.5 py-0.5 rounded font-mono font-bold uppercase border border-slate-200">
                          {ocrMethod === "local" ? "💻 Motor Tesseract Local" : "✨ Inteligencia Artificial Gemini"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                           type="button"
                           onClick={() => setOcrMethod("local")}
                           className={`px-3 py-2.5 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all ${
                             ocrMethod === "local"
                               ? "bg-white text-slate-900 border-2 border-[#FFD400] shadow-sm font-extrabold"
                               : "bg-white text-slate-500 hover:text-slate-800 border border-slate-200/60"
                           }`}
                        >
                          <span className="text-xs font-bold flex items-center gap-1">
                            💻 Escáner Local (Tesseract)
                          </span>
                          <span className="text-[9px] font-medium text-slate-400 text-center leading-tight">
                            Gratis, ilimitado, sin internet ni errores de red
                          </span>
                        </button>
                        <button
                           type="button"
                           onClick={() => setOcrMethod("gemini")}
                           className={`px-3 py-2.5 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all ${
                             ocrMethod === "gemini"
                               ? "bg-white text-slate-900 border-2 border-[#FFD400] shadow-sm font-extrabold"
                               : "bg-white text-slate-500 hover:text-slate-800 border border-slate-200/60"
                           }`}
                        >
                          <span className="text-xs font-bold flex items-center gap-1">
                            ✨ Escáner Inteligente (Gemini)
                          </span>
                          <span className="text-[9px] font-medium text-slate-400 text-center leading-tight">
                            Gemini analiza y corrige textos difíciles
                          </span>
                        </button>
                      </div>
                    </div>

                    <div 
                      id="drop-zone"
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      className={`relative min-h-[220px] rounded-xl overflow-hidden flex flex-col items-center justify-center p-6 transition-all duration-300 ${
                        dragActive 
                          ? "border-[#FFD400] bg-[#FFD400]/5 scale-[0.99]" 
                          : "border-dashed border-2 border-slate-200 hover:border-slate-400 bg-slate-50"
                      }`}
                    >
                      {selectedImage ? (
                        <div className="relative w-full h-full flex flex-col items-center justify-between gap-4">
                          {/* Image Preview Container */}
                          <div className="relative w-full max-h-[180px] rounded-lg overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center p-2 group">
                            <img 
                              src={selectedImage} 
                              alt="Orden de trabajo cargada" 
                              className="max-w-full max-h-[160px] object-contain rounded"
                            />
                            <div className="absolute inset-0 bg-slate-900/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-white text-xs px-3 py-1.5 rounded-lg border border-slate-600 font-medium">
                                Cambiar Imagen
                                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                              </label>
                              <button 
                                onClick={() => { setSelectedImage(null); setImageFile(null); }}
                                className="bg-red-950/80 hover:bg-red-900 text-red-300 text-xs px-3 py-1.5 rounded-lg border border-red-800 font-medium"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>

                          {/* Action button */}
                          <button
                            onClick={handleAnalyzeImage}
                            disabled={loading}
                            className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 text-slate-950 brand-gradient hover:brand-gradient-hover brand-glow uppercase tracking-widest text-xs transition-all border border-yellow-500/30 ${
                              loading ? "opacity-70 cursor-not-allowed" : ""
                            }`}
                          >
                            {loading ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                                {ocrMethod === "local" ? "Escaneando localmente..." : "Procesando con Gemini AI..."}
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4 text-slate-950" />
                                {ocrMethod === "local" ? "Iniciar Escáner Local (Tesseract)" : "Iniciar Escáner Inteligente (Gemini)"}
                              </>
                            )}
                          </button>
                        </div>
                      ) : (
                        <div className="text-center flex flex-col items-center gap-3 py-4">
                          <div className="w-12 h-12 rounded-full bg-[#FFD400]/10 border border-[#FFD400]/30 flex items-center justify-center text-slate-800 shadow-inner">
                            <Upload size={20} className="text-slate-800" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="font-extrabold text-slate-800 text-sm">Arrastra o selecciona la captura de la orden</h4>
                            <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                              O simplemente haz una captura de pantalla y presiona <kbd className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-800 font-mono font-bold text-[9px]">Ctrl + V</kbd> para pegarla e iniciar la extracción de inmediato.
                            </p>
                          </div>
                          
                          <label className="cursor-pointer inline-flex items-center gap-2 bg-[#FFD400] hover:bg-[#FFC400] text-slate-950 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-all mt-1">
                            Buscar Archivo
                            <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                          </label>
                        </div>
                      )}

                      {loading && (
                        <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-10 p-6 text-center">
                          <Loader2 className="w-10 h-10 text-[#FFD400] animate-spin" />
                          <div className="space-y-2 max-w-sm w-full">
                            <p className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                              {ocrMethod === "local" ? "Reconocimiento de caracteres activo" : "La Inteligencia Artificial está leyendo la imagen..."}
                            </p>
                            <p className="text-[11px] text-slate-500 leading-relaxed font-mono">
                              {ocrProgress || "Procesando..."}
                            </p>
                            
                            {/* Animated progress bar */}
                            {ocrProgressPercent > 0 && (
                              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
                                <div 
                                  className="h-full brand-gradient transition-all duration-300 rounded-full"
                                  style={{ width: `${ocrProgressPercent}%` }}
                                ></div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* RAW TEXT OCR / NO-AI REGEX PARSER */
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1">
                          <ClipboardList size={14} className="text-[#FFD400]" />
                          Extractor de Texto Manual (Algoritmo Lógico)
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Pega aquí cualquier texto copiado de chats o fotos. El sistema inteligente lo analizará y formateará de forma instantánea.
                        </p>
                      </div>
                      <button 
                        onClick={handleLoadDemoData}
                        className="text-xs text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-[#FFD400]/20 px-3 py-1.5 rounded-lg border border-slate-200 flex items-center gap-1.5 transition-all font-bold"
                      >
                        Cargar Demo
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      <textarea
                        rows={4}
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        placeholder="Pega el texto de la imagen o del mensaje aquí. Ej:&#10;Orden de Trabajo #20,411&#10;Marca: VOLKSWAGEN - JETTA&#10;Placas: YJS 695 C&#10;22.282221, -97.873095"
                        className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all font-mono leading-relaxed"
                      />
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>Parser lógico en vivo activo</span>
                        <span>Se auto-rellenará el formulario inferior</span>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Error Alert */}
              {error && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed flex gap-3 items-start shadow-sm">
                  <span className="p-1 rounded bg-[#FFD400]/20 font-bold uppercase text-[9px] text-amber-900 border border-[#FFD400]/30">Aviso</span>
                  <div className="flex-1 font-semibold">{error}</div>
                </div>
              )}

              {/* Editable Fields Form (The Form) */}
              <div id="editable-fields" className="glass-panel rounded-2xl p-5 flex flex-col gap-4 bg-white">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                  <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-800 flex items-center gap-1.5">
                    <FileText size={14} className="text-[#FFD400]" />
                    Información de la Orden
                  </h3>
                  <span className="text-[9px] text-slate-500 font-extrabold font-mono bg-slate-50 border border-slate-200 px-2.5 py-1 rounded">Modo Manual Disponible</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Order Number */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Orden de Trabajo #</label>
                    <input 
                      type="text" 
                      value={orderData.ordenTrabajo}
                      onChange={(e) => setOrderData({ ...orderData, ordenTrabajo: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all font-semibold"
                    />
                  </div>

                  {/* Name / Client */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nombre (Cliente)</label>
                    <input 
                      type="text" 
                      value={orderData.cliente}
                      onChange={(e) => setOrderData({ ...orderData, cliente: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all font-semibold"
                    />
                  </div>

                  {/* Brand & Subbrand */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Marca</label>
                    <input 
                      type="text" 
                      value={orderData.marca}
                      onChange={(e) => setOrderData({ ...orderData, marca: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all"
                    />
                  </div>

                  {/* Model */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Modelo</label>
                    <input 
                      type="text" 
                      value={orderData.modelo}
                      onChange={(e) => setOrderData({ ...orderData, modelo: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all"
                      placeholder="-Ninguno-"
                    />
                  </div>

                  {/* Color 1 */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Color 1</label>
                    <input 
                      type="text" 
                      value={orderData.color1}
                      onChange={(e) => setOrderData({ ...orderData, color1: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all"
                    />
                  </div>

                  {/* Color 2 */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Color 2</label>
                    <input 
                      type="text" 
                      value={orderData.color2}
                      onChange={(e) => setOrderData({ ...orderData, color2: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all"
                    />
                  </div>

                  {/* Plates */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Placas</label>
                    <input 
                      type="text" 
                      value={orderData.placas}
                      onChange={(e) => setOrderData({ ...orderData, placas: e.target.value })}
                      className="bg-slate-50 border-2 border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all font-mono font-bold tracking-widest text-center"
                    />
                  </div>

                  {/* Serie Motor */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Serie Motor</label>
                    <input 
                      type="text" 
                      value={orderData.serieMotor}
                      onChange={(e) => setOrderData({ ...orderData, serieMotor: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all font-mono"
                      placeholder="Vacío"
                    />
                  </div>

                  {/* Asegurado */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Asegurado</label>
                    <input 
                      type="text" 
                      value={orderData.asegurado}
                      onChange={(e) => setOrderData({ ...orderData, asegurado: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all"
                    />
                  </div>

                  {/* Tarifa */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tarifa</label>
                    <input 
                      type="text" 
                      value={orderData.tarifa}
                      onChange={(e) => setOrderData({ ...orderData, tarifa: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all"
                    />
                  </div>

                  {/* Coordinates separate parameter */}
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <MapPin size={12} className="text-[#FFD400]" />
                        Coordenadas de Origen (Google Maps Link)
                      </label>
                      <span className="text-[9px] text-slate-400 font-mono">Lat, Lng</span>
                    </div>
                    <input 
                      type="text" 
                      value={orderData.coordenadas}
                      onChange={(e) => setOrderData({ ...orderData, coordenadas: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all font-mono"
                      placeholder="Ej. 22.282221, -97.873095"
                    />
                  </div>

                  {/* Full Location Text */}
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Origen</label>
                    <textarea 
                      rows={2}
                      value={orderData.ubicacion}
                      onChange={(e) => setOrderData({ ...orderData, ubicacion: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all resize-none font-mono font-semibold"
                    />
                  </div>

                  {/* Destination */}
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Destino</label>
                    <textarea 
                      rows={2}
                      value={orderData.destino}
                      onChange={(e) => setOrderData({ ...orderData, destino: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#FFD400] focus:ring-1 focus:ring-[#FFD400] transition-all resize-none font-mono font-semibold"
                    />
                  </div>

                </div>
              </div>

            </div>

            {/* Right Column: Message Preview and WhatsApp Mockup */}
            <div id="col-compose" className="flex-1 flex flex-col gap-5">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Paso 2: Vista Previa & Envío Directo
              </h2>

              {/* WhatsApp Mock Preview */}
              <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden min-h-[450px] shadow-lg border border-slate-200">
                {/* Simulated Header */}
                <div className="bg-[#1F2C34] px-4 py-3.5 flex justify-between items-center select-none">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#FFD400] flex items-center justify-center font-black text-slate-950 text-sm">
                      🐏
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5 leading-none">
                        Operador Aries
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" title="Canal Activo"></span>
                      </h4>
                      <p className="text-[10px] text-slate-400 font-mono mt-1">Servicio de Despacho 24h</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                  </div>
                </div>

                {/* Simulated Message Area */}
                <div className="p-4 md:p-6 flex-1 overflow-y-auto bg-[#0B141A] flex flex-col justify-between">
                  <div className="flex flex-col gap-4">
                    {/* Floating Tip */}
                    <div className="self-center bg-[#182229] border border-[#233138] rounded-xl px-4 py-2 text-center text-[10px] text-slate-400 max-w-xs leading-relaxed">
                      El texto de abajo es el mensaje exacto con el formato oficial que recibirá el operador de Grúas Aries.
                    </div>

                    {/* WhatsApp Dark Bubble */}
                    <div className="self-start max-w-[90%] bg-[#005C4B] text-slate-100 rounded-tr-xl rounded-bl-xl rounded-br-xl p-4 shadow-md relative">
                      <div className="whitespace-pre-line text-[13px] font-mono leading-relaxed select-text">
                        {formattedMessage}
                      </div>

                      {/* Time and ticks */}
                      <div className="text-[10px] text-emerald-300 text-right mt-3 flex items-center justify-end gap-1 font-mono">
                        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-sky-400">✓✓</span>
                      </div>
                    </div>
                  </div>

                  {/* WhatsApp Sending Action Controls */}
                  <div className="mt-6 flex flex-col gap-3 pt-4 border-t border-[#1F2C34]">
                    
                    {/* Target Phone number */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                        Enviar a (Número de WhatsApp - Operador / Chofer)
                      </label>
                      <input 
                        type="tel" 
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="Ej: +5218331234567 (Tampico/Altamira)"
                        className="bg-[#111B21] border border-[#2A3942] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#FFD400] transition-all font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Copy message button */}
                      <button
                        onClick={handleCopy}
                        className="py-3 px-4 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 font-bold flex items-center justify-center gap-2 transition-all uppercase tracking-wider text-[11px]"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-400" />
                            ¡Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 text-slate-400" />
                            Copiar Texto
                          </>
                        )}
                      </button>

                      {/* Open in WhatsApp Web */}
                      <button
                        onClick={() => handleSendWhatsApp("web")}
                        className="py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold flex items-center justify-center gap-2 transition-all uppercase tracking-wider text-[11px]"
                      >
                        <Laptop className="w-4 h-4" />
                        WhatsApp Web (PC)
                      </button>
                    </div>

                    {/* Open direct WhatsApp (API) */}
                    <button
                      onClick={() => handleSendWhatsApp("api")}
                      className="w-full py-3.5 bg-[#FFD400] hover:bg-[#FFC400] text-slate-950 font-extrabold flex items-center justify-center gap-3 rounded-xl uppercase tracking-widest text-xs shadow-md hover:shadow-lg transition-all border-b-4 border-yellow-600"
                    >
                      <Send className="w-4 h-4 text-slate-950" />
                      Enviar por WhatsApp Móvil
                    </button>
                  </div>
                </div>

                {/* Footer details inside WhatsApp mockup */}
                <div className="bg-[#111B21] px-4 py-2.5 border-t border-[#1F2C34] text-[10px] text-slate-400 flex items-center gap-1.5 font-mono select-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span>Formato compatible con WhatsApp en negritas (*texto*).</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* History View Tab */
          <div id="col-history" className="w-full flex flex-col gap-4">
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-700 flex items-center gap-2">
                <History size={16} className="text-[#FFD400]" />
                Historial de Órdenes Procesadas Localmente
              </h2>
              {history.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm("¿Estás seguro de borrar todo el historial local?")) {
                      setHistory([]);
                      localStorage.removeItem("whatsapp_orders_history");
                    }
                  }}
                  className="text-xs text-red-600 hover:text-red-800 font-bold hover:underline flex items-center gap-1.5"
                >
                  <Trash2 size={13} />
                  Borrar Todo
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="rounded-2xl glass-panel p-12 text-center flex flex-col items-center justify-center gap-4 bg-white">
                <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400">
                  <FileText size={24} />
                </div>
                <div className="space-y-1">
                  <h3 className="font-extrabold text-slate-800 text-sm">No hay registros guardados</h3>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    Las órdenes que captures y envíes se almacenarán de forma local en tu navegador para consultas futuras inmediatas.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab("compose")}
                  className="bg-[#FFD400] hover:bg-[#FFC400] text-slate-950 text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all"
                >
                  Procesar Nueva Orden
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {history.map((item) => (
                  <div 
                    key={item.id} 
                    onClick={() => {
                      setOrderData(item.data);
                      if (item.phoneNumber) setPhoneNumber(item.phoneNumber);
                      setActiveTab("compose");
                    }}
                    className="p-5 rounded-2xl glass-panel hover:bg-slate-50 cursor-pointer transition-all border border-slate-200 hover:border-[#FFD400]/80 flex flex-col justify-between gap-4 group bg-white"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-xs font-mono font-bold text-slate-900 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">{item.data.ordenTrabajo || "Sin Folio"}</span>
                          <span className="text-[10px] text-slate-500 ml-2 font-mono">({item.timestamp})</span>
                        </div>
                        <button
                          onClick={(e) => deleteFromHistory(item.id, e)}
                          className="text-slate-400 hover:text-red-500 p-1.5 rounded hover:bg-slate-100 transition-colors"
                          title="Eliminar de historial"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div className="space-y-1.5 text-xs text-slate-700">
                        <p className="truncate"><span className="text-slate-400 font-extrabold font-mono text-[9px] uppercase tracking-wider">Cliente:</span> <span className="font-semibold text-slate-800">{item.data.cliente}</span></p>
                        <p className="truncate"><span className="text-slate-400 font-extrabold font-mono text-[9px] uppercase tracking-wider">Vehículo:</span> <span className="font-semibold text-slate-800">{item.data.marca} {item.data.modelo ? `- ${item.data.modelo}` : ""}</span></p>
                        <p className="truncate"><span className="text-slate-400 font-extrabold font-mono text-[9px] uppercase tracking-wider">Placas:</span> <span className="font-semibold text-slate-800">{item.data.placas}</span> | <span className="text-slate-400 font-extrabold font-mono text-[9px] uppercase tracking-wider">Color:</span> <span className="font-semibold text-slate-800">{item.data.color1}</span></p>
                        <div className="truncate mt-2 bg-slate-50 p-2.5 rounded text-[11px] border border-slate-200 leading-relaxed text-slate-600">
                          <span className="text-[#FFB700] font-black uppercase text-[9px] mr-1">Origen:</span> {item.data.ubicacion}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-3 border-t border-slate-100 text-[10px] text-[#FFB700] font-extrabold uppercase tracking-wider group-hover:text-[#FFC400]">
                      <span>Cargar en Formulario</span>
                      <span className="text-xs">→</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer matching Corporativo Aries website style */}
      <footer id="footer" className="px-6 md:px-12 py-6 bg-[#0E131F] border-t border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-3 text-[11px] text-slate-400">
        <div className="flex flex-wrap gap-4 justify-center sm:justify-start">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> 
            Servicios Activos: Grúas Aries Tampico - Altamira
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> 
            Parser local listo (Ctrl+V activo)
          </span>
        </div>
        <div className="uppercase tracking-widest font-mono text-[9px] text-slate-500">
          Corporativo Aries © {new Date().getFullYear()} • Soluciones de Asistencia Integral
        </div>
      </footer>
    </div>
  );
}
