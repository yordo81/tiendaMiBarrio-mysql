// ── Impresión de tickets de venta (comprobante del cliente) ────────────────
// Dos métodos, elegibles en Configuración:
//   browser → se maqueta un ticket térmico (57 u 80 mm) y se imprime vía un
//             iframe oculto con el diálogo del navegador (funciona con
//             cualquier impresora instalada en el sistema).
//   usb     → se genera el flujo ESC/POS y se envía directo a una impresora
//             térmica USB usando WebUSB (solo Chrome/Edge, conexión segura).

import { formatDateTime } from '@/lib/utils';

export interface ReceiptItem {
  name: string;
  quantity: number;
  unit_price: number;
}

export interface ReceiptData {
  businessName: string;
  logoUrl?: string | null;
  saleId: string;
  /** Fecha cruda devuelta por el servidor (YYYY-MM-DD HH:mm:ss) */
  date?: string | null;
  customerName?: string | null;
  sellerName?: string | null;
  posName?: string | null;
  items: ReceiptItem[];
  total: number;
  payMethod: 'cash' | 'transfer' | 'mixed' | 'credit';
  cashAmount: number;
  transferAmount: number;
  notes?: string | null;
}

// ── Formato común ────────────────────────────────────────────────
function money(n: number): string {
  return '$' + n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(n: number): string {
  return n.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  const words = String(text).split(/\s+/).filter(Boolean);
  let cur = '';
  for (const w of words) {
    if (w.length > cols) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < w.length; i += cols) out.push(w.slice(i, i + cols));
    } else if ((cur + ' ' + w).trim().length <= cols) {
      cur = cur ? cur + ' ' + w : w;
    } else {
      out.push(cur); cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ── Impresión por navegador (iframe oculto) ──────────────────────
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildReceiptHtml(data: ReceiptData, width: '57' | '80'): string {
  const paperMm = width === '57' ? 58 : 80;
  const small = width === '57';
  const dateLabel = data.date ? formatDateTime(data.date) : '—';
  const logo = data.logoUrl ? new URL(data.logoUrl, window.location.origin).href : null;

  const itemRows = data.items.map(it => {
    const nameLines = wrapText(it.name, small ? 30 : 42).map(l => `<div class="row name">${esc(l)}</div>`).join('');
    const qtyLine = `${qty(it.quantity)} x ${money(it.unit_price)}`;
    return `${nameLines}
      <div class="row sub"><span>${esc(qtyLine)}</span><span class="right">${money(it.quantity * it.unit_price)}</span></div>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>Ticket ${esc(data.saleId)}</title>
<style>
  @page { size: ${paperMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: ${small ? '4mm 3mm' : '5mm 4mm'}; width: ${paperMm}mm;
    font-family: 'Courier New', Courier, monospace; color: #000; background: #fff;
    font-size: ${small ? 11 : 13}px; line-height: 1.45; }
  .center { text-align: center; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .row .right { text-align: right; white-space: nowrap; }
  .name { font-weight: 600; }
  .sub { margin-bottom: 2px; }
  .sep { border-top: 1px dashed #000; margin: 5px 0; }
  .title { font-size: ${small ? 13 : 15}px; font-weight: 700; }
  .total { font-size: ${small ? 13 : 15}px; font-weight: 700; }
  .muted { color: #000; }
  img.logo { max-height: ${small ? 10 : 12}mm; max-width: 100%; margin-bottom: 3px; }
</style></head><body>
  ${logo ? `<div class="center"><img class="logo" src="${esc(logo)}" alt=""/></div>` : ''}
  <div class="center title">${esc(data.businessName)}</div>
  <div class="sep"></div>
  <div class="row"><span>Fecha:</span><span>${esc(dateLabel)}</span></div>
  ${data.customerName ? `<div class="row"><span>Cliente:</span><span>${esc(data.customerName)}</span></div>` : ''}
  <div class="sep"></div>
  ${itemRows}
  <div class="sep"></div>
  <div class="row total"><span>TOTAL</span><span>${money(data.total)}</span></div>
  ${data.notes ? `<div class="row"><span>Nota:</span><span>${esc(data.notes)}</span></div>` : ''}
  <div class="sep"></div>
  <div class="center">¡Gracias por su compra!</div>
  <div class="center">${esc(data.businessName)}</div>
</body></html>`;
}

export function printReceiptViaBrowser(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const cleanup = () => { try { frame.remove(); } catch { /* ya removido */ } };
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) { cleanup(); return; }
    win.focus();
    win.addEventListener('afterprint', cleanup);
    // Respaldo: si el navegador no dispara 'afterprint', se limpia igual
    setTimeout(cleanup, 60000);
    win.print();
  };
  const doc = frame.contentDocument;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
  } else {
    cleanup();
  }
}

// ── Impresión directa ESC/POS por WebUSB ─────────────────────────
// Mapa de caracteres españoles a la página de códigos CP437 (la más
// común en impresoras térmicas ESC/POS); el resto se envía como latin1.
const CP437: Record<string, number> = {
  'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'ü': 0x81,
  'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, 'Ñ': 0xA5, 'Ü': 0x9A,
  '¿': 0xA8, '¡': 0xAD, '°': 0xF8, '─': 0xC4, '·': 0xFA, '•': 0xF9,
};

function cp437Byte(ch: string): number {
  const mapped = CP437[ch];
  if (mapped !== undefined) return mapped;
  const code = ch.codePointAt(0) ?? 0;
  return code <= 255 ? code : 0x3F; // '?' para caracteres no representables
}

interface RenderLine { text: string; bold?: boolean; double?: boolean; align?: 'left' | 'center' | 'right'; }

export function encodeEscPos(data: ReceiptData, width: '57' | '80'): Uint8Array {
  const cols = width === '57' ? 32 : 48;
  const sep = '─'.repeat(cols);
  const lines: RenderLine[] = [];
  const push = (text: string, extra?: Omit<RenderLine, 'text'>) => lines.push({ text, ...extra });
  const center = (s: string) => { const pad = Math.max(0, cols - s.length); return ' '.repeat(Math.floor(pad / 2)) + s + ' '.repeat(pad - Math.floor(pad / 2)); };
  const kv = (k: string, v: string) => `${k}:${' '.repeat(Math.max(1, 11 - (k.length + 1)))}${v}`;

  // Encabezado
  push(center(data.businessName || 'MI NEGOCIO'), { bold: true });
  push(sep);
  push(kv('Fecha', data.date ? formatDateTime(data.date) : '—'));
  if (data.customerName) push(kv('Cliente', data.customerName));
  push(sep);

  // Productos
  for (const it of data.items) {
    for (const ln of wrapText(it.name, cols)) push(ln, { bold: true });
    const qtyLine = `${qty(it.quantity)} x ${money(it.unit_price)}`;
    const sub = money(it.quantity * it.unit_price);
    const gap = Math.max(1, cols - qtyLine.length - sub.length);
    push(qtyLine + ' '.repeat(gap) + sub);
  }
  push(sep);

  // Total — el monto en doble tamaño se alinea a la derecha con ESC a (la
  // impresora maneja la alineación; el padding manual desbordaría el papel).
  push('TOTAL', { bold: true });
  push(money(data.total), { bold: true, double: true, align: 'right' });
  if (data.notes) {
    for (const ln of wrapText(`Nota: ${data.notes}`, cols)) push(ln);
  }
  push(sep);
  push(center('¡Gracias por su compra!'));

  // Codificar ESC/POS
  const out: number[] = [];
  const emit = (b: number[]) => out.push(...b);
  emit([0x1B, 0x40]);        // ESC @ — inicializar impresora
  emit([0x1B, 0x74, 0x02]);  // ESC t 2 — página de códigos CP437
  for (const line of lines) {
    emit([0x1B, 0x61, line.align === 'right' ? 2 : line.align === 'center' ? 1 : 0]); // ESC a — alineación
    emit(line.bold ? [0x1B, 0x45, 0x01] : [0x1B, 0x45, 0x00]);
    emit(line.double ? [0x1D, 0x21, 0x11] : [0x1D, 0x21, 0x00]);
    for (const ch of line.text) emit([cp437Byte(ch)]);
    emit([0x0A]); // LF
  }
  emit([0x1B, 0x64, 0x04]);  // ESC d 4 — avance 4 líneas
  emit([0x1B, 0x69]);        // ESC i — corte de papel

  return new Uint8Array(out);
}

// ── WebUSB ───────────────────────────────────────────────────────
interface UsbDeviceRef { dev: any; iface: any; name: string; }

/** Identidad USB de una impresora (para registrarla y volver a encontrarla). */
export interface UsbPrinterTarget {
  vendorId: number;
  productId: number;
  serialNumber?: string;
}

/** Info completa de un dispositivo USB detectado por WebUSB. */
export interface UsbPrinterInfo extends UsbPrinterTarget {
  /** Clave estable: vendorId:productId:serial — identifica la impresora en la BD */
  id: string;
  name: string;
}

/** Clave estable de un dispositivo USB (la misma que guarda la BD en device_key). */
export function usbPrinterId(target: UsbPrinterTarget): string {
  return `${target.vendorId}:${target.productId}:${target.serialNumber ?? ''}`;
}

function toUsbInfo(dev: any): UsbPrinterInfo {
  return {
    id: usbPrinterId({ vendorId: dev.vendorId, productId: dev.productId, serialNumber: dev.serialNumber ?? '' }),
    name: String(dev.productName ?? 'Impresora térmica'),
    vendorId: dev.vendorId,
    productId: dev.productId,
    serialNumber: dev.serialNumber ?? '',
  };
}

function matchesTarget(target: UsbPrinterTarget) {
  return (dev: any) =>
    dev.vendorId === target.vendorId &&
    dev.productId === target.productId &&
    (target.serialNumber ? dev.serialNumber === target.serialNumber : true);
}

let cachedUsb: UsbDeviceRef | null = null;
let usbListenerAttached = false;

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).usb;
}

function getUsbApi(): any {
  if (!isWebUsbSupported()) {
    throw new Error('WebUSB no está disponible. Usa Chrome o Edge con una conexión segura (HTTPS o localhost).');
  }
  const usb = (navigator as any).usb;
  if (!usbListenerAttached) {
    usbListenerAttached = true;
    usb.addEventListener('disconnect', () => { cachedUsb = null; });
  }
  return usb;
}

async function setupUsbDevice(dev: any): Promise<UsbDeviceRef> {
  if (!dev.opened) {
    try { await dev.open(); } catch { /* ya abierto en otra sesión */ }
  }
  try {
    await dev.selectConfiguration(1);
  } catch {
    // Configuración por defecto ya activa
  }
  const iface = dev.configuration?.interfaces?.[0];
  if (!iface) throw new Error('La impresora no expone interfaces configurables');
  // claimInterface es idempotente aquí: si la interfaz ya fue reclamada por esta
  // misma sesión (p. ej. tras pickUsbPrinter o una impresión anterior), se
  // reutiliza sin reclamarla de nuevo (evita InvalidStateError en Chrome).
  if (!iface.claimed) {
    try {
      await dev.claimInterface(iface.interfaceNumber);
    } catch (e: any) {
      throw new Error(`No se pudo acceder a la impresora: ${e?.message ?? 'interfaz ocupada'}`);
    }
  }
  return { dev, iface, name: String(dev.productName ?? 'Impresora térmica') };
}

/** Abre el selector USB del navegador y devuelve la impresora elegida (sin registrarla). */
export async function pickUsbPrinter(): Promise<UsbPrinterInfo> {
  const usb = getUsbApi();
  // filters vacío = mostrar todas las impresoras USB en el selector (Chrome lo soporta)
  const dev = await usb.requestDevice({ filters: [] });
  cachedUsb = await setupUsbDevice(dev);
  return toUsbInfo(dev);
}

/** Localiza y prepara el dispositivo al que se enviará el ticket (puede ser uno específico). */
async function resolveUsbRef(target?: UsbPrinterTarget): Promise<UsbDeviceRef> {
  const usb = getUsbApi();
  // Si el dispositivo ya está preparado en esta sesión y coincide con el objetivo
  // pedido, se reutiliza sin volver a reclamar la interfaz.
  if (cachedUsb && target && matchesTarget(target)(cachedUsb.dev)) {
    return cachedUsb;
  }
  if (target) {
    const granted = await usb.getDevices();
    const matched = granted.find(matchesTarget(target));
    if (matched) {
      cachedUsb = await setupUsbDevice(matched);
      return cachedUsb;
    }
    try {
      const requested = await usb.requestDevice({ filters: [{ vendorId: target.vendorId, productId: target.productId }] });
      cachedUsb = await setupUsbDevice(requested);
      return cachedUsb;
    } catch {
      throw new Error('La impresora asignada para los tickets no está conectada. Conéctala por USB y vuelve a intentarlo.');
    }
  }
  if (!cachedUsb) {
    const granted = await usb.getDevices();
    if (granted.length === 0) {
      throw new Error('Conecta la impresora primero (botón "Conectar impresora" en Configuración)');
    }
    cachedUsb = await setupUsbDevice(granted[0]);
  }
  return cachedUsb;
}

async function sendEscPos(bytes: Uint8Array, target?: UsbPrinterTarget): Promise<void> {
  const { dev, iface } = await resolveUsbRef(target);
  const alt = iface.alternates?.[0];
  const ep = alt?.endpoints?.find((e: any) => e.direction === 'out');
  if (!ep) throw new Error('No se encontró un canal de salida en la impresora');
  await dev.transferOut(ep.endpointNumber, bytes);
}

/** Imprime un ticket de prueba (para Configuración), opcionalmente en una impresora específica. */
export async function printUsbTest(width: '57' | '80', target?: UsbPrinterTarget): Promise<void> {
  const data: ReceiptData = {
    businessName: 'PRUEBA DE IMPRESION',
    saleId: 'TEST-001',
    items: [
      { name: 'Linea de prueba 1', quantity: 2, unit_price: 10.5 },
      { name: 'Linea de prueba 2', quantity: 1, unit_price: 99.0 },
    ],
    total: 120,
    payMethod: 'cash',
    cashAmount: 120,
    transferAmount: 0,
  };
  await sendEscPos(encodeEscPos(data, width), target);
}

/** Impresora asignada para los tickets de venta (registrada en Configuración). */
export async function fetchDefaultTicketPrinter(): Promise<UsbPrinterTarget | null> {
  try {
    const res = await fetch('/api/printers?default=1', { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    const list: Record<string, unknown>[] = Array.isArray(d?.printers) ? d.printers : [];
    const p = list[0];
    if (!p) return null;
    return {
      vendorId: Number(p.vendor_id),
      productId: Number(p.product_id),
      serialNumber: p.serial_number ? String(p.serial_number) : undefined,
    };
  } catch {
    return null;
  }
}

// ── Ensamblado a partir de una venta registrada ─────────────────
/** Construye los datos del ticket desde la fila de venta y sus items. */
export function buildReceiptFromSale(opts: {
  sale: Record<string, unknown>;
  items: Record<string, unknown>[];
  businessName: string;
  logoUrl?: string | null;
  payMethod: ReceiptData['payMethod'];
  cash: number;
  transfer: number;
  notes?: string | null;
  sellerName?: string | null;
}): ReceiptData {
  return {
    businessName: opts.businessName,
    logoUrl: opts.logoUrl ?? null,
    saleId: String(opts.sale.id ?? ''),
    date: opts.sale.date ? String(opts.sale.date) : null,
    customerName: opts.sale.customer_name ? String(opts.sale.customer_name) : null,
    sellerName: opts.sellerName ?? (opts.sale.user_name ? String(opts.sale.user_name) : null),
    posName: opts.sale.pos_name ? String(opts.sale.pos_name) : null,
    items: opts.items.map(i => ({
      name: String(i.product_name ?? 'Producto'),
      quantity: Number(i.quantity ?? 0),
      unit_price: Number(i.unit_price ?? 0),
    })),
    total: Number(opts.sale.total ?? 0),
    payMethod: opts.payMethod,
    cashAmount: opts.cash,
    transferAmount: opts.transfer,
    notes: opts.notes ?? null,
  };
}

// ── Dispatcher ───────────────────────────────────────────────────
export async function printReceipt(
  data: ReceiptData,
  opts: { method: 'browser' | 'usb'; width: '57' | '80'; printer?: UsbPrinterTarget | null }
): Promise<void> {
  if (opts.method === 'usb') {
    await sendEscPos(encodeEscPos(data, opts.width), opts.printer ?? undefined);
  } else {
    printReceiptViaBrowser(buildReceiptHtml(data, opts.width));
  }
}
