'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/lib/stores/auth-store';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ArrowRight,
  Menu,
  X,
  Store,
  Plus,
  Phone,
  PhoneOff,
  CheckCircle,
  User,
  Loader2,
  Search,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';

interface ProductItem {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  sale_price: number;
  cost: number;
  stock: number;
  min_stock: number;
  unit: string;
  image_url: string | null;
  category_name: string | null;
}

interface ProductsByCategory {
  category_id: string;
  category_name: string;
  products: ProductItem[];
}

const PHONE_REGEX = /^(\+?53)?[\s.-]?\d{7,8}$/;

export default function HomePage() {
  const { user } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [productsByCategory, setProductsByCategory] = useState<ProductsByCategory[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [reservSaving, setReservSaving] = useState(false);
  const [reservSuccess, setReservSuccess] = useState<string | null>(null);
  const [reservError, setReservError] = useState<string | null>(null);

  // ── Shopping cart state ──
  interface CartItem {
    product: {
      id: string;
      name: string;
      sale_price: number;
      stock: number;
      unit: string;
    };
    quantity: number;
  }
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartNotification, setCartNotification] = useState<string | null>(null);

  function addToCart(product: ProductItem) {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + 1, item.product.stock) }
            : item
        );
      }
      return [...prev, {
        product: {
          id: product.id,
          name: product.name,
          sale_price: product.sale_price,
          stock: product.stock,
          unit: product.unit,
        },
        quantity: 1,
      }];
    });
    setCartNotification(product.name);
    setTimeout(() => setCartNotification(null), 2000);
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  }

  function updateCartQuantity(productId: string, quantity: number) {
    setCart(prev => prev.map(item =>
      item.product.id === productId
        ? { ...item, quantity: Math.max(1, Math.min(quantity, item.product.stock)) }
        : item
    ));
  }

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.product.sale_price * item.quantity, 0);

  function clearCart() {
    setCart([]);
    setCartForm({ customer_name: '', customer_phone: '', notes: '' });
    setPhoneError(null);
    setPhoneTouched(false);
    setReservSuccess(null);
    setReservError(null);
  }

  const [cartForm, setCartForm] = useState({ customer_name: '', customer_phone: '', notes: '' });

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Fetch products by category on mount
  useEffect(() => {
    fetch('/api/reservations/products')
      .then(r => r.json())
      .then(d => { setProductsByCategory(d); setProductsLoading(false); })
      .catch(() => setProductsLoading(false));
  }, []);

  const fmtPrice = (n: number) => `$${new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2 }).format(n)}`;

  // ── Filter & Search ──
  const allCategories = useMemo(() => {
    return productsByCategory.map(c => ({ id: c.category_id, name: c.category_name }));
  }, [productsByCategory]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery && !selectedCategory) return productsByCategory;

    const q = searchQuery.toLowerCase().trim();
    return productsByCategory
      .map(cat => {
        // If a category filter is active, skip non-matching categories
        if (selectedCategory && cat.category_id !== selectedCategory) return null;

        // Filter products within the category by search query
        const filtered = q
          ? cat.products.filter(p =>
              p.name.toLowerCase().includes(q) ||
              (p.description?.toLowerCase().includes(q) ?? false)
            )
          : cat.products;

        if (filtered.length === 0) return null;
        return { ...cat, products: filtered };
      })
      .filter((c): c is ProductsByCategory => c !== null);
  }, [productsByCategory, searchQuery, selectedCategory]);

  async function handleCartReservation(e: React.FormEvent) {
    e.preventDefault();
    if (!cartForm.customer_name.trim() || cart.length === 0) return;
    setReservSaving(true);
    setReservError(null);
    setReservSuccess(null);
    setPhoneError(null);

    // Validar formato de teléfono si se proporcionó
    if (cartForm.customer_phone.trim()) {
      if (!PHONE_REGEX.test(cartForm.customer_phone.trim())) {
        setPhoneError('Formato inválido. Ejemplo: +53 55280263');
        setReservSaving(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(item => ({
            product_id: item.product.id,
            quantity: item.quantity,
          })),
          customer_name: cartForm.customer_name,
          customer_phone: cartForm.customer_phone,
          notes: cartForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setReservError(data.error ?? 'Error al crear reservación'); return; }
      setReservSuccess(data.message ?? 'Reservación creada con éxito');
      setCartForm({ customer_name: '', customer_phone: '', notes: '' });
      setPhoneError(null);
    } catch { setReservError('Error de conexión'); } finally { setReservSaving(false); }
  }

  // ── Search result count ──
  const totalFilteredProducts = useMemo(() => {
    return filteredProducts.reduce((sum, cat) => sum + cat.products.length, 0);
  }, [filteredProducts]);

  return (
    <div className="min-h-screen bg-[#0d1117]">
      {/* ──────── NAVBAR ──────── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-[#0d1117]/90 backdrop-blur-md border-b border-[#21262d] shadow-lg'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 md:h-20">
            <Link href="/inicio" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-md shadow-brand-600/30 group-hover:shadow-brand-600/50 transition-all duration-300">
                <Store className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="font-display text-[#e6edf3] text-lg leading-tight block">
                  TiendaMiBarrio
                </span>
                <span className="text-[10px] text-brand-400 uppercase tracking-widest font-medium">
                  Productos
                </span>
              </div>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
              <Link
                href="/inicio"
                className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all duration-150"
              >
                Inicio
              </Link>
              <Link
                href="/inicio#features"
                className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all duration-150"
              >
                Características
              </Link>
              <Link
                href="/inicio#cta"
                className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all duration-150"
              >
                Contacto
              </Link>
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Cart button */}
              <button
                onClick={() => setCartOpen(true)}
                className="relative p-2.5 text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                aria-label="Abrir carrito"
              >
                <ShoppingCart className="w-5 h-5" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-brand-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-lg shadow-brand-500/30">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </button>

              {user ? (
                <Link
                  href="/dashboard"
                  className="hidden md:inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-all duration-200 shadow-lg shadow-brand-600/25 hover:shadow-brand-600/40 hover:-translate-y-0.5"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/auth/login"
                  className="hidden md:inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-all duration-200 shadow-lg shadow-brand-600/25 hover:shadow-brand-600/40 hover:-translate-y-0.5"
                >
                  <ArrowRight className="w-4 h-4" />
                  Acceder
                </Link>
              )}

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                aria-label="Abrir menú"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#21262d] bg-[#0d1117]/95 backdrop-blur-md">
            <div className="px-4 py-4 space-y-1">
              <Link
                href="/inicio"
                className="block w-full text-left px-4 py-3 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                onClick={() => setMobileMenuOpen(false)}
              >
                Inicio
              </Link>
              <Link
                href="/inicio#features"
                className="block w-full text-left px-4 py-3 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                onClick={() => setMobileMenuOpen(false)}
              >
                Características
              </Link>
              <Link
                href="/inicio#cta"
                className="block w-full text-left px-4 py-3 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                onClick={() => setMobileMenuOpen(false)}
              >
                Contacto
              </Link>
              <div className="pt-2">
                {user ? (
                  <Link
                    href="/dashboard"
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 text-white text-sm font-medium rounded-xl"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <LayoutDashboard className="w-4 h-4" /> Dashboard
                  </Link>
                ) : (
                  <Link
                    href="/auth/login"
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 text-white text-sm font-medium rounded-xl"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <ArrowRight className="w-4 h-4" /> Acceder
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ──────── HERO / HEADER ──────── */}
      <section className="relative pt-28 pb-12 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-brand-600/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-brand-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-brand-500/10 border border-brand-500/20 rounded-full mb-5">
              <ShoppingCart className="w-4 h-4 text-brand-400" />
              <span className="text-sm font-medium text-brand-400">Catálogo de Productos</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl text-[#e6edf3] mb-4">
              Explora nuestros productos
            </h1>
            <p className="text-[#8b949e] max-w-2xl mx-auto mb-8">
              Haz tu pedido directamente desde aquí. Selecciona los productos
              que necesitas y te contactaremos para coordinar la entrega.
            </p>

            {/* ── SEARCH BAR ── */}
            <div className="max-w-2xl mx-auto space-y-3">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6e7681]" />
                <input
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-2xl py-4 pl-12 pr-10 text-[#e6edf3] placeholder-[#6e7681] text-base focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                  placeholder="Buscar productos por nombre o descripción..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6e7681] hover:text-[#e6edf3] transition-colors"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Category filter chips */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#6e7681]" />
                <button
                  onClick={() => setSelectedCategory('')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                    !selectedCategory
                      ? 'bg-brand-600/20 border-brand-600/50 text-brand-400'
                      : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#6e7681]'
                  }`}
                >
                  Todas
                </button>
                {allCategories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(selectedCategory === cat.id ? '' : cat.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                      selectedCategory === cat.id
                        ? 'bg-brand-600/20 border-brand-600/50 text-brand-400'
                        : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#6e7681]'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {/* Results count */}
              {!productsLoading && (
                <p className="text-xs text-[#6e7681]">
                  {searchQuery || selectedCategory
                    ? `${totalFilteredProducts} resultado(s)`
                    : `${filteredProducts.reduce((s, c) => s + c.products.length, 0)} producto(s) disponible(s)`}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ──────── PRODUCTOS GRID ──────── */}
      <section className="pb-20 lg:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {productsLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16">
              <Package className="w-16 h-16 text-[#21262d] mx-auto mb-4" />
              <p className="text-[#6e7681] text-sm">
                {searchQuery
                  ? 'No hay productos que coincidan con tu búsqueda.'
                  : 'No hay productos disponibles actualmente.'}
              </p>
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setSelectedCategory(''); }}
                  className="mt-4 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-all"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-16">
              {filteredProducts.map((cat) => (
                <div key={cat.category_id || 'uncategorized'}>
                  {/* Category header */}
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-brand-500/10 rounded-xl flex items-center justify-center">
                      <Package className="w-5 h-5 text-brand-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-[#e6edf3]">{cat.category_name}</h3>
                      <p className="text-xs text-[#6e7681]">{cat.products.length} producto(s)</p>
                    </div>
                  </div>

                  {/* Products grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {cat.products.map((product) => {
                      const isLowStock = product.stock <= product.min_stock;
                      return (
                        <div
                          key={product.id}
                          className="group card p-4 hover:border-brand-500/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-600/5 flex flex-col active:scale-[0.98] active:border-brand-500/30"
                        >
                          {/* Product image */}
                          <div className="w-full aspect-square bg-gradient-to-br from-brand-500/10 to-brand-600/5 rounded-xl mb-3 flex items-center justify-center overflow-hidden">
                            {product.image_url ? (
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <ShoppingCart className={`w-10 h-10 text-brand-400/30 group-hover:text-brand-400/50 transition-colors ${product.image_url ? 'hidden' : ''}`} />
                          </div>

                          {/* Stock badge */}
                          <div className="flex items-center gap-1.5 mb-1.5">
                            {isLowStock ? (
                              <span className="text-[10px] font-medium text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
                                Stock bajo
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                                Disponible
                              </span>
                            )}
                          </div>

                          {/* Product name */}
                          <h4 className="text-sm font-semibold text-[#e6edf3] mb-1 line-clamp-2 group-hover:text-brand-400 transition-colors">
                            {product.name}
                          </h4>

                          {/* Description */}
                          {product.description && (
                            <p className="text-xs text-[#6e7681] line-clamp-2 mb-2">
                              {product.description}
                            </p>
                          )}

                          {/* Spacer */}
                          <div className="flex-1" />

                          {/* Price */}
                          <div className="flex items-baseline gap-1.5 mb-3">
                            <span className="text-lg font-bold text-brand-400">
                              {fmtPrice(product.sale_price)}
                            </span>
                            <span className="text-[10px] text-[#6e7681]">
                              / {product.unit}
                            </span>
                          </div>

                          {/* Add button */}
                          <button
                            onClick={() => addToCart(product)}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 md:py-2.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-xs font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-brand-600/20 hover:shadow-brand-600/40 active:scale-95 hover:-translate-y-0.5 active:translate-y-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Agregar
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bottom CTA */}
          {!productsLoading && filteredProducts.length > 0 && (
            <div className="mt-16 text-center">
              <p className="text-sm text-[#8b949e] mb-4">
                ¿No encuentras lo que buscas?{' '}
                <span className="text-brand-400 font-medium">Contáctanos</span> y
                te ayudaremos.
              </p>
            </div>
          )}
        </div>

        {/* ── Cart notification toast ── */}
        {cartNotification && (
          <div className="fixed bottom-4 left-4 right-4 md:bottom-6 md:right-6 md:left-auto z-[90] bg-[#161b22] border border-[#30363d] rounded-xl px-5 py-3 shadow-2xl shadow-brand-600/10 animate-in slide-in-from-bottom-5 md:slide-in-from-right-5 fade-in duration-200">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[#e6edf3]">Agregado al carrito</p>
                <p className="text-xs text-[#8b949e]">{cartNotification}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Cart Panel (slide-out drawer) ── */}
        {cartOpen && (
          <div className="fixed inset-0 z-[100]">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!reservSaving) setCartOpen(false); }} />
            <div className="fixed inset-0 md:absolute md:right-0 md:top-0 md:bottom-0 md:left-auto md:max-w-md bg-[#161b22] md:border-l border-[#30363d] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
              {/* Drag handle (mobile) */}
              <div className="md:hidden flex justify-center pt-2 pb-1 pointer-events-none absolute top-0 left-0 right-0 z-10">
                <div className="w-10 h-1 bg-[#30363d] rounded-full" />
              </div>
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-4 md:pt-4 pb-4 border-b border-[#21262d]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-brand-500/10 rounded-xl flex items-center justify-center">
                    <ShoppingCart className="w-4 h-4 text-brand-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#e6edf3]">
                      Tu carrito {cartCount > 0 && <span className="text-brand-400">({cartCount})</span>}
                    </h3>
                    <p className="text-[10px] text-[#6e7681]">{cart.length} producto(s)</p>
                  </div>
                </div>
                <button
                  onClick={() => setCartOpen(false)}
                  className="p-2.5 md:p-1.5 text-[#6e7681] hover:text-[#e6edf3] rounded-lg hover:bg-[#21262d] transition-colors"
                >
                  <X className="w-5 h-5 md:w-4 md:h-4" />
                </button>
              </div>

              {reservSuccess ? (
                /* ── Success state ── */
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center max-w-sm">
                    <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-5 border-2 border-green-500/30">
                      <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h4 className="text-lg font-semibold text-[#e6edf3] mb-2">¡Reservación creada!</h4>
                    <p className="text-sm text-[#8b949e] mb-6">{reservSuccess}</p>
                    <button
                      onClick={() => { clearCart(); setCartOpen(false); }}
                      className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-all"
                    >
                      Seguir viendo productos
                    </button>
                  </div>
                </div>
              ) : cart.length === 0 ? (
                /* ── Empty cart ── */
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-[#21262d] rounded-full flex items-center justify-center mx-auto mb-4">
                      <ShoppingCart className="w-7 h-7 text-[#6e7681]" />
                    </div>
                    <p className="text-sm text-[#8b949e] mb-1">Tu carrito está vacío</p>
                    <p className="text-xs text-[#6e7681]">Agrega productos desde el catálogo</p>
                    <button
                      onClick={() => setCartOpen(false)}
                      className="mt-5 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-all"
                    >
                      Explorar productos
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Cart items + form ── */
                <div className="flex-1 overflow-y-auto">
                  <div className="p-5 space-y-3">
                    {cart.map(item => (
                      <div key={item.product.id} className="bg-[#0d1117] rounded-xl border border-[#21262d] p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#e6edf3] truncate">{item.product.name}</p>
                            <p className="text-xs text-[#8b949e]">{fmtPrice(item.product.sale_price)} / {item.product.unit}</p>
                          </div>
                          <button
                            onClick={() => removeFromCart(item.product.id)}
                            className="p-1 text-[#6e7681] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors flex-shrink-0"
                            aria-label="Eliminar producto"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => updateCartQuantity(item.product.id, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                              className="w-11 h-11 md:w-8 md:h-8 bg-[#21262d] hover:bg-[#2d333b] active:bg-[#2d333b] disabled:opacity-30 rounded-lg flex items-center justify-center text-[#e6edf3] transition-colors"
                            >
                              <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                              </svg>
                            </button>
                            <span className="w-12 text-center text-base md:text-sm font-semibold text-[#e6edf3]">{item.quantity}</span>
                            <button
                              onClick={() => updateCartQuantity(item.product.id, item.quantity + 1)}
                              disabled={item.quantity >= item.product.stock}
                              className="w-11 h-11 md:w-8 md:h-8 bg-[#21262d] hover:bg-[#2d333b] active:bg-[#2d333b] disabled:opacity-30 rounded-lg flex items-center justify-center text-[#e6edf3] transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            </button>
                          </div>
                          <span className="text-sm font-semibold text-brand-400">
                            {fmtPrice(item.product.sale_price * item.quantity)}
                          </span>
                        </div>
                        {item.quantity >= item.product.stock && (
                          <p className="text-[10px] text-amber-400 mt-1.5">
                            Stock máximo disponible: {item.product.stock} {item.product.unit}(s)
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Total */}
                  <div className="px-5 py-3 border-t border-[#21262d] bg-[#0d1117]/50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#8b949e]">Total estimado</span>
                      <span className="text-xl font-bold text-brand-400">{fmtPrice(cartTotal)}</span>
                    </div>
                  </div>

                  {/* Customer form */}
                  <form onSubmit={handleCartReservation} className="px-5 py-4 space-y-4">
                    <div>
                      <label className="label">Tu nombre *</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]" />
                        <input
                          className="input pl-10"
                          placeholder="Ej: Juan Pérez"
                          value={cartForm.customer_name}
                          onChange={e => setCartForm(f => ({ ...f, customer_name: e.target.value }))}
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="label">Teléfono (opcional)</label>
                      <div className="relative">
                        {cartForm.customer_phone.trim() ? (
                          PHONE_REGEX.test(cartForm.customer_phone.trim()) ? (
                            <CheckCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                          ) : (
                            <PhoneOff className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                          )
                        ) : (
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]" />
                        )}
                        <input
                          className={`input pl-10 ${
                            phoneTouched && cartForm.customer_phone.trim()
                              ? PHONE_REGEX.test(cartForm.customer_phone.trim())
                                ? 'border-green-500/50 focus:border-green-500 focus:ring-green-500/20'
                                : 'border-amber-500/50 focus:border-amber-500 focus:ring-amber-500/20'
                              : ''
                          }`}
                          placeholder="Ej: +53 55280263"
                          value={cartForm.customer_phone}
                          onChange={e => setCartForm(f => ({ ...f, customer_phone: e.target.value }))}
                          onFocus={() => setPhoneTouched(true)}
                        />
                        {phoneTouched && cartForm.customer_phone.trim() && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            {PHONE_REGEX.test(cartForm.customer_phone.trim()) ? (
                              <span className="text-[10px] text-green-400 font-medium">Válido</span>
                            ) : (
                              <span className="text-[10px] text-amber-400 font-medium">Inválido</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="label">Notas (opcional)</label>
                      <input
                        className="input"
                        placeholder="Ej: Prefiero que me llamen en la tarde"
                        value={cartForm.notes}
                        onChange={e => setCartForm(f => ({ ...f, notes: e.target.value }))}
                      />
                    </div>

                    {phoneError && (
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-amber-400 text-sm flex items-center gap-2">
                        <Phone className="w-4 h-4 flex-shrink-0" />
                        {phoneError}
                      </div>
                    )}

                    {reservError && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                        {reservError}
                      </div>
                    )}

                    <div className="flex gap-3 pt-1 pb-2">
                      <button
                        type="button"
                        onClick={() => setCartOpen(false)}
                        disabled={reservSaving}
                        className="btn-secondary flex-1 disabled:opacity-50"
                      >
                        Seguir viendo
                      </button>
                      <button
                        type="submit"
                        disabled={reservSaving || !cartForm.customer_name.trim() || cart.length === 0}
                        className="btn-primary flex-1 disabled:opacity-50"
                      >
                        {reservSaving ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Reservando...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            <ShoppingCart className="w-4 h-4" />
                            Reservar todo
                          </span>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Mobile bottom cart bar ── */}
      {cart.length > 0 && (            <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#161b22]/95 backdrop-blur-md border-t border-[#30363d] shadow-2xl shadow-black/50 md:hidden pb-[env(safe-area-inset-bottom,0px)]">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setCartOpen(true)}
              className="flex items-center gap-3 flex-1 min-w-0"
            >
              <div className="relative flex-shrink-0">
                <ShoppingCart className="w-5 h-5 text-brand-400" />
                <span className="absolute -top-2 -right-2 w-4 h-4 bg-brand-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-[#161b22]">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[#6e7681]">{cart.length} producto(s)</p>
                <p className="text-sm font-bold text-brand-400">{fmtPrice(cartTotal)}</p>
              </div>
            </button>
            <button
              onClick={() => setCartOpen(true)}
              className="flex-shrink-0 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-600/30 active:scale-95"
            >
              Ver carrito
            </button>
          </div>
        </div>
      )}

      {/* ──────── FOOTER ──────── */}
      <footer className="border-t border-[#21262d] bg-[#161b22]/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 pb-24 md:pb-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="col-span-2 md:col-span-1">
              <Link href="/inicio" className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
                  <Store className="w-4 h-4 text-white" />
                </div>
                <span className="font-display text-[#e6edf3] text-base">
                  TiendaMiBarrio
                </span>
              </Link>
              <p className="text-xs text-[#6e7681] leading-relaxed max-w-xs">
                Sistema de gestión para tiendas de barrio. Controla tu negocio
                de manera simple y eficiente.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">Módulos</h4>
              <ul className="space-y-2.5">
                {['Inventario', 'Ventas', 'Compras', 'Clientes', 'Reservaciones'].map((item) => (
                  <li key={item}>
                    <span className="text-sm text-[#6e7681] hover:text-[#e6edf3] transition-colors cursor-default">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">Empresa</h4>
              <ul className="space-y-2.5">
                {['Acerca de', 'Características', 'Precios', 'FAQ'].map((item) => (
                  <li key={item}>
                    <span className="text-sm text-[#6e7681] hover:text-[#e6edf3] transition-colors cursor-default">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">Soporte</h4>
              <ul className="space-y-2.5">
                {['Documentación', 'Reportar Error', 'Sugerencias', 'Contacto'].map((item) => (
                  <li key={item}>
                    <span className="text-sm text-[#6e7681] hover:text-[#e6edf3] transition-colors cursor-default">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-[#21262d] mt-10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-[#6e7681]">
              © {new Date().getFullYear()} TiendaMiBarrio. Todos los derechos reservados.
            </p>
            <div className="flex items-center gap-4 text-xs text-[#6e7681]">
              <span className="hover:text-[#e6edf3] transition-colors cursor-default">Términos</span>
              <span className="hover:text-[#e6edf3] transition-colors cursor-default">Privacidad</span>
              <span className="hover:text-[#e6edf3] transition-colors cursor-default">Licencia</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
