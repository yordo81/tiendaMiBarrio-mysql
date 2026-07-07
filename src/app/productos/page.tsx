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
  Zap,
  ChevronRight,
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

export default function ProductosPage() {
  const { user } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [productsByCategory, setProductsByCategory] = useState<ProductsByCategory[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [reservModal, setReservModal] = useState<{
    product: { id: string; name: string; sale_price: number; stock: number; unit: string } | null;
  }>({ product: null });
  const [reservForm, setReservForm] = useState({ customer_name: '', customer_phone: '', quantity: 1, notes: '' });
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [reservSaving, setReservSaving] = useState(false);
  const [reservSuccess, setReservSuccess] = useState<string | null>(null);
  const [reservError, setReservError] = useState<string | null>(null);

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

  async function handleReservation(e: React.FormEvent) {
    e.preventDefault();
    if (!reservModal.product || !reservForm.customer_name.trim() || reservForm.quantity <= 0) return;
    setReservSaving(true);
    setReservError(null);
    setReservSuccess(null);
    setPhoneError(null);

    // Validar formato de teléfono si se proporcionó
    if (reservForm.customer_phone.trim()) {
      if (!PHONE_REGEX.test(reservForm.customer_phone.trim())) {
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
          product_id: reservModal.product.id,
          customer_name: reservForm.customer_name,
          customer_phone: reservForm.customer_phone,
          quantity: reservForm.quantity,
          notes: reservForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setReservError(data.error ?? 'Error al crear reservación'); return; }
      setReservSuccess(data.message ?? 'Reservación creada con éxito');
      setReservForm({ customer_name: '', customer_phone: '', quantity: 1, notes: '' });
      setPhoneError(null);
    } catch { setReservError('Error de conexión'); } finally { setReservSaving(false); }
  }

  function openReserv(product: ProductItem) {
    setReservModal({ product: { id: product.id, name: product.name, sale_price: product.sale_price, stock: product.stock, unit: product.unit } });
    setReservForm({ customer_name: '', customer_phone: '', quantity: 1, notes: '' });
    setReservSuccess(null);
    setReservError(null);
    setPhoneError(null);
    setPhoneTouched(false);
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
            <Link href="/" className="flex items-center gap-3 group">
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
                href="/"
                className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all duration-150"
              >
                Inicio
              </Link>
              <Link
                href="/#features"
                className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all duration-150"
              >
                Características
              </Link>
              <Link
                href="/#cta"
                className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all duration-150"
              >
                Contacto
              </Link>
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-3">
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
                href="/"
                className="block w-full text-left px-4 py-3 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                onClick={() => setMobileMenuOpen(false)}
              >
                Inicio
              </Link>
              <Link
                href="/#features"
                className="block w-full text-left px-4 py-3 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                onClick={() => setMobileMenuOpen(false)}
              >
                Características
              </Link>
              <Link
                href="/#cta"
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
                          className="group card p-4 hover:border-brand-500/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-600/5 flex flex-col"
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
                            onClick={() => openReserv(product)}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-brand-600/20 hover:shadow-brand-600/40 hover:-translate-y-0.5 active:translate-y-0"
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

        {/* ── Reservation Modal ── */}
        {reservModal.product && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => { if (!reservSaving) setReservModal({ product: null }); }}
            />
            <div className="relative w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display text-lg text-[#e6edf3]">Reservar producto</h3>
                <button
                  onClick={() => setReservModal({ product: null })}
                  disabled={reservSaving}
                  className="p-1.5 text-[#6e7681] hover:text-[#e6edf3] rounded-lg hover:bg-[#21262d] transition-colors disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Product info */}
              <div className="flex items-center gap-3 p-3 bg-[#0d1117] rounded-xl border border-[#21262d] mb-5">
                <div className="w-10 h-10 bg-brand-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <ShoppingCart className="w-5 h-5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#e6edf3] truncate">{reservModal.product.name}</p>
                  <p className="text-xs text-[#8b949e]">{fmtPrice(reservModal.product.sale_price)} · {reservModal.product.unit}</p>
                </div>
                <span className="text-base font-bold text-brand-400">{fmtPrice(reservModal.product.sale_price)}</span>
              </div>

              {reservSuccess ? (
                <div className="text-center py-6">
                  <div className="w-14 h-14 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/30">
                    <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h4 className="text-base font-semibold text-[#e6edf3] mb-2">¡Reservación creada!</h4>
                  <p className="text-sm text-[#8b949e]">{reservSuccess}</p>
                  <button
                    onClick={() => setReservModal({ product: null })}
                    className="mt-5 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-all"
                  >
                    Cerrar
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReservation} className="space-y-4">
                  <div>
                    <label className="label">Tu nombre *</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]" />
                      <input
                        className="input pl-10"
                        placeholder="Ej: Juan Pérez"
                        value={reservForm.customer_name}
                        onChange={e => setReservForm(f => ({ ...f, customer_name: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label">Teléfono (opcional)</label>
                    <div className="relative">
                      {reservForm.customer_phone.trim() ? (
                        PHONE_REGEX.test(reservForm.customer_phone.trim()) ? (
                          <CheckCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                        ) : (
                          <PhoneOff className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                        )
                      ) : (
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]" />
                      )}
                      <input
                        className={`input pl-10 ${
                          phoneTouched && reservForm.customer_phone.trim()
                            ? PHONE_REGEX.test(reservForm.customer_phone.trim())
                              ? 'border-green-500/50 focus:border-green-500 focus:ring-green-500/20'
                              : 'border-amber-500/50 focus:border-amber-500 focus:ring-amber-500/20'
                            : ''
                        }`}
                        placeholder="Ej: +53 55280263"
                        value={reservForm.customer_phone}
                        onChange={e => setReservForm(f => ({ ...f, customer_phone: e.target.value }))}
                        onFocus={() => setPhoneTouched(true)}
                      />
                      {/* Status hint */}
                      {phoneTouched && reservForm.customer_phone.trim() && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {PHONE_REGEX.test(reservForm.customer_phone.trim()) ? (
                            <span className="text-[10px] text-green-400 font-medium">Válido</span>
                          ) : (
                            <span className="text-[10px] text-amber-400 font-medium">Inválido</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="label">Cantidad *</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max={reservModal.product.stock}
                        step="1"
                        className="input text-center font-semibold"
                        value={reservForm.quantity}
                        onChange={e => setReservForm(f => ({ ...f, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
                        required
                      />
                      <span className="text-sm text-[#6e7681] min-w-[60px]">
                        {reservModal.product.unit}(s)
                      </span>
                    </div>
                    <p className="text-[10px] text-[#6e7681] mt-1">
                      Disponible: {reservModal.product.stock} {reservModal.product.unit}(s)
                    </p>
                  </div>

                  <div>
                    <label className="label">Notas (opcional)</label>
                    <input
                      className="input"
                      placeholder="Ej: Prefiero que me llamen en la tarde"
                      value={reservForm.notes}
                      onChange={e => setReservForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </div>

                  {/* Total price summary */}
                  <div className="bg-[#0d1117] rounded-xl border border-[#21262d] p-3 flex items-center justify-between">
                    <span className="text-sm text-[#8b949e]">Total estimado:</span>
                    <span className="text-lg font-bold text-brand-400">
                      {fmtPrice(reservModal.product.sale_price * reservForm.quantity)}
                    </span>
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

                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setReservModal({ product: null })}
                      disabled={reservSaving}
                      className="btn-secondary flex-1 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={reservSaving || !reservForm.customer_name.trim() || reservForm.quantity <= 0}
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
                          Reservar
                        </span>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ──────── FOOTER ──────── */}
      <footer className="border-t border-[#21262d] bg-[#161b22]/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="col-span-2 md:col-span-1">
              <Link href="/" className="flex items-center gap-3 mb-4">
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
