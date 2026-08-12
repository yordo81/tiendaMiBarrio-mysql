'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search, ScanBarcode, Minus, Plus, Trash2, ShoppingCart, X, CheckCircle,
  Banknote, Landmark, CreditCard, Wallet, Package, ArrowLeft, History,
  Receipt, AlertTriangle, Loader2, Store, User, Keyboard, Delete,
  TabletSmartphone,
} from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { formatCurrency, formatNumber, cn, findProductByBarcode } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { usePosSelector } from '@/hooks/use-pos';
import { toast } from '@/components/ui/toaster';
import { playScanBeep } from '@/lib/scan-beep';
import { notifyShiftSummaryChanged } from '@/lib/shift-events';
import { printReceipt, buildReceiptFromSale, fetchDefaultTicketPrinter } from '@/lib/receipt';
import Modal from '@/components/ui/Modal';
import SearchableSelect from '@/components/ui/SearchableSelect';
import ThemeToggle from '@/components/ui/ThemeToggle';

// ── Punto de venta táctil ─────────────────────────────────────────
// Interfaz adaptada de "touch-point-shop" para pantallas táctiles:
// búsqueda por código de barras o nombre, catálogo por categorías y
// carrito siempre visible. Exclusiva para el rol vendedor: el resto de
// roles conserva la ventana modal de venta en /dashboard/ventas.

type AnyRecord = Record<string, unknown>;
type PayMethod = 'cash' | 'transfer' | 'mixed' | 'credit';
interface CartLine { product: AnyRecord; quantity: number; unit_price: number; }

const PAY_METHODS: { id: PayMethod; label: string; icon: typeof Banknote; desc: string }[] = [
  { id: 'cash', label: 'Efectivo', icon: Banknote, desc: 'Billetes o monedas' },
  { id: 'transfer', label: 'Transferencia', icon: Landmark, desc: 'Pago bancario' },
  { id: 'mixed', label: 'Mixto', icon: Wallet, desc: 'Efectivo + transferencia' },
  { id: 'credit', label: 'Crédito', icon: CreditCard, desc: 'Se registra como deuda' },
];

// Billetes rápidos para el cálculo de cambio en efectivo (DOP)
const CASH_DENOMS = [100, 200, 500, 1000, 2000];

// ── Borrador del pedido (localStorage, por usuario) ─────────────
// Conserva el pedido en curso entre recargas: líneas con cantidad por
// producto, almacén de salida, cliente y notas. Se limpia al completar
// la venta, al vaciar el carrito o al iniciar una nueva.
const DRAFT_PREFIX = 'tmb-pos-draft';

interface PosDraft {
  v: 1;
  cart: { productId: string; quantity: number }[];
  locationId?: string;
  customerId?: string;
  saleNotes?: string;
  savedAt: number;
}

function draftKey(userId: string) { return `${DRAFT_PREFIX}:${userId}`; }

function loadDraft(userId: string): PosDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as PosDraft;
    if (d?.v !== 1 || !Array.isArray(d.cart)) return null;
    return d;
  } catch { return null; }
}

function saveDraft(userId: string, d: PosDraft) {
  try { localStorage.setItem(draftKey(userId), JSON.stringify(d)); } catch { /* sin almacenamiento */ }
}

function clearDraft(userId: string) {
  try { localStorage.removeItem(draftKey(userId)); } catch { /* sin almacenamiento */ }
}

// Etiqueta visual para atajos de teclado
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
      style={{
        backgroundColor: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-primary)',
        boxShadow: '0 1px 0 var(--border-primary)',
      }}
    >
      {children}
    </kbd>
  );
}

function ProductImage({ product }: { product: AnyRecord }) {
  const [failed, setFailed] = useState(false);
  const url = String(product.image_url ?? '');
  if (!url || failed) {
    return (
      <div
        className="aspect-square w-full rounded-xl flex items-center justify-center border"
        style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-primary)' }}
      >
        <Package className="w-10 h-10" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={String(product.name)}
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-square w-full rounded-xl object-cover"
    />
  );
}

export default function TouchPosPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const settings = useSettingsStore(s => s.settings);
  const settingsLoaded = useSettingsStore(s => s.loaded);
  const loadSettings = useSettingsStore(s => s.load);

  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [customers, setCustomers] = useState<AnyRecord[]>([]);
  const [locations, setLocations] = useState<AnyRecord[]>([]);
  const [locationStock, setLocationStock] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todo');
  const searchRef = useRef<HTMLInputElement>(null);
  // Marca que ya se intentó restaurar el pedido guardado (evita borrarlo
  // con el carrito vacío antes de que carguen los datos)
  const draftRestoredRef = useRef(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [locationId, setLocationId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [cashReceived, setCashReceived] = useState(0);
  const [amountTransfer, setAmountTransfer] = useState(0);
  const [saleNotes, setSaleNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [cartOpen, setCartOpen] = useState(false); // carrito en móvil
  const [keypadOpen, setKeypadOpen] = useState(false); // teclado numérico en pantalla
  const [lastSale, setLastSale] = useState<{ id: string; total: number; change: number; method: PayMethod } | null>(null);

  const isSeller = mounted && user?.role === 'seller';
  const { workMode, posId, setPosId, posOptions, hasOpenShift, resetPos } = usePosSelector(isSeller);

  // Cargar configuración del negocio (nombre/logo) una sola vez
  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { setMounted(true); }, []);

  // Guard de acceso: solo vendedores. El resto vuelve a la página de
  // ventas con la ventana modal.
  useEffect(() => {
    if (!mounted) return;
    if (!user) { router.replace('/dashboard'); return; }
    if (user.role !== 'seller') { router.replace('/dashboard/ventas'); return; }
  }, [mounted, user, router]);

  // Cargar productos, clientes y almacenes
  useEffect(() => {
    if (!isSeller) return;
    let alive = true;
    Promise.all([api.getProducts(), api.getCustomers(), api.getLocations()])
      .then(([p, c, l]) => {
        if (!alive) return;
        setProducts(p);
        setCustomers(c);
        setLocations(l);
        setLocationId(prev => prev || (l.length > 0 ? String(l[0].id) : ''));
      })
      .catch(() => toast.error('Error al cargar datos'));
    return () => { alive = false; };
  }, [isSeller]);

  // Enfocar la búsqueda al entrar para escanear de inmediato
  useEffect(() => {
    if (isSeller) setTimeout(() => searchRef.current?.focus(), 150);
  }, [isSeller]);

  // ── Venta rápida por teclado ──────────────────────────────────
  // Atajos globales: F1 busca · F4 vacía · F9 cobra · Esc limpia ·
  // +/− ajusta la cantidad del último artículo · Enter agrega.
  // No interfiere mientras se escribe en un input.
  useEffect(() => {
    if (!isSeller) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      // En la pantalla de éxito, Enter o Escape inician una nueva venta
      if (lastSale) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          resetSale();
          setLastSale(null);
          setTimeout(() => searchRef.current?.focus(), 50);
        }
        return;
      }
      // El modal de cobro gestiona sus propias teclas
      if (showPay) return;
      // Con el teclado en pantalla abierto se sigue aceptando la entrada
      // física: dígitos/asterisco alimentan la búsqueda y Enter confirma,
      // para que el lector de código de barras no deje de funcionar.
      if (keypadOpen) {
        if (e.key === 'Escape') { setKeypadOpen(false); return; }
        if (e.key === 'Enter') { e.preventDefault(); commitSearch(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); setQuery(q => q.slice(0, -1)); return; }
        if (e.key.length === 1 && /^[\d*]$/.test(e.key)) {
          e.preventDefault();
          setQuery(q => (q ? q + e.key : (e.key === '*' ? q : e.key)));
        }
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        setKeypadOpen(true);
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        if (cart.length > 0) emptyCart();
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length === 0) {
          toast.info('El pedido está vacío');
          return;
        }
        if (hasStockIssues()) {
          toast.error('Revisa el stock del pedido antes de cobrar');
          return;
        }
        setShowPay(true);
        setCartOpen(false);
        return;
      }
      if (e.key === 'Escape') {
        if (cartOpen) { setCartOpen(false); return; }
        if (query) {
          setQuery('');
          searchRef.current?.focus();
        }
        return;
      }
      // + / − sobre el último artículo del carrito (solo fuera de inputs)
      if (!inInput && (e.key === '+' || e.key === '=' || e.key === '-') && cart.length > 0) {
        const last = cart[cart.length - 1];
        e.preventDefault();
        changeQty(last.product.id, e.key === '-' ? -1 : 1);
        return;
      }
      // Enter fuera de un input: agrega la coincidencia de la búsqueda
      if (!inInput && e.key === 'Enter' && query.trim()) {
        e.preventDefault();
        commitSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSeller, cart, query, cartOpen, keypadOpen, showPay, lastSale, locations]);

  // Stock por almacén de salida
  useEffect(() => {
    if (!locationId) { setLocationStock({}); return; }
    api.getLocationStock(locationId)
      .then(rows => {
        const map: Record<string, number> = {};
        (rows as { product_id: string; quantity: number }[]).forEach(r => {
          map[r.product_id] = Number(r.quantity);
        });
        setLocationStock(map);
      })
      .catch(() => setLocationStock({}));
  }, [locationId]);

  // ── Restaurar el pedido guardado tras recargar la página ─────
  useEffect(() => {
    if (!isSeller || !user || draftRestoredRef.current) return;
    if (products.length === 0) return; // esperar a que carguen los datos
    draftRestoredRef.current = true;
    const draft = loadDraft(user.id);
    if (!draft || draft.cart.length === 0) return;
    const byId = new Map(products.map(p => [String(p.id), p]));
    const lines: CartLine[] = [];
    draft.cart.forEach(({ productId, quantity }) => {
      const p = byId.get(productId);
      if (!p) return;
      const qty = Math.max(0.01, Number(quantity) || 1);
      // Tope por stock global para no restaurar cantidades imposibles; el
      // stock por almacén se valida al cobrar (hasStockIssues).
      const globalStock = Number(p.stock ?? 0);
      lines.push({ product: p, quantity: globalStock > 0 ? Math.min(qty, globalStock) : qty, unit_price: Number(p.sale_price) });
    });
    if (lines.length === 0) return;
    setCart(lines);
    if (draft.locationId && locations.some(l => String(l.id) === draft.locationId)) {
      setLocationId(draft.locationId);
    }
    if (draft.customerId && customers.some(c => String(c.id) === draft.customerId)) {
      setCustomerId(draft.customerId);
    }
    setSaleNotes(draft.saleNotes ?? '');
    toast.info('Pedido en curso restaurado');
  }, [isSeller, user, products, locations, customers]);

  // ── Guardar el pedido en curso en cada cambio ─────────────────
  useEffect(() => {
    if (!isSeller || !user || !draftRestoredRef.current) return;
    if (cart.length === 0) return;
    saveDraft(user.id, {
      v: 1,
      cart: cart.map(i => ({ productId: String(i.product.id), quantity: i.quantity })),
      locationId: locationId || undefined,
      customerId: customerId || undefined,
      saleNotes: saleNotes || undefined,
      savedAt: Date.now(),
    });
  }, [isSeller, user, cart, locationId, customerId, saleNotes]);

  const getAvailableStock = useCallback((product: AnyRecord): number => {
    if (locationId) {
      // Con almacén de salida seleccionado se usa el stock específico de ese
      // almacén. Si el producto no tiene registro allí (la API lo elimina al
      // agotarse), se considera agotado (0) y no se muestra ni se puede vender.
      return locationStock[String(product.id)] ?? 0;
    }
    return Number(product.stock ?? 0);
  }, [locationId, locationStock]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      const c = String(p.category_name ?? '').trim();
      if (c) set.add(c);
    });
    return ['Todo', ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter(p => {
        const inCat = category === 'Todo' || String(p.category_name ?? '') === category;
        const inQuery = !q
          || String(p.name).toLowerCase().includes(q)
          || String(p.barcode ?? '').toLowerCase().includes(q);
        // Solo productos con existencia en el almacén de salida
        return inCat && inQuery && getAvailableStock(p) > 0;
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [products, query, category, getAvailableStock]);

  const cartTotal = cart.reduce((a, i) => a + i.quantity * i.unit_price, 0);
  const cartCount = cart.reduce((a, i) => a + i.quantity, 0);

  function hasStockIssues(): boolean {
    return cart.some(i => i.quantity > getAvailableStock(i.product));
  }

  // Agrega un producto al carrito. Con qty>1 (venta rápida por teclado)
  // se respeta el stock disponible y se avisa si la cantidad se recorta.
  // La cantidad se calcula dentro del updater para no perder incrementos
  // con llamadas rápidas (doble Enter o escáner + clic).
  function addToCart(p: AnyRecord, qty = 1) {
    const avail = getAvailableStock(p);
    if (avail <= 0) {
      toast.error(`${String(p.name)} está agotado`);
      return;
    }
    const ex = cart.find(i => i.product.id === p.id);
    if (ex && ex.quantity >= avail) {
      toast.warning(`Stock máximo alcanzado para ${String(p.name)} (${formatNumber(avail, 1)})`);
    } else if (!ex && qty > avail) {
      toast.warning(`Solo hay ${formatNumber(avail, 1)} disponibles de ${String(p.name)}`);
    }
    setCart(prev => {
      const found = prev.find(i => i.product.id === p.id);
      const nextQty = Math.min((found?.quantity ?? 0) + qty, avail);
      if (found) {
        return prev.map(i => i.product.id === p.id ? { ...i, quantity: nextQty } : i);
      }
      return [...prev, { product: p, quantity: nextQty, unit_price: Number(p.sale_price) }];
    });
    playScanBeep();
  }

  function changeQty(id: unknown, delta: number) {
    const line = cart.find(i => i.product.id === id);
    if (!line) return;
    const avail = getAvailableStock(line.product);
    if (delta > 0 && line.quantity >= avail) {
      toast.warning(`Stock máximo alcanzado (${formatNumber(avail, 1)})`);
      return;
    }
    setCart(prev =>
      prev
        .map(i => i.product.id === id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
        .filter(i => i.quantity > 0)
    );
  }

  function removeLine(id: unknown) {
    setCart(prev => prev.filter(i => i.product.id !== id));
  }

  // Ejecuta la búsqueda o el ingreso rápido por teclado. Soporta:
  //  - código de barras exacto             → 75012345
  //  - cantidad + código                   → 2*75012345 (o 2x75012345)
  //  - nombre con coincidencia única       → arroz
  function commitSearch() {
    const q = query.trim();
    if (!q) return;
    // Sintaxis de cantidad: N*CODIGO o NxCODIGO
    const m = q.match(/^(\d+)\s*[*x]\s*(.+)$/i);
    if (m) {
      const qty = Math.max(1, parseInt(m[1], 10) || 1);
      const rest = m[2].trim();
      const exact = findProductByBarcode(products, rest);
      if (exact) {
        if (getAvailableStock(exact) <= 0) {
          toast.error(`${String(exact.name)} está agotado en este almacén`);
          return;
        }
        addToCart(exact, qty);
        setQuery('');
        searchRef.current?.focus();
        return;
      }
      const byName = products.filter(p => getAvailableStock(p) > 0 && String(p.name).toLowerCase().includes(rest.toLowerCase()));
      if (byName.length === 1) {
        addToCart(byName[0], qty);
        setQuery('');
        searchRef.current?.focus();
        return;
      }
      toast.error(`No se encontró "${rest}"`);
      return;
    }
    const exact = findProductByBarcode(products, q);
    if (exact) {
      if (getAvailableStock(exact) <= 0) {
        toast.error(`${String(exact.name)} está agotado en este almacén`);
        return;
      }
      addToCart(exact);
      setQuery('');
      searchRef.current?.focus();
      return;
    }
    if (filteredProducts.length === 1) {
      addToCart(filteredProducts[0]);
      setQuery('');
      searchRef.current?.focus();
      return;
    }
    // Sin coincidencia exacta: el grid ya muestra los resultados filtrados
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    commitSearch();
  }

  // Vacía el carrito y elimina el pedido guardado en el navegador
  function emptyCart() {
    setCart([]);
    if (user) clearDraft(user.id);
  }

  function resetSale() {
    emptyCart();
    setLocationId(locations.length > 0 ? String(locations[0].id) : '');
    setCustomerId('');
    setPayMethod('cash');
    setCashReceived(0);
    setAmountTransfer(0);
    setSaleNotes('');
    resetPos();
  }

  // Efectivo que aplica al total según el método (para el cálculo de cambio)
  const cashDue = payMethod === 'cash' ? cartTotal : payMethod === 'mixed' ? (amountTransfer > 0 ? cartTotal - amountTransfer : 0) : 0;
  const change = cashReceived - cashDue;

  async function printSaleTicket(res: unknown, total: number) {
    await loadSettings();
    const s = useSettingsStore.getState().settings;
    if (s?.receipt_auto_print === false) return;
    try {
      const r = res as AnyRecord;
      const method = s?.receipt_print_method ?? 'browser';
      const printer = method === 'usb' ? await fetchDefaultTicketPrinter() : null;
      await printReceipt(
        buildReceiptFromSale({
          sale: r,
          items: (r.items ?? []) as AnyRecord[],
          businessName: s?.business_name ?? 'TiendaMiBarrio',
          logoUrl: s?.logo_url ?? null,
          payMethod,
          cash: payMethod === 'cash' ? total : payMethod === 'mixed' ? cartTotal - amountTransfer : 0,
          transfer: payMethod === 'transfer' ? total : payMethod === 'mixed' ? amountTransfer : 0,
          notes: saleNotes || null,
        }),
        { method, width: s?.receipt_printer_width ?? '80', printer }
      );
    } catch (e) {
      toast.error(`Venta registrada, pero no se pudo imprimir el ticket: ${e instanceof Error ? e.message : 'error desconocido'}`);
    }
  }

  async function handleConfirm() {
    if (cart.length === 0) return;
    if (payMethod === 'credit' && !customerId) {
      toast.error('Las ventas a crédito requieren cliente');
      return;
    }
    if (payMethod === 'mixed') {
      if (amountTransfer <= 0 || amountTransfer >= cartTotal) {
        toast.error('Indica un monto de transferencia menor que el total');
        return;
      }
    }
    const stockErrors = cart.filter(i => i.quantity > getAvailableStock(i.product));
    if (stockErrors.length > 0) {
      const names = stockErrors.map(i => `${String(i.product.name)} (disponible: ${formatNumber(getAvailableStock(i.product), 1)}, solicitado: ${formatNumber(i.quantity, 1)})`).join(', ');
      toast.error(`Stock insuficiente: ${names}`);
      return;
    }
    setSaving(true);
    try {
      const total = cartTotal;
      const res = await api.createSale({
        items: cart.map(i => ({
          product_id: i.product.id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          cost: Number(i.product.cost ?? 0),
        })),
        payment: {
          method: payMethod,
          amount_cash: payMethod === 'cash' ? total : payMethod === 'mixed' ? cartTotal - amountTransfer : 0,
          amount_transfer: payMethod === 'transfer' ? total : payMethod === 'mixed' ? amountTransfer : 0,
        },
        customer_id: customerId || null,
        location_id: locationId || null,
        pos_id: workMode === 'shifts' ? posId || null : null,
        notes: saleNotes || null,
      });
      toast.success('Venta registrada');
      notifyShiftSummaryChanged();
      await printSaleTicket(res, total);
      // Actualizar el stock mostrado para la siguiente venta
      Promise.all([api.getProducts(), locationId ? api.getLocationStock(locationId) : Promise.resolve([])])
        .then(([p, stockRows]) => {
          setProducts(p);
          const map: Record<string, number> = {};
          (stockRows as { product_id: string; quantity: number }[]).forEach(r => {
            map[r.product_id] = Number(r.quantity);
          });
          setLocationStock(map);
        })
        .catch(() => {});
      const changeAmt = cashReceived > cashDue ? cashReceived - cashDue : 0;
      // La venta quedó registrada: ya no debe restaurarse este pedido
      if (user) clearDraft(user.id);
      setLastSale({ id: String((res as AnyRecord).id ?? ''), total, change: changeAmt, method: payMethod });
      setShowPay(false);
      setCartOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar la venta');
    } finally {
      setSaving(false);
    }
  }

  function renderCart() {
    return (
      <>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-14 text-center px-4">
              <ShoppingCart className="w-10 h-10 mb-3" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Escanea o toca un producto para agregarlo al pedido.
              </p>
            </div>
          ) : (
            cart.map(line => (
              <div key={String(line.product.id)} className="flex items-center gap-3 rounded-xl border p-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                <div className="w-12 h-12 flex-shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-primary)' }}>
                  <ProductImage product={line.product} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{String(line.product.name)}</p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {formatCurrency(line.unit_price)}
                    {line.product.unit ? <span className="uppercase"> / {String(line.product.unit)}</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border p-1" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-secondary)' }}>
                  <button
                    aria-label={`Quitar una unidad de ${String(line.product.name)}`}
                    onClick={() => changeQty(line.product.id, -1)}
                    className="flex w-8 h-8 items-center justify-center rounded-md text-sm active:bg-[var(--bg-muted)]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-7 text-center text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{formatNumber(line.quantity, 0)}</span>
                  <button
                    aria-label={`Agregar una unidad de ${String(line.product.name)}`}
                    onClick={() => changeQty(line.product.id, 1)}
                    className="flex w-8 h-8 items-center justify-center rounded-md text-sm active:bg-[var(--bg-muted)]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="hidden xs:flex w-20 justify-end text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {formatCurrency(line.quantity * line.unit_price)}
                </div>
                <button
                  aria-label={`Eliminar ${String(line.product.name)} del pedido`}
                  onClick={() => removeLine(line.product.id)}
                  className="p-1.5 rounded-md transition-colors hover:text-red-400"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="border-t p-4 sm:p-5 space-y-3" style={{ borderColor: 'var(--border-primary)' }}>
          {(() => {
            const issues = hasStockIssues();
            return (
              <>
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span>Artículos</span>
                  <span>{formatNumber(cartCount, 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Total</span>
                  <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(cartTotal)}</span>
                </div>
                {issues && !saving && (
                  <p className="text-xs flex items-center gap-1.5 text-red-400">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    Algunos productos exceden el stock disponible. Revisa el pedido.
                  </p>
                )}
                <button
                  onClick={() => { setShowPay(true); setCartOpen(false); }}
                  disabled={cart.length === 0 || issues || saving}
                  className="w-full rounded-xl py-4 text-lg font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-40 shadow-lg"
                  style={{ backgroundColor: 'var(--brand-600)', boxShadow: '0 10px 25px -5px color-mix(in srgb, var(--brand-500) 40%, transparent)' }}
                >
                  {saving ? 'Registrando...' : `Cobrar ${cart.length > 0 ? formatCurrency(cartTotal) : ''}`}
                </button>
              </>
            );
          })()}
        </div>
      </>
    );
  }

  // ── Módulo desactivado desde Configuración ──
  // El dueño puede ocultar el POS táctil (Configuración → Operación →
  // Módulos del sistema): la página muestra un aviso con salida a Ventas.
  if (isSeller && settingsLoaded && settings?.enable_touch_pos === false) {
    return (
      <div className="flex h-screen items-center justify-center p-6" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="card w-full max-w-md">
          <EmptyState
            icon={TabletSmartphone}
            title="POS táctil desactivado"
            description="El punto de venta táctil está desactivado. Registra tus ventas desde la página de ventas, o pídele al dueño activarlo en Configuración → Operación → Módulos del sistema."
            action={<Link href="/dashboard/ventas" className="btn-primary">Ir a Ventas</Link>}
          />
        </div>
      </div>
    );
  }

  // ── Guard de acceso: pantalla de carga mientras se valida ──
  if (!isSeller) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--brand-500)' }} />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden select-none" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* ── Encabezado ── */}
      <header className="flex items-center justify-between gap-3 border-b px-4 sm:px-6 h-14 flex-shrink-0" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
            {settings?.logo_url ? (
              <img src={settings.logo_url} alt="" className="w-full h-full object-contain p-0.5" />
            ) : (
              <Store className="w-4 h-4 text-white" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold truncate leading-tight" style={{ color: 'var(--text-primary)' }}>
              {settings?.business_name ?? 'TiendaMiBarrio'}
            </p>
            <p className="text-[10px] uppercase tracking-wider truncate" style={{ color: 'var(--text-tertiary)' }}>
              Punto de venta táctil
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center" title="Cambiar tema">
            <ThemeToggle compact />
          </div>
          <Link
            href="/dashboard/ventas"
            className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <History className="w-4 h-4" />
            Historial
          </Link>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Salir</span>
          </Link>
          <div className="hidden md:flex items-center gap-2 pl-2 ml-1 border-l" style={{ borderColor: 'var(--border-primary)' }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <User className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{String(user?.name ?? 'Vendedor')}</span>
          </div>
        </div>
      </header>

      {/* ── Cuerpo ── */}
      <div className="flex min-h-0 flex-1">
        {/* Columna principal: búsqueda + catálogo */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-5">
            <div className="flex items-start gap-3">
            <form onSubmit={handleSearchSubmit} className="relative flex items-center flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-4 w-5 h-5" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
              <label htmlFor="pos-search" className="sr-only">Buscar por código de barras o nombre</label>
              <input
                id="pos-search"
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                type="text"
                inputMode="search"
                autoComplete="off"
                placeholder="Escanea el código de barras o busca por nombre..."
                className="w-full rounded-xl py-4 pl-12 pr-36 text-base font-medium placeholder:opacity-70 focus:outline-none"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderColor: 'var(--border-primary)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--brand-500)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
              />
              <button
                type="submit"
                className="absolute right-2 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-transform active:scale-95"
              >
                <ScanBarcode className="w-4 h-4" aria-hidden="true" />
                Escanear
              </button>
            </form>
            {/* Teclado numérico en pantalla para venta rápida */}
            <button
              type="button"
              onClick={() => setKeypadOpen(true)}
              className="hidden sm:flex items-center gap-2 rounded-xl px-3.5 py-3.5 text-sm font-medium transition-transform active:scale-95 flex-shrink-0"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
              title="Teclado numérico en pantalla (F2)"
            >
              <Keyboard className="w-4 h-4" aria-hidden="true" />
              <span className="hidden xl:inline">Teclado</span>
            </button>
            {/* Almacén de salida: el catálogo se filtra por este almacén */}
            <div className="hidden md:block w-52 flex-shrink-0 pt-0.5">
              <SearchableSelect
                options={locations.map(l => ({ value: String(l.id), label: String(l.name) }))}
                value={locationId}
                onChange={v => setLocationId(v)}
                placeholder="Almacén…"
                noResultsMessage="Sin almacenes"
              />
            </div>
            </div>

            <div className="flex gap-2.5 overflow-x-auto pb-2 pt-4 [scrollbar-width:none]">
              {categories.map(c => {
                const active = c === category;
                return (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      'flex-none rounded-full px-5 py-2.5 text-sm font-medium transition-transform active:scale-95',
                      active ? 'text-white' : ''
                    )}
                    style={
                      active
                        ? { backgroundColor: 'var(--brand-600)', color: '#fff' }
                        : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }
                    }
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            {/* Atajos de teclado */}
            <div className="hidden xl:flex items-center gap-3 pb-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              <span className="flex items-center gap-1"><Kbd>F1</Kbd> Buscar</span>
              <span className="flex items-center gap-1"><Kbd>F2</Kbd> Teclado</span>
              <span className="flex items-center gap-1"><Kbd>F4</Kbd> Vaciar</span>
              <span className="flex items-center gap-1"><Kbd>F9</Kbd> Cobrar</span>
              <span className="flex items-center gap-1"><Kbd>Esc</Kbd> Limpiar</span>
              <span className="flex items-center gap-1"><Kbd>+ / −</Kbd> Cantidad</span>
              <span className="flex items-center gap-1"><Kbd>2*7501</Kbd> Cantidad por código</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6 pt-2">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Package className="w-12 h-12 mb-3" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  {query ? `No se encontraron productos para "${query}" en este almacén.` : 'Sin productos disponibles en este almacén.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
                {filteredProducts.map(p => {
                  const avail = getAvailableStock(p);
                  const min = Number(p.min_stock ?? 0);
                  const low = avail > 0 && avail <= min;
                  return (
                    <button
                      key={String(p.id)}
                      onClick={() => addToCart(p)}
                      className="flex flex-col gap-3 rounded-2xl p-3 text-left transition-transform active:scale-[0.97] hover:-translate-y-0.5"
                      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
                    >
                      <div className="relative">
                        <ProductImage product={p} />
                        {low && (
                          <span className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-500/90 text-black">
                            Bajo stock
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col justify-between gap-1">
                        <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>{String(p.name)}</p>
                        <div>
                          <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                            {formatCurrency(Number(p.sale_price))}
                            {p.unit ? <span className="text-[10px] font-normal uppercase ml-1" style={{ color: 'var(--text-tertiary)' }}>{String(p.unit)}</span> : null}
                          </p>
                          <p className="mt-0.5 text-[10px] uppercase tracking-widest truncate" style={{ color: 'var(--text-tertiary)' }}>
                            {String(p.barcode ?? '')}
                          </p>
                          <p className="mt-0.5 text-[10px]" style={{ color: low ? '#e3b341' : 'var(--text-tertiary)' }}>
                            Stock: {formatNumber(avail, 1)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* Carrito (escritorio) */}
        <aside
          className="hidden lg:flex w-[360px] xl:w-[400px] flex-col border-l flex-shrink-0"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}
        >
          <div className="flex items-center justify-between border-b px-5 py-4 flex-shrink-0" style={{ borderColor: 'var(--border-primary)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Pedido actual
              {cartCount > 0 && (
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: 'var(--brand-600)' }}>
                  {formatNumber(cartCount, 0)}
                </span>
              )}
            </h2>
            {cart.length > 0 && (
              <button
                onClick={emptyCart}
                className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-red-400"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                Vaciar
              </button>
            )}
          </div>
          {renderCart()}
        </aside>
      </div>

      {/* Botón flotante del carrito (móvil/tablet) */}
      {cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="lg:hidden fixed bottom-5 right-4 z-30 flex items-center gap-2 rounded-full px-5 py-3.5 text-white font-semibold shadow-2xl active:scale-95 transition-transform"
          style={{ backgroundColor: 'var(--brand-600)' }}
        >
          <ShoppingCart className="w-5 h-5" />
          {formatNumber(cartCount, 0)} · {formatCurrency(cartTotal)}
        </button>
      )}

      {/* Carrito en pantalla completa (móvil/tablet) */}
      {cartOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="flex items-center justify-between border-b px-4 py-3.5 flex-shrink-0" style={{ borderColor: 'var(--border-primary)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Pedido actual</h2>
            <div className="flex items-center gap-2">
              {cart.length > 0 && (
                <button
                  onClick={emptyCart}
                  className="text-xs font-medium px-2 py-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Vaciar
                </button>
              )}
              <button onClick={() => setCartOpen(false)} className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors" style={{ color: 'var(--text-tertiary)' }} aria-label="Cerrar pedido">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          {renderCart()}
        </div>
      )}

      {/* ── Teclado numérico en pantalla (venta rápida) ── */}
      <Modal open={keypadOpen} onClose={() => setKeypadOpen(false)} title="Venta rápida por teclado" size="sm">
        <div className="space-y-3">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            Escribe el <b style={{ color: 'var(--text-primary)' }}>código</b> y pulsa Agregar. Usa{' '}
            <b style={{ color: 'var(--text-primary)' }}>2*75012345</b> para agregar 2 unidades.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-xl border px-3 py-2.5 text-base font-semibold truncate"
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: query ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
              {query || 'Código…'}
            </div>
            <button
              type="button"
              onClick={() => setQuery(q => q.slice(0, -1))}
              className="p-3 rounded-xl transition-transform active:scale-95 flex-shrink-0"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
              aria-label="Borrar último carácter"
            >
              <Delete className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9','×','0','C'].map(k => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (k === 'C') setQuery('');
                  else if (k === '×') setQuery(q => (q ? q + '*' : q));
                  else setQuery(q => q + k);
                }}
                className="h-14 rounded-xl text-xl font-semibold transition-transform active:scale-95"
                style={{
                  backgroundColor: k === '×' ? 'var(--brand-600)' : 'var(--bg-secondary)',
                  color: k === '×' ? '#fff' : 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { commitSearch(); }}
            className="btn-primary w-full py-3.5 text-base"
          >
            <ScanBarcode className="w-4 h-4" aria-hidden="true" />
            Agregar
          </button>
        </div>
      </Modal>

      {/* ── Modal de cobro ── */}
      <Modal open={showPay} onClose={() => setShowPay(false)} title="Cobrar pedido" size="xl">
        <div className="space-y-5">
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 rounded-xl border p-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Total a cobrar</p>
              <p className="text-2xl font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{formatCurrency(cartTotal)}</p>
            </div>
            <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Artículos</p>
              <p className="text-2xl font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{formatNumber(cartCount, 0)}</p>
            </div>
          </div>

          {/* Caja (modo turnos) */}
          {workMode === 'shifts' && (
            <div>
              <label className="label">Caja (punto de venta)</label>
              <SearchableSelect
                options={posOptions.map(p => ({
                  value: String(p.id),
                  label: String(p.name),
                  sublabel: hasOpenShift(String(p.id))
                    ? (p.location_name ? `Turno abierto · ${String(p.location_name)}` : 'Turno abierto')
                    : (p.location_name ? String(p.location_name) : undefined),
                }))}
                value={posId}
                onChange={setPosId}
                placeholder="Selecciona la caja…"
                noResultsMessage="No hay cajas creadas"
              />
              {posId && !hasOpenShift(posId) && (
                <p className="text-[10px] text-yellow-400 mt-1">Esta caja no tiene un turno abierto. La venta no se incluirá en ningún arqueo.</p>
              )}
            </div>
          )}

          {/* Almacén de salida */}
          <div>
            <label className="label">Almacén de salida *</label>
            <SearchableSelect
              options={locations.map(l => ({ value: String(l.id), label: String(l.name) }))}
              value={locationId}
              onChange={v => setLocationId(v)}
              placeholder={locations.length === 0 ? 'Cargando ubicaciones...' : 'Seleccionar almacén'}
              noResultsMessage="Sin almacenes"
            />
          </div>

          {/* Método de pago */}
          <div>
            <label className="label">Método de pago</label>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
              {PAY_METHODS.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setPayMethod(m.id); setCashReceived(0); setAmountTransfer(0); }}
                  className={cn(
                    'rounded-xl border p-3.5 text-left transition-all active:scale-[0.97]',
                    payMethod === m.id ? 'text-white shadow-lg' : 'hover:brightness-105'
                  )}
                  style={
                    payMethod === m.id
                      ? { backgroundColor: 'var(--brand-600)', borderColor: 'var(--brand-600)', boxShadow: '0 10px 20px -8px color-mix(in srgb, var(--brand-500) 50%, transparent)' }
                      : { backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }
                  }
                >
                  <m.icon className={cn('w-6 h-6 mb-2', payMethod === m.id ? 'text-white' : 'text-brand-400')} />
                  <p className={cn('font-semibold text-sm', payMethod !== m.id && 'text-[var(--text-primary)]')}>{m.label}</p>
                  <p className={cn('text-[10px] mt-0.5', payMethod === m.id ? 'text-white/70' : 'text-[var(--text-tertiary)]')}>{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Efectivo recibido + cambio */}
          {(payMethod === 'cash' || payMethod === 'mixed') && (
            <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
              <div className="flex items-center justify-between">
                <label className="label mb-0">Efectivo recibido</label>
                <button
                  onClick={() => setCashReceived(payMethod === 'cash' ? cartTotal : cashDue)}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-white transition-transform active:scale-95"
                  style={{ backgroundColor: 'var(--brand-600)' }}
                >
                  Exacto
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="1"
                className="input text-2xl font-bold text-center"
                placeholder="0.00"
                value={cashReceived || ''}
                onChange={e => setCashReceived(parseFloat(e.target.value) || 0)}
              />
              <div className="flex flex-wrap gap-2">
                {CASH_DENOMS.map(d => (
                  <button
                    key={d}
                    onClick={() => setCashReceived(v => (v || 0) + d)}
                    className="px-3.5 py-2 rounded-lg text-sm font-semibold transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                  >
                    +{formatCurrency(d)}
                  </button>
                ))}
              </div>
              {cashReceived > 0 && (
                <p className={cn('text-sm font-semibold flex items-center gap-1.5', change >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {change >= 0 ? <>Cambio: {formatCurrency(change)}</> : <>Faltan: {formatCurrency(-change)}</>}
                </p>
              )}
            </div>
          )}

          {/* Mixto: monto por transferencia */}
          {payMethod === 'mixed' && (
            <div>
              <label className="label">Monto por transferencia</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input text-lg font-semibold"
                placeholder="0.00"
                value={amountTransfer || ''}
                onChange={e => setAmountTransfer(parseFloat(e.target.value) || 0)}
              />
              {amountTransfer > 0 && amountTransfer < cartTotal && (
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  El resto ({formatCurrency(cartTotal - amountTransfer)}) se cobra en efectivo.
                </p>
              )}
              {amountTransfer >= cartTotal && (
                <p className="text-[10px] text-yellow-400 mt-1">⚠ La transferencia no puede cubrir más del total.</p>
              )}
            </div>
          )}

          {payMethod === 'transfer' && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Se cobrará el total ({formatCurrency(cartTotal)}) por transferencia bancaria.
            </div>
          )}

          {/* Cliente */}
          <div>
            <label className="label">
              Cliente {payMethod === 'credit' && <span className="text-red-400 normal-case">* (obligatorio en crédito)</span>}
            </label>
            <SearchableSelect
              options={[
                { value: '', label: 'Sin cliente' },
                ...customers.map(c => ({
                  value: String(c.id),
                  label: String(c.name),
                  sublabel: Number(c.balance) > 0 ? `Debe ${formatCurrency(Number(c.balance))}` : undefined,
                })),
              ]}
              value={customerId}
              onChange={v => setCustomerId(v)}
              placeholder="Sin cliente"
              noResultsMessage="Sin clientes"
            />
          </div>

          {payMethod === 'credit' && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-400">
              ⚠ Se registrará como deuda a favor del cliente. Debes seleccionar un cliente.
            </div>
          )}

          {/* Notas */}
          <div>
            <label className="label">Notas</label>
            <input className="input" placeholder="Notas opcionales..." value={saleNotes} onChange={e => setSaleNotes(e.target.value)} />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => setShowPay(false)} className="btn-secondary flex-1 py-3.5 text-base">Volver</button>
            <button
              onClick={handleConfirm}
              disabled={saving || cart.length === 0 || hasStockIssues()}
              className="btn-primary flex-1 py-3.5 text-base disabled:opacity-50"
            >
              {saving ? 'Registrando...' : `Confirmar — ${formatCurrency(cartTotal)}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Pantalla de éxito ── */}
      {lastSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 92%, transparent)' }}>
          <div className="w-full max-w-md rounded-2xl border p-8 text-center shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', animation: 'slide-down 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <div className="mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-5 bg-green-500/10 border border-green-500/30">
              <CheckCircle className="w-11 h-11 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>¡Venta registrada!</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Ticket {lastSale.id ? `#${lastSale.id.slice(0, 8).toUpperCase()}` : ''} · {PAY_METHODS.find(m => m.id === lastSale.method)?.label}
            </p>
            <div className="my-6 space-y-2">
              <div className="flex justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
                <span>Total</span>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(lastSale.total)}</span>
              </div>
              {lastSale.change > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Cambio</span>
                  <span className="font-bold text-green-400">{formatCurrency(lastSale.change)}</span>
                </div>
              )}
            </div>
            <div className="space-y-2.5">
              <button
                onClick={() => { resetSale(); setLastSale(null); searchRef.current?.focus(); }}
                className="btn-primary w-full py-4 text-base"
              >
                <Receipt className="w-5 h-5" />
                Nueva venta
              </button>
              <Link href="/dashboard/ventas" className="btn-secondary w-full py-4 text-base">
                <History className="w-5 h-5" />
                Ver historial
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
