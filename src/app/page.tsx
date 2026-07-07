'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/lib/stores/auth-store';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Truck,
  TrendingDown,
  BarChart2,
  UserCog,
  Warehouse,
  ArrowRightLeft,
  ShoppingBag,
  Shield,
  DollarSign,
  ArrowRight,
  Menu,
  X,
  Store,
  TrendingUp,
  Zap,
  Clock,
  ChevronRight,
  CalendarCheck,
} from 'lucide-react';

export default function HomePage() {
  const { user } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMobileMenuOpen(false);
  };

  const navLinks = [
    { id: 'hero', label: 'Inicio' },
    { id: 'productos', label: 'Productos', isExternal: true },
    { id: 'features', label: 'Características' },
    { id: 'modules', label: 'Módulos' },
    { id: 'cta', label: 'Contacto' },
  ];

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
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-md shadow-brand-600/30 group-hover:shadow-brand-600/50 transition-all duration-300">
                <Store className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="font-display text-[#e6edf3] text-lg leading-tight block">
                  TiendaMiBarrio
                </span>
                <span className="text-[10px] text-brand-400 uppercase tracking-widest font-medium">
                  Sistema de Gestión
                </span>
              </div>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map(({ id, label, isExternal }) =>
                isExternal ? (
                  <Link
                    key={id}
                    href="/productos"
                    className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all duration-150"
                  >
                    {label}
                  </Link>
                ) : (
                  <button
                    key={id}
                    onClick={() => scrollTo(id)}
                    className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all duration-150"
                  >
                    {label}
                  </button>
                )
              )}
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

              {/* Mobile menu toggle */}
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

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#21262d] bg-[#0d1117]/95 backdrop-blur-md">
            <div className="px-4 py-4 space-y-1">
              {navLinks.map(({ id, label, isExternal }) =>
                isExternal ? (
                  <Link
                    key={id}
                    href="/productos"
                    className="block w-full text-left px-4 py-3 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {label}
                  </Link>
                ) : (
                  <button
                    key={id}
                    onClick={() => scrollTo(id)}
                    className="block w-full text-left px-4 py-3 text-sm text-[#8b949e] hover:text-[#e6edf3] rounded-lg hover:bg-[#1c2128] transition-all"
                  >
                    {label}
                  </button>
                )
              )}
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

      {/* ──────── HERO SECTION ──────── */}
      <section
        id="hero"
        className="relative min-h-screen flex items-center pt-20 overflow-hidden"
      >
        {/* Background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-brand-600/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-brand-500/5 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-400/3 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left — text content */}
            <div className="space-y-8">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500/10 border border-brand-500/20 rounded-full">
                <Zap className="w-4 h-4 text-brand-400" />
                <span className="text-sm font-medium text-brand-400">
                  Sistema de Gestión Integral
                </span>
              </div>

              {/* Heading */}
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl text-[#e6edf3] leading-tight">
                Gestiona tu{' '}
                <span className="text-brand-400">tienda de barrio</span>{' '}
                con facilidad
              </h1>

              <p className="text-lg text-[#8b949e] max-w-lg leading-relaxed">
                Controla inventario, ventas, gastos y clientes desde un solo
                lugar. Una solución simple, moderna y poderosa para tu negocio.
              </p>

              {/* CTA buttons */}
              <div className="flex flex-wrap gap-4">
                {user ? (
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 px-8 py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-brand-600/30 hover:shadow-brand-600/50 hover:-translate-y-0.5"
                  >
                    Ir al Dashboard
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <Link
                    href="/auth/login"
                    className="inline-flex items-center gap-2 px-8 py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-brand-600/30 hover:shadow-brand-600/50 hover:-translate-y-0.5"
                  >
                    Comenzar ahora
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
                <button
                  onClick={() => scrollTo('features')}
                  className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#21262d] hover:bg-[#2d333b] text-[#e6edf3] font-semibold rounded-xl border border-[#30363d] transition-all duration-200 hover:-translate-y-0.5"
                >
                  Conocer más
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Trust stats bar */}
              <div className="flex items-center gap-8 pt-4">
                <div>
                  <p className="text-2xl font-bold text-[#e6edf3]">100%</p>
                  <p className="text-xs text-[#6e7681]">Offline-first</p>
                </div>
                <div className="w-px h-10 bg-[#21262d]" />
                <div>
                  <p className="text-2xl font-bold text-[#e6edf3]">Open Source</p>
                  <p className="text-xs text-[#6e7681]">Código abierto</p>
                </div>
                <div className="w-px h-10 bg-[#21262d]" />
                <div>
                  <p className="text-2xl font-bold text-[#e6edf3]">MySQL</p>
                  <p className="text-xs text-[#6e7681]">Base de datos</p>
                </div>
              </div>
            </div>

            {/* Right — dashboard mockup card */}
            <div className="hidden lg:flex items-center justify-center">
              <div className="relative">
                {/* Main mockup card */}
                <div className="card p-8 w-[480px] shadow-2xl shadow-brand-600/10 rotate-2 hover:rotate-0 transition-transform duration-500">
                  <div className="space-y-5">
                    {/* Mock header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-brand-600/30 rounded-lg flex items-center justify-center">
                          <ShoppingCart className="w-4 h-4 text-brand-400" />
                        </div>
                        <span className="text-sm font-semibold text-[#e6edf3]">
                          Dashboard
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <div className="w-2 h-2 rounded-full bg-yellow-500" />
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                      </div>
                    </div>

                    {/* Mock stat cards */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Ventas hoy', value: '$12,450', color: 'bg-brand-500' },
                        { label: 'Ganancia', value: '$4,230', color: 'bg-green-500' },
                        { label: 'Stock bajo', value: '3', color: 'bg-yellow-500' },
                      ].map((stat, i) => (
                        <div
                          key={i}
                          className="bg-[#0d1117] rounded-lg p-3 border border-[#21262d]"
                        >
                          <p className="text-[10px] text-[#6e7681]">{stat.label}</p>
                          <p className="text-lg font-bold text-[#e6edf3] mt-0.5">
                            {stat.value}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Mock chart bars */}
                    <div className="bg-[#0d1117] rounded-lg p-4 border border-[#21262d]">
                      <p className="text-xs text-[#6e7681] mb-3">
                        Ventas últimos 7 días
                      </p>
                      <div className="flex items-end gap-2 h-24">
                        {[
                          { day: 'Lun', h: 35 },
                          { day: 'Mar', h: 50 },
                          { day: 'Mié', h: 45 },
                          { day: 'Jue', h: 70 },
                          { day: 'Vie', h: 55 },
                          { day: 'Sáb', h: 85 },
                          { day: 'Dom', h: 65 },
                        ].map(({ day, h }, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full bg-brand-500/20 rounded-t relative h-20">
                              <div
                                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-brand-500 to-brand-400 rounded-t transition-all duration-500"
                                style={{ height: `${h}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-[#6e7681]">{day}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Mock feature list */}
                    <div className="space-y-2.5">
                      {[
                        'Control de Inventario en Tiempo Real',
                        'Gestión de Ventas y Clientes',
                        'Reportes y Análisis',
                      ].map((item, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2.5 text-xs text-[#8b949e]"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Floating accent cards */}
                <div className="absolute -top-6 -right-6 w-24 h-24 bg-[#161b22] border border-[#30363d] rounded-2xl shadow-xl flex items-center justify-center -rotate-6 hover:rotate-0 transition-all duration-300">
                  <Package className="w-8 h-8 text-brand-400" />
                </div>
                <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-[#161b22] border border-[#30363d] rounded-2xl shadow-xl flex items-center justify-center rotate-6 hover:rotate-0 transition-all duration-300">
                  <BarChart2 className="w-7 h-7 text-green-400" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden md:block">
          <div className="w-6 h-10 border-2 border-[#30363d] rounded-full flex justify-center p-1 animate-bounce">
            <div className="w-1.5 h-3 bg-brand-400 rounded-full" />
          </div>
        </div>
      </section>

      {/* ──────── FEATURES STRIP ──────── */}
      <section className="py-14 border-y border-[#21262d] bg-[#161b22]/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 lg:gap-8">
            {[
              {
                icon: Zap,
                title: 'Rápido y Ligero',
                desc: 'Interfaz optimizada para el trabajo diario',
              },
              {
                icon: Clock,
                title: 'Tiempo Real',
                desc: 'Datos actualizados al instante',
              },
              {
                icon: Shield,
                title: 'Seguro',
                desc: 'Datos protegidos y respaldados',
              },
              {
                icon: TrendingUp,
                title: 'Escalable',
                desc: 'Crece con tu negocio sin límites',
              },
            ].map(({ icon: Icon, title, desc }, i) => (
              <div key={i} className="text-center p-4 group">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-500/10 rounded-xl mb-3 group-hover:bg-brand-500/20 transition-colors">
                  <Icon className="w-6 h-6 text-brand-400" />
                </div>
                <h3 className="text-sm font-semibold text-[#e6edf3] mb-1">
                  {title}
                </h3>
                <p className="text-xs text-[#6e7681]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────── FEATURES SECTION ──────── */}
      <section id="features" className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-brand-500/10 border border-brand-500/20 rounded-full mb-6">
              <span className="text-sm font-medium text-brand-400">
                Características
              </span>
            </div>
            <h2 className="font-display text-3xl sm:text-4xl text-[#e6edf3] mb-4">
              Todo lo que necesitas para gestionar tu tienda
            </h2>
            <p className="text-[#8b949e] max-w-2xl mx-auto">
              Un sistema completo con todas las herramientas necesarias para
              administrar tu negocio de manera eficiente y profesional.
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Package,
                title: 'Control de Inventario',
                desc: 'Gestiona productos, stock mínimo, y recibe alertas cuando sea necesario reponer.',
                gradient: 'from-blue-500/20 to-blue-600/10',
              },
              {
                icon: ShoppingCart,
                title: 'Gestión de Ventas',
                desc: 'Registra ventas, maneja pagos en efectivo, transferencia y crédito de forma sencilla.',
                gradient: 'from-emerald-500/20 to-emerald-600/10',
              },
              {
                icon: Users,
                title: 'Clientes',
                desc: 'Administra tu cartera de clientes y controla saldos pendientes con facilidad.',
                gradient: 'from-purple-500/20 to-purple-600/10',
              },
              {
                icon: Truck,
                title: 'Proveedores',
                desc: 'Mantén un registro de tus proveedores y precios de compra actualizados.',
                gradient: 'from-orange-500/20 to-orange-600/10',
              },
              {
                icon: TrendingDown,
                title: 'Gastos',
                desc: 'Controla todos los gastos operativos del negocio y categorízalos.',
                gradient: 'from-rose-500/20 to-rose-600/10',
              },
              {
                icon: BarChart2,
                title: 'Reportes',
                desc: 'Obtén reportes detallados de ventas, rentabilidad y rendimiento del negocio.',
                gradient: 'from-cyan-500/20 to-cyan-600/10',
              },
            ].map(({ icon: Icon, title, desc, gradient }, i) => (
              <div
                key={i}
                className="group card p-6 hover:border-brand-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-600/5"
              >
                <div
                  className={`inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4 bg-gradient-to-br ${gradient}`}
                >
                  <Icon className="w-6 h-6 text-[#e6edf3]" />
                </div>
                <h3 className="text-lg font-semibold text-[#e6edf3] mb-2 group-hover:text-brand-400 transition-colors">
                  {title}
                </h3>
                <p className="text-sm text-[#8b949e] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────── MODULES SECTION ──────── */}
      <section id="modules" className="py-20 lg:py-28 bg-[#161b22]/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-brand-500/10 border border-brand-500/20 rounded-full mb-6">
              <span className="text-sm font-medium text-brand-400">Módulos</span>
            </div>
            <h2 className="font-display text-3xl sm:text-4xl text-[#e6edf3] mb-4">
              Módulos del Sistema
            </h2>
            <p className="text-[#8b949e] max-w-2xl mx-auto">
              Cada módulo está diseñado para cubrir un aspecto específico de tu
              negocio, accesible según tu rol.
            </p>
          </div>

          {/* Modules grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[
              { icon: Package, name: 'Inventario', desc: 'Productos y stock' },
              { icon: ShoppingBag, name: 'Compras', desc: 'Órdenes de compra' },
              { icon: ShoppingCart, name: 'Ventas', desc: 'Punto de venta' },
              { icon: Users, name: 'Clientes', desc: 'Cartera de clientes' },
              { icon: Truck, name: 'Proveedores', desc: 'Gestión proveedores' },
              { icon: TrendingDown, name: 'Gastos', desc: 'Gastos operativos' },
              { icon: DollarSign, name: 'Contabilidad', desc: 'Libro diario' },
              { icon: BarChart2, name: 'Reportes', desc: 'Análisis y métricas' },
              { icon: Warehouse, name: 'Almacenes', desc: 'Multi-ubicación' },
              { icon: ArrowRightLeft, name: 'Traslados', desc: 'Entre almacenes' },
              { icon: Shield, name: 'Auditoría', desc: 'Registro de cambios' },
              { icon: CalendarCheck, name: 'Reservaciones', desc: 'Pedidos de clientes' },
              { icon: UserCog, name: 'Usuarios', desc: 'Roles y permisos' },
            ].map(({ icon: Icon, name, desc }, i) => (
              <div
                key={i}
                className="group card p-5 text-center hover:border-brand-500/30 transition-all duration-300 hover:-translate-y-0.5 cursor-default"
              >
                <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-500/10 rounded-xl mb-3 group-hover:bg-brand-500/20 transition-colors">
                  <Icon className="w-6 h-6 text-brand-400" />
                </div>
                <h3 className="text-sm font-semibold text-[#e6edf3] mb-0.5">
                  {name}
                </h3>
                <p className="text-xs text-[#6e7681]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────── CTA SECTION ──────── */}
      <section id="cta" className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-900/40 via-brand-700/20 to-[#161b22] border border-brand-500/20 p-8 md:p-12 lg:p-16">
            {/* Decorative blobs */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/5 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-brand-400/5 rounded-full blur-3xl" />

            <div className="relative grid lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-brand-500/15 border border-brand-500/25 rounded-full">
                  <Zap className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-medium text-brand-400">
                    Comienza ahora
                  </span>
                </div>
                <h2 className="font-display text-3xl sm:text-4xl text-[#e6edf3] leading-tight">
                  ¿Listo para optimizar tu negocio?
                </h2>
                <p className="text-[#8b949e] max-w-md leading-relaxed">
                  Únete a otros dueños de negocio que ya están usando
                  TiendaMiBarrio para gestionar sus tiendas de manera eficiente
                  y profesional.
                </p>
                <div className="flex flex-wrap gap-3">
                  {user ? (
                    <Link
                      href="/dashboard"
                      className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-brand-600/30 hover:shadow-brand-600/50 hover:-translate-y-0.5"
                    >
                      Ir al Dashboard
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  ) : (
                    <Link
                      href="/auth/login"
                      className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-brand-600/30 hover:shadow-brand-600/50 hover:-translate-y-0.5"
                    >
                      Acceder al Sistema
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  )}
                  {!user && (
                    <Link
                      href="/auth/login"
                      className="inline-flex items-center gap-2 px-6 py-3 bg-[#21262d] hover:bg-[#2d333b] text-[#e6edf3] font-semibold rounded-xl border border-[#30363d] transition-all duration-200 hover:-translate-y-0.5"
                    >
                      Crear Cuenta
                    </Link>
                  )}
                </div>
              </div>

              {/* Stats grid */}
              <div className="hidden lg:flex justify-center">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { number: '12+', label: 'Módulos' },
                    { number: '100%', label: 'Offline' },
                    { number: 'MySQL', label: 'Base datos' },
                    { number: 'Gratis', label: 'Open Source' },
                  ].map(({ number, label }, i) => (
                    <div
                      key={i}
                      className="bg-[#0d1117]/60 border border-[#21262d] rounded-xl p-5 text-center backdrop-blur-sm hover:border-brand-500/30 transition-colors"
                    >
                      <p className="text-2xl font-bold text-brand-400">{number}</p>
                      <p className="text-xs text-[#6e7681] mt-1">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ──────── FOOTER ──────── */}
      <footer className="border-t border-[#21262d] bg-[#161b22]/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {/* Brand column */}
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

            {/* Modules links */}
            <div>
              <h4 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">
                Módulos
              </h4>
              <ul className="space-y-2.5">
                {['Inventario', 'Ventas', 'Compras', 'Clientes', 'Reservaciones'].map((item) => (
                  <li key={item}>
                    <span className="text-sm text-[#6e7681] hover:text-[#e6edf3] transition-colors cursor-default">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company links */}
            <div>
              <h4 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">
                Empresa
              </h4>
              <ul className="space-y-2.5">
                {['Acerca de', 'Características', 'Precios', 'FAQ'].map(
                  (item) => (
                    <li key={item}>
                      <span className="text-sm text-[#6e7681] hover:text-[#e6edf3] transition-colors cursor-default">
                        {item}
                      </span>
                    </li>
                  )
                )}
              </ul>
            </div>

            {/* Support links */}
            <div>
              <h4 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">
                Soporte
              </h4>
              <ul className="space-y-2.5">
                {['Documentación', 'Reportar Error', 'Sugerencias', 'Contacto'].map(
                  (item) => (
                    <li key={item}>
                      <span className="text-sm text-[#6e7681] hover:text-[#e6edf3] transition-colors cursor-default">
                        {item}
                      </span>
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-[#21262d] mt-10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-[#6e7681]">
              © {new Date().getFullYear()} TiendaMiBarrio. Todos los derechos
              reservados.
            </p>
            <div className="flex items-center gap-4 text-xs text-[#6e7681]">
              <span className="hover:text-[#e6edf3] transition-colors cursor-default">
                Términos
              </span>
              <span className="hover:text-[#e6edf3] transition-colors cursor-default">
                Privacidad
              </span>
              <span className="hover:text-[#e6edf3] transition-colors cursor-default">
                Licencia
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
