'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search, ScanBarcode, Minus, Plus, Trash2, ShoppingCart, X, CheckCircle,
  Banknote, Landmark, Wallet, Package, History,
  Receipt, AlertTriangle, Loader2, Store, User, Keyboard, Delete,
  TabletSmartphone, Phone, PhoneOff, ChevronDown, KeyRound, LogOut, Play, Square, Clock3,
} from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { formatCurrency, formatNumber, cn, findProductByBarcode, formatDateTime } from '@/lib/utils';
import { normalizePhone } from '@/lib/validate';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { usePosSelector } from '@/hooks/use-pos';
import { toast } from '@/components/ui/toaster';
import { playScanBeep } from '@/lib/scan-beep';
import { notifyShiftChanged, notifyShiftSummaryChanged, SHIFT_CHANGED_EVENT, SHIFT_SUMMARY_CHANGED_EVENT } from '@/lib/shift-events';
import { printReceipt, buildReceiptFromSale, fetchDefaultTicketPrinter } from '@/lib/receipt';
import Modal from '@/components/ui/Modal';
import SearchableSelect from '@/components/ui/SearchableSelect';
import ThemeToggle from '@/components/ui/ThemeToggle';
import OpenShiftModal from '@/components/shifts/OpenShiftModal';
import ChangePasswordModal from '@/components/users/ChangePasswordModal';

// ── Punto de venta táctil ─────────────────────────────────────────
// Interfaz adaptada de "touch-point-shop" para pantallas táctiles:
// búsqueda por código de barras o nombre, catálogo por categorías y
// carrito siempre visible. Exclusiva para el rol vendedor: el resto de
// roles conserva la ventana modal de venta en /dashboard/ventas.

type AnyRecord = Record<string, unknown>;
type PayMethod = 'cash' | 'transfer' | 'mixed';
interface CartLine { product: AnyRecord; quantity: number; unit_price: number; }

const PAY_METHODS: { id: PayMethod; label: string; icon: typeof Banknote; desc: string }[] = [
  { id: 'cash', label: 'Efectivo', icon: Banknote, desc: 'Billetes o monedas' },
  { id: 'transfer', label: 'Transferencia', icon: Landmark, desc: 'Pago bancario' },
  { id: 'mixed', label: 'Mixto', icon: Wallet, desc: 'Efectivo + transferencia' },
];

// Billetes rápidos para el cálculo de cambio en efectivo (DOP)
const CASH_DENOMS = [100, 200, 500, 1000, 2000];

// ── Borrador del pedido (localStorage, por usuario) ─────────────
// Conserva el pedido en curso entre recargas: líneas con cantidad por
// producto y almacén de salida. Se limpia al completar la venta, al
// vaciar el carrito o al iniciar una nueva.
const DRAFT_PREFIX = 'tmb-pos-draft';

interface PosDraft {
  v: 1;
  cart: { productId: string; quantity: number }[];
  locationId?: string;
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
  const { user, setUser } = useAuthStore();
  const router = useRouter();
  const settings = useSettingsStore(s => s.settings);
  const settingsLoaded = useSettingsStore(s => s.loaded);
  const loadSettings = useSettingsStore(s => s.load);

  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [locations, setLocations] = useState<AnyRecord[]>([]);
  const [locationStock, setLocationStock] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todo');
  const searchRef = useRef<HTMLInputElement>(null);
  // Marca que ya se intentó restaurar el pedido guardado (evita borrarlo
  // con el carrito vacío antes de que carguen los datos)
  const draftRestoredRef = useRef(false);
  // Arrastre horizontal de la fila de categorías (clic y deslizar)
  const categoriesRef = useRef<HTMLDivElement>(null);
  const categoryDragRef = useRef<{ startX: number; scrollLeft: number; moved: number; pointerId: number } | null>(null);
  const categorySuppressClickRef = useRef(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [locationId, setLocationId] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [cashReceived, setCashReceived] = useState(0);
  const [amountTransfer, setAmountTransfer] = useState(0);
  const [transferPhone, setTransferPhone] = useState('');
  const [transferRef, setTransferRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [cartOpen, setCartOpen] = useState(false); // carrito en móvil
  const [keypadOpen, setKeypadOpen] = useState(false); // teclado numérico en pantalla
  const [lastSale, setLastSale] = useState<{ id: string; total: number; change: number; method: PayMethod } | null>(null);

  // Menú de usuario y turno de caja
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [closeShift, setCloseShift] = useState<AnyRecord | null>(null);
  const [closeForm, setCloseForm] = useState({ closing_cash: 0, notes: '' });
  const [shiftBusy, setShiftBusy] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);

  const isSeller = mounted && user?.role === 'seller';
  const { workMode, posId, setPosId, posOptions, openShifts, hasOpenShift, resetPos, refreshPos } = usePosSelector(isSeller);

  // En modo por turnos solo se puede cobrar si la caja seleccionada tiene un
  // turno de ventas abierto. Sin turno, el botón Cobrar queda bloqueado.
  const canCharge = workMode !== 'shifts' || (!!posId && hasOpenShift(posId));

  // Vendedor asociado a una caja: en modo por turnos trabaja fijo en su punto
  // de venta (almacén). No puede cambiar de caja ni de almacén en el POS táctil.
  const assignedPosId = user?.pos_id ?? null;
  const posLocked = isSeller && workMode === 'shifts' && !!assignedPosId;
  const assignedLocationName = posLocked
    ? String(locations.find(l => String(l.id) === locationId)?.name ?? 'Cargando…')
    : '';
  const assignedPosName = posLocked
    ? String(posOptions.find(p => String(p.id) === assignedPosId)?.name ?? 'Tu caja')
    : '';

  // ── Turno de caja del vendedor ─────────────────────────────────
  // El turno propio es el de la caja asignada al vendedor (o el que él
  // mismo abrió si no tiene caja fija).
  const myOpenShift = workMode === 'shifts'
    ? (openShifts.find(s => String(s.pos_id) === String(assignedPosId ?? '')) ?? openShifts.find(s => String(s.user_id) === user?.id) ?? null)
    : null;
  const myShiftSummary = (myOpenShift?.summary ?? null) as { total_sales: number; sales_count?: number; total_cash: number; expected_cash: number } | null;
  const openPosIds = new Set(openShifts.map(s => String(s.pos_id)));

  // Abre el modal de cobro. En modo turnos refresca el estado de las cajas
  // para que el bloqueo por turno cerrado esté siempre al día.
  const openPayModal = useCallback(() => {
    if (workMode === 'shifts') refreshPos();
    setShowPay(true);
    setCartOpen(false);
  }, [workMode, refreshPos]);

  // Mantener el turno y su resumen al día: al abrir/cerrar turno desde el
  // menú de usuario o al registrar ventas, se refrescan cajas y turnos.
  useEffect(() => {
    if (!isSeller) return;
    const onShiftEvent = () => refreshPos();
    window.addEventListener(SHIFT_CHANGED_EVENT, onShiftEvent);
    window.addEventListener(SHIFT_SUMMARY_CHANGED_EVENT, onShiftEvent);
    return () => {
      window.removeEventListener(SHIFT_CHANGED_EVENT, onShiftEvent);
      window.removeEventListener(SHIFT_SUMMARY_CHANGED_EVENT, onShiftEvent);
    };
  }, [isSeller, refreshPos]);

  // Cerrar el menú de usuario al hacer clic fuera
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (
        userMenuRef.current && !userMenuRef.current.contains(e.target as Node) &&
        userMenuButtonRef.current && !userMenuButtonRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [userMenuOpen]);

  // Cierra el turno propio con arqueo de caja
  function openCloseShift() {
    if (!myOpenShift) return;
    setCloseShift(myOpenShift);
    setCloseForm({ closing_cash: 0, notes: '' });
    setShowCloseShift(true);
  }

  async function handleCloseShift() {
    if (!closeShift) return;
    setShiftBusy(true);
    try {
      await api.closeShift(String(closeShift.id), { closing_cash: closeForm.closing_cash, notes: closeForm.notes });
      toast.success('Turno cerrado con arqueo');
      setShowCloseShift(false);
      setCloseShift(null);
      setCloseForm({ closing_cash: 0, notes: '' });
      refreshPos();
      notifyShiftChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cerrar el turno');
    } finally {
      setShiftBusy(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/auth/login');
  }

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
    Promise.all([api.getProducts(), api.getLocations()])
      .then(([p, l]) => {
        if (!alive) return;
        setProducts(p);
        setLocations(l);
        setLocationId(prev => prev || (l.length > 0 ? String(l[0].id) : ''));
      })
      .catch(() => toast.error('Error al cargar datos'));
    return () => { alive = false; };
  }, [isSeller]);

  // Fijar la caja y el almacén del vendedor asociado (modo por turnos):
  // el almacén de salida es el del punto de venta asignado y la caja es la suya.
  useEffect(() => {
    if (!posLocked || !assignedPosId) return;
    setPosId(assignedPosId);
    const assigned = posOptions.find(p => String(p.id) === assignedPosId);
    if (assigned?.location_id) setLocationId(String(assigned.location_id));
  }, [posLocked, assignedPosId, posOptions, setPosId]);

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
        if (!canCharge) {
          toast.error('No hay un turno de ventas abierto. Abre un turno para poder cobrar.');
          return;
        }
        openPayModal();
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
  }, [isSeller, cart, query, cartOpen, keypadOpen, showPay, lastSale, locations, canCharge, openPayModal]);

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
    // El vendedor asignado a una caja siempre trabaja en su almacén: el
    // pedido guardado no puede cambiarlo.
    if (draft.locationId && !posLocked && locations.some(l => String(l.id) === draft.locationId)) {
      setLocationId(draft.locationId);
    }
    toast.info('Pedido en curso restaurado');
  }, [isSeller, user, products, locations]);

  // ── Guardar el pedido en curso en cada cambio ─────────────────
  useEffect(() => {
    if (!isSeller || !user || !draftRestoredRef.current) return;
    if (cart.length === 0) return;
    saveDraft(user.id, {
      v: 1,
      cart: cart.map(i => ({ productId: String(i.product.id), quantity: i.quantity })),
      locationId: locationId || undefined,
      savedAt: Date.now(),
    });
  }, [isSeller, user, cart, locationId]);

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
    // "Cantidad por código" (2*75012345): filtrar por el código, no por la
    // cadena completa, para que el producto se muestre mientras se escribe.
    const raw = query.trim();
    const qtyMatch = raw.match(/^(\d+)\s*[*x]\s*(.+)$/i);
    const q = (qtyMatch ? qtyMatch[2].trim() : raw).toLowerCase();
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
      // Código parcial (p. ej. sin ceros a la izquierda): si solo hay una
      // coincidencia por código de barras, se agrega esa.
      const byBarcode = products.filter(p => getAvailableStock(p) > 0 && String(p.barcode ?? '').toLowerCase().includes(rest.toLowerCase()));
      if (byBarcode.length === 1) {
        addToCart(byBarcode[0], qty);
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

  // ── Arrastre horizontal de categorías ─────────────────────────
  // Mantén presionado y desliza (clic + mover) para recorrer la fila de
  // categorías. Un deslizamiento no cambia la categoría seleccionada.
  function startCategoryDrag(e: React.PointerEvent<HTMLDivElement>) {
    const el = categoriesRef.current;
    if (!el) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* sin captura de puntero */ }
    categoryDragRef.current = { startX: e.clientX, scrollLeft: el.scrollLeft, moved: 0, pointerId: e.pointerId };
  }

  function moveCategoryDrag(e: React.PointerEvent<HTMLDivElement>) {
    const st = categoryDragRef.current;
    const el = categoriesRef.current;
    if (!st || !el || e.pointerId !== st.pointerId) return;
    const dx = e.clientX - st.startX;
    st.moved = Math.max(st.moved, Math.abs(dx));
    el.scrollLeft = st.scrollLeft - dx;
  }

  function endCategoryDrag(e: React.PointerEvent<HTMLDivElement>) {
    const st = categoryDragRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    categoryDragRef.current = null;
    // Si hubo arrastre, el clic posterior no debe cambiar de categoría
    if (st.moved > 6) {
      categorySuppressClickRef.current = true;
      setTimeout(() => { categorySuppressClickRef.current = false; }, 0);
    }
  }

  // Vacía el carrito y elimina el pedido guardado en el navegador
  function emptyCart() {
    setCart([]);
    if (user) clearDraft(user.id);
  }

  function resetSale() {
    emptyCart();
    // El vendedor asociado a una caja conserva su almacén y su caja fijos
    if (!posLocked) {
      setLocationId(locations.length > 0 ? String(locations[0].id) : '');
      resetPos();
    }
    setPayMethod('cash');
    setCashReceived(0);
    setAmountTransfer(0);
    setTransferPhone('');
    setTransferRef('');
  }

  // Efectivo que aplica al total según el método (para el cálculo de cambio)
  const cashDue = payMethod === 'cash' ? cartTotal : payMethod === 'mixed' ? (amountTransfer > 0 ? cartTotal - amountTransfer : 0) : 0;
  const change = cashReceived - cashDue;

  // Teléfono celular cubano: +53 opcional + 5 + 7 dígitos (8 en total)
  const transferPhoneNormalized = transferPhone.trim() ? normalizePhone(transferPhone) : '';
  const transferPhoneValid = !!transferPhoneNormalized && /^(\+?53)?5\d{7}$/.test(transferPhoneNormalized);

  // Referencia de la transferencia: ID de pago + teléfono del cliente
  function transferDetails(): string | null {
    const parts: string[] = [];
    if (transferRef.trim()) parts.push(`ID pago: ${transferRef.trim().toUpperCase()}`);
    if (transferPhone.trim()) parts.push(`Tel: ${transferPhone.trim()}`);
    return parts.length ? parts.join(' · ') : null;
  }

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
          notes: transferDetails() || null,
        }),
        { method, width: s?.receipt_printer_width ?? '80', printer }
      );
    } catch (e) {
      toast.error(`Venta registrada, pero no se pudo imprimir el ticket: ${e instanceof Error ? e.message : 'error desconocido'}`);
    }
  }

  async function handleConfirm() {
    if (cart.length === 0) return;
    if (payMethod === 'mixed') {
      if (amountTransfer <= 0 || amountTransfer >= cartTotal) {
        toast.error('Indica un monto de transferencia menor que el total');
        return;
      }
    }
    // ID de pago opcional: solo letras y números, hasta 13 caracteres
    if ((payMethod === 'transfer' || payMethod === 'mixed') && transferRef.trim() && !/^[A-Za-z0-9]{1,13}$/.test(transferRef.trim())) {
      toast.error('El ID de pago solo puede contener letras y números (máximo 13)');
      return;
    }
    // En modo turnos se requiere un turno de ventas abierto en la caja
    if (workMode === 'shifts' && !canCharge) {
      toast.error('No hay un turno de ventas abierto en esta caja. Abre un turno para poder cobrar.');
      return;
    }
    // Teléfono celular cubano obligatorio para los pagos con transferencia
    const hasTransfer = payMethod === 'transfer' || (payMethod === 'mixed' && amountTransfer > 0);
    if (hasTransfer) {
      const phone = normalizePhone(transferPhone);
      if (!phone || !/^(\+?53)?5\d{7}$/.test(phone)) {
        toast.error('Ingresa un teléfono celular cubano válido para la transferencia (Ej: +53 55280263)');
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
          // La referencia (ID de pago + teléfono) se guarda en el pago
          notes: (payMethod === 'transfer' || payMethod === 'mixed') ? transferDetails() : null,
        },
        customer_id: null,
        location_id: locationId || null,
        pos_id: workMode === 'shifts' ? posId || null : null,
        notes: null,
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
              <div key={String(line.product.id)} className="rounded-xl border p-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 flex-shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-primary)' }}>
                    <ProductImage product={line.product} />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{String(line.product.name)}</p>
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {formatCurrency(line.unit_price)}
                      {line.product.unit ? <span className="uppercase"> / {String(line.product.unit)}</span> : null}
                    </p>
                  </div>
                  <button
                    aria-label={`Eliminar ${String(line.product.name)} del pedido`}
                    onClick={() => removeLine(line.product.id)}
                    className="-m-1 p-1.5 rounded-md transition-colors hover:text-red-400 flex-shrink-0"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
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
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(line.quantity * line.unit_price)}</span>
                </div>
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
                {!canCharge && (
                  <p className="text-xs flex items-center gap-1.5 text-yellow-400">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    No hay un turno de ventas abierto en la caja. Abre un turno para poder cobrar.
                  </p>
                )}
                <button
                  onClick={openPayModal}
                  disabled={cart.length === 0 || issues || saving || !canCharge}
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
          {/* Total de ventas del turno (solo modo por turnos, con turno abierto) */}
          {workMode === 'shifts' && myOpenShift && (
            <div
              className="hidden md:flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-xl"
              title={`Turno abierto en ${String(myOpenShift.pos_name ?? 'la caja')} · ${formatNumber(myShiftSummary?.sales_count ?? 0, 0)} venta(s) · ${formatCurrency(myShiftSummary?.total_sales ?? 0)} en ventas`}
            >
              <Clock3 className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate max-w-[190px]">
                {String(myOpenShift.pos_name ?? 'Caja')} · {formatNumber(myShiftSummary?.sales_count ?? 0, 0)} venta(s) · {formatCurrency(myShiftSummary?.total_sales ?? 0)}
              </span>
            </div>
          )}

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

          {/* Menú de usuario: turno de caja, contraseña y sesión */}
          <div className="relative">
            <button
              ref={userMenuButtonRef}
              onClick={() => setUserMenuOpen(v => !v)}
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-200 border',
                userMenuOpen
                  ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border-transparent'
              )}
              title="Menú de usuario"
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <User className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
              </div>
              <span className="hidden sm:block text-sm font-medium max-w-[100px] truncate" style={{ color: 'var(--text-primary)' }}>
                {String(user?.name ?? 'Vendedor')}
              </span>
              <ChevronDown className={cn('w-3 h-3 transition-transform duration-200', userMenuOpen && 'rotate-180')} style={{ color: 'var(--text-tertiary)' }} />
            </button>

            {userMenuOpen && (
              <div
                ref={userMenuRef}
                className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-primary)] shadow-2xl shadow-black/30 z-50 overflow-hidden"
              >
                {/* Cabecera con datos del usuario */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-primary)]">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <span className="text-sm font-semibold" style={{ color: 'var(--brand-400)' }}>
                      {user?.name?.charAt(0)?.toUpperCase() ?? 'V'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{String(user?.name ?? 'Vendedor')}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Vendedor{assignedPosName ? ` · ${assignedPosName}` : ''}</p>
                  </div>
                </div>

                {/* Abrir / cerrar turno en la caja del vendedor (modo por turnos) */}
                {workMode === 'shifts' && (
                  myOpenShift ? (
                    <button
                      onClick={() => { setUserMenuOpen(false); openCloseShift(); }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-red-500/10 border-b border-[var(--border-primary)]"
                    >
                      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 flex-shrink-0">
                        <Square className="w-3.5 h-3.5 text-red-400" />
                      </span>
                      <span className="flex-1 text-left">
                        <span className="block text-[var(--text-primary)] font-medium">Cerrar turno</span>
                        <span className="block text-[11px] text-[var(--text-tertiary)] truncate">
                          Turno abierto en {String(myOpenShift.pos_name ?? 'la caja')}
                          {myShiftSummary ? ` · ${formatNumber(myShiftSummary.sales_count ?? 0, 0)} venta(s)` : ''}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => { setUserMenuOpen(false); setShowOpenShift(true); }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-green-500/10 border-b border-[var(--border-primary)]"
                    >
                      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-green-500/10 border border-green-500/20 flex-shrink-0">
                        <Play className="w-3.5 h-3.5 text-green-400" />
                      </span>
                      <span className="flex-1 text-left">
                        <span className="block text-[var(--text-primary)] font-medium">Abrir turno</span>
                        <span className="block text-[11px] text-[var(--text-tertiary)] truncate">
                          {assignedPosName ? `Caja asignada: ${assignedPosName}` : 'Abre un turno para poder cobrar'}
                        </span>
                      </span>
                    </button>
                  )
                )}

                {/* Cambiar contraseña */}
                <button
                  onClick={() => { setUserMenuOpen(false); setShowChangePassword(true); }}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-brand-500/10 border-b border-[var(--border-primary)]"
                >
                  <KeyRound className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                  <span className="text-[var(--text-secondary)]">Cambiar contraseña</span>
                </button>

                {/* Cerrar sesión */}
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-red-500/10"
                >
                  <LogOut className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                  <span className="text-[var(--text-secondary)]">Cerrar sesión</span>
                </button>
              </div>
            )}
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
            {/* Almacén de salida: el catálogo se filtra por este almacén.
                Si el vendedor está asociado a una caja (modo turnos), el
                almacén es fijo: se muestra como información, sin selector. */}
            {posLocked ? (
              <div
                className="hidden md:flex w-52 flex-shrink-0 pt-0.5 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium truncate"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                title={assignedLocationName}
              >
                <Store className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
                <span className="truncate">{assignedLocationName}</span>
              </div>
            ) : (
              <div className="hidden md:block w-52 flex-shrink-0 pt-0.5">
                <SearchableSelect
                  options={locations.map(l => ({ value: String(l.id), label: String(l.name) }))}
                  value={locationId}
                  onChange={v => setLocationId(v)}
                  placeholder="Almacén…"
                  noResultsMessage="Sin almacenes"
                />
              </div>
            )}
            </div>

            <div
              ref={categoriesRef}
              onPointerDown={startCategoryDrag}
              onPointerMove={moveCategoryDrag}
              onPointerUp={endCategoryDrag}
              onPointerCancel={endCategoryDrag}
              className="flex gap-2.5 overflow-x-auto pb-2 pt-4 [scrollbar-width:none] cursor-grab active:cursor-grabbing touch-pan-x select-none"
            >
              {categories.map(c => {
                const active = c === category;
                return (
                  <button
                    key={c}
                    onClick={() => { if (categorySuppressClickRef.current) return; setCategory(c); }}
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
              {posLocked ? (
                <div
                  className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium truncate"
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  title={assignedPosName}
                >
                  <Store className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
                  <span className="truncate">{assignedPosName}</span>
                </div>
              ) : (
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
              )}
              {workMode === 'shifts' && !canCharge && (
                <p className="text-[10px] text-yellow-400 mt-1">Esta caja no tiene un turno de ventas abierto. Abre un turno para poder cobrar.</p>
              )}
            </div>
          )}

          {/* Almacén de salida */}
          <div>
            <label className="label">Almacén de salida{posLocked ? '' : ' *'}</label>
            {posLocked ? (
              <div
                className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium truncate"
                style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                title={assignedLocationName}
              >
                <Store className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
                <span className="truncate">{assignedLocationName}</span>
              </div>
            ) : (
              <SearchableSelect
                options={locations.map(l => ({ value: String(l.id), label: String(l.name) }))}
                value={locationId}
                onChange={v => setLocationId(v)}
                placeholder={locations.length === 0 ? 'Cargando ubicaciones...' : 'Seleccionar almacén'}
                noResultsMessage="Sin almacenes"
              />
            )}
          </div>

          {/* Método de pago */}
          <div>
            <label className="label">Método de pago</label>
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
              {PAY_METHODS.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setPayMethod(m.id); setCashReceived(0); setAmountTransfer(0); setTransferPhone(''); setTransferRef(''); }}
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
              Se cobrará el total ({formatCurrency(cartTotal)}) por transferencia bancaria. El teléfono celular del cliente es obligatorio.
            </div>
          )}

          {/* Datos de la transferencia */}
          {(payMethod === 'transfer' || payMethod === 'mixed') && (
            <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
              <p className="label mb-3">Datos de la transferencia</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Teléfono celular del cliente *</label>
                  <div className="relative">
                    {transferPhone.trim() ? (
                      transferPhoneValid ? (
                        <CheckCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                      ) : (
                        <PhoneOff className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                      )
                    ) : (
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                    )}
                    <input
                      type="tel"
                      inputMode="tel"
                      className={`input pl-10 ${transferPhone.trim() ? (transferPhoneValid ? 'border-green-500/50 focus:border-green-500' : 'border-amber-500/50 focus:border-amber-500') : ''}`}
                      placeholder="Ej: +53 55280263"
                      value={transferPhone}
                      maxLength={20}
                      onChange={e => setTransferPhone(e.target.value)}
                    />
                  </div>
                  {transferPhone.trim() && (
                    <p className={`text-[10px] mt-1 ${transferPhoneValid ? 'text-green-400' : 'text-amber-400'}`}>
                      {transferPhoneValid ? 'Teléfono válido' : 'Formato inválido. Ejemplo: +53 55280263'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">ID de pago</label>
                  <input
                    className="input font-mono uppercase"
                    placeholder="Ej: BHD1234567890"
                    value={transferRef}
                    maxLength={13}
                    onChange={e => setTransferRef(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                  />
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Solo letras y números, máximo 13 caracteres.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={() => setShowPay(false)} className="btn-secondary flex-1 py-3.5 text-base">Volver</button>
            <button
              onClick={handleConfirm}
              disabled={saving || cart.length === 0 || hasStockIssues() || !canCharge}
              className="btn-primary flex-1 py-3.5 text-base disabled:opacity-50"
            >
              {saving ? 'Registrando...' : `Confirmar — ${formatCurrency(cartTotal)}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Abrir turno (caja del vendedor) ── */}
      <OpenShiftModal
        open={showOpenShift}
        pos={posOptions}
        openPosIds={openPosIds}
        onClose={() => setShowOpenShift(false)}
        onOpened={refreshPos}
        preferredPosId={assignedPosId ?? undefined}
      />

      {/* ── Modal: Cerrar turno (arqueo de caja) ── */}
      <Modal open={showCloseShift} onClose={() => setShowCloseShift(false)} title="Cerrar turno — arqueo de caja">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Cuenta el efectivo en caja y regístralo. El sistema calculará el efectivo esperado según los
            movimientos del turno y la diferencia.
          </p>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-[var(--text-tertiary)]">Caja</p>
              <p className="font-medium text-[var(--text-primary)] truncate">{String(closeShift?.pos_name ?? '—')}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-tertiary)]">Fondo inicial</p>
              <p className="font-medium text-[var(--text-primary)]">{formatCurrency(Number(closeShift?.opening_cash ?? 0))}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-[var(--text-tertiary)]">Abierto desde</p>
              <p className="font-medium text-[var(--text-primary)] truncate">{closeShift?.opened_at ? formatDateTime(String(closeShift.opened_at)) : '—'}</p>
            </div>
          </div>
          <div>
            <label className="label">Efectivo contado en caja *</label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              <input type="number" min="0" step="1" className="input pl-9"
                value={closeForm.closing_cash || ''}
                onChange={e => setCloseForm(f => ({ ...f, closing_cash: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input type="text" className="input" placeholder="Ej: Turno cerrado sin novedades"
              value={closeForm.notes}
              onChange={e => setCloseForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex flex-col xs:flex-row gap-2 justify-end pt-2">
            <button onClick={() => setShowCloseShift(false)} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
            <button onClick={handleCloseShift} disabled={shiftBusy} className="btn-primary flex-1 xs:flex-none disabled:opacity-50">
              {shiftBusy ? 'Cerrando...' : 'Cerrar turno'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Cambiar mi contraseña ── */}
      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        mode="self"
      />

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
