export interface OrderData {
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
}

export interface SavedMessage {
  id: string;
  timestamp: string;
  data: OrderData;
  formattedText: string;
  phoneNumber?: string;
}
