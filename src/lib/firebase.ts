import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  orderBy, 
  deleteDoc, 
  doc, 
  limit 
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);

// Collection Reference
export const ordersCollection = collection(db, "whatsapp_orders");

export interface SavedOrder {
  id?: string;
  ordenTrabajo: string;
  cliente: string;
  marca: string;
  modelo: string;
  color1: string;
  color2: string;
  placas: string;
  serieMotor: string;
  asegurado: string;
  tarifa: string;
  ubicacion: string;
  coordenadas: string;
  destino: string;
  timestamp: any;
}
