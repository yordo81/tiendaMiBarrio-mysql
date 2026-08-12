'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { api, type PrinterDto } from '@/lib/api-client';
import { toast } from '@/components/ui/toaster';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useSettingsStore, type BusinessSettings } from '@/lib/stores/settings-store';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  Store, Settings, Upload, X, CalendarDays, Clock3, Save, Loader2, ShieldAlert,
  Printer, Usb, CheckCircle2, Ruler, Zap, Plus, Star, Pencil, Trash2, Info,
  CalendarCheck, TabletSmartphone,
} from 'lucide-react';
import { pickUsbPrinter, printUsbTest, isWebUsbSupported, type UsbPrinterInfo } from '@/lib/receipt';

// ── Página de Configuración (por pestañas) ───────────────────────
// Solo el dueño (role = 'owner') puede editar la identidad del negocio
// (nombre y logotipo), elegir el modo de operación (por días o por turnos)
// y administrar las impresoras de tickets (cuál imprime el comprobante).

type TabKey = 'negocio' | 'operacion' | 'impresion';

const TABS: { key: TabKey; label: string; icon: React.ElementType; desc: string }[] = [
  { key: 'negocio', label: 'Negocio', icon: Store, desc: 'Nombre y logotipo' },
  { key: 'operacion', label: 'Operación', icon: CalendarDays, desc: 'Jornada de caja' },
  { key: 'impresion', label: 'Impresión', icon: Printer, desc: 'Tickets e impresoras' },
];

export default function ConfiguracionPage() {
  const { user } = useAuthStore();
  const setSettings = useSettingsStore(s => s.setSettings);
  const [tab, setTab] = useState<TabKey>('negocio');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<BusinessSettings>({ business_name: 'TiendaMiBarrio', logo_url: null, work_mode: 'daily', receipt_printer_width: '80', receipt_print_method: 'browser', receipt_auto_print: true, show_reservations: true, enable_touch_pos: true });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Impresoras registradas
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [usbBusy, setUsbBusy] = useState(false);
  const [registerTarget, setRegisterTarget] = useState<UsbPrinterInfo | null>(null);
  const [registerName, setRegisterName] = useState('');
  const [registerDefault, setRegisterDefault] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PrinterDto | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PrinterDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [defaultBusyId, setDefaultBusyId] = useState<string | null>(null);
  const [usbSupported] = useState(() => isWebUsbSupported());

  const load = useCallback(async () => {
    try {
      const d = await api.getSettings();
      const s = d.settings;
      setForm({ ...s });
      setLogoPreview(s.logo_url ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar la configuración');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadPrinters = useCallback(async () => {
    try {
      const d = await api.getPrinters();
      setPrinters(d.printers);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar las impresoras');
    } finally {
      setPrintersLoading(false);
    }
  }, []);
  useEffect(() => { loadPrinters(); }, [loadPrinters]);

  async function handleLogoFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('El logotipo debe ser una imagen');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El logotipo no puede superar 5MB');
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function uploadLogo(): Promise<string | null> {
    if (!logoFile) return form.logo_url;
    setUploading(true);
    try {
      const data = await api.uploadImage(logoFile, 'logo');
      return data.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al subir el logotipo');
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.business_name.trim()) {
      toast.error('El nombre del negocio es obligatorio');
      return;
    }
    setSaving(true);
    try {
      const logoUrl = await uploadLogo();
      if (logoUrl === null && logoFile) return; // falló la subida del logo
      const d = await api.updateSettings({
        business_name: form.business_name.trim(),
        logo_url: logoUrl,
        work_mode: form.work_mode,
        receipt_printer_width: form.receipt_printer_width,
        receipt_print_method: form.receipt_print_method,
        receipt_auto_print: form.receipt_auto_print,
        show_reservations: form.show_reservations,
        enable_touch_pos: form.enable_touch_pos,
      });
      setSettings(d.settings);
      setForm(d.settings);
      setLogoFile(null);
      setLogoPreview(d.settings.logo_url ?? '');
      toast.success('Configuración guardada correctamente');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar la configuración');
    } finally {
      setSaving(false);
    }
  }

  // ── Gestor de impresoras ───────────────────────────────────────
  async function handlePickAndRegister() {
    setUsbBusy(true);
    try {
      const info = await pickUsbPrinter();
      setRegisterTarget(info);
      setRegisterName(info.name);
      setRegisterDefault(printers.length === 0);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return; // usuario canceló el selector
      toast.error(e instanceof Error ? e.message : 'Error al seleccionar la impresora');
    } finally {
      setUsbBusy(false);
    }
  }

  async function handleRegister() {
    if (!registerTarget) return;
    setRegistering(true);
    try {
      await api.registerPrinter({
        name: registerName.trim() || registerTarget.name,
        vendor_id: registerTarget.vendorId,
        product_id: registerTarget.productId,
        serial_number: registerTarget.serialNumber || undefined,
        is_default: registerDefault,
      });
      toast.success('Impresora registrada correctamente');
      setRegisterTarget(null);
      loadPrinters();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar la impresora');
    } finally {
      setRegistering(false);
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameName.trim()) return;
    setRenaming(true);
    try {
      await api.updatePrinter(renameTarget.id, { name: renameName.trim() });
      toast.success('Impresora renombrada');
      setRenameTarget(null);
      loadPrinters();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al renombrar la impresora');
    } finally {
      setRenaming(false);
    }
  }

  async function handleSetDefault(p: PrinterDto) {
    setDefaultBusyId(p.id);
    try {
      await api.updatePrinter(p.id, { is_default: true });
      toast.success(`"${p.name}" será la impresora de los tickets`);
      loadPrinters();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al asignar la impresora');
    } finally {
      setDefaultBusyId(null);
    }
  }

  async function handleTestPrint(p: PrinterDto) {
    setTestingId(p.id);
    try {
      await printUsbTest(form.receipt_printer_width, {
        vendorId: Number(p.vendor_id),
        productId: Number(p.product_id),
        serialNumber: p.serial_number ? String(p.serial_number) : undefined,
      });
      toast.success('Ticket de prueba enviado a la impresora');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al imprimir la prueba');
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deletePrinter(deleteTarget.id);
      toast.success('Impresora eliminada');
      setDeleteTarget(null);
      loadPrinters();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar la impresora');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (user?.role !== 'owner') {
    return (
      <div className="card p-10 text-center max-w-lg mx-auto mt-10">
        <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-7 h-7 text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Sin permisos</h2>
        <p className="text-sm text-[var(--text-tertiary)] mt-2">Solo el dueño del negocio puede acceder al módulo de Configuración.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-brand-500/15 rounded-xl flex items-center justify-center">
          <Settings className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Configuración</h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Personaliza la identidad de tu negocio, cómo opera el sistema y la impresión de tickets</p>
        </div>
      </div>

      {/* ── Pestañas ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 border-b border-[var(--border-primary)]">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm whitespace-nowrap transition-all duration-200',
              tab === t.key
                ? 'bg-brand-600/20 text-brand-400 font-medium shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)]'
            )}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ════ PESTAÑA: NEGOCIO ════ */}
      {tab === 'negocio' && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Identidad del negocio</h2>
          <p className="text-xs text-[var(--text-tertiary)] mb-5">El nombre y logotipo se muestran en todo el sistema: dashboard, login, catálogo público y el título del navegador.</p>

          <div className="flex flex-col sm:flex-row gap-6">
            {/* Logo */}
            <div className="flex flex-col items-center gap-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleLogoFile(f);
                }}
                className={cn(
                  'w-28 h-28 rounded-2xl border-2 border-dashed flex items-center justify-center overflow-hidden cursor-pointer transition-all duration-200 group',
                  dragOver ? 'border-brand-500 bg-brand-500/10 scale-105' : 'border-[var(--border-secondary)] hover:border-brand-500/50 bg-[var(--bg-primary)]'
                )}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Logotipo" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-[var(--text-tertiary)] group-hover:text-brand-400 transition-colors">
                    <Store className="w-8 h-8" />
                    <span className="text-[10px] font-medium">Subir logo</span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = ''; }}
              />
              <div className="flex items-center gap-1.5">
                <button onClick={() => fileInputRef.current?.click()} className="btn-secondary text-xs px-2.5 py-1.5">
                  <Upload className="w-3 h-3" /> Cambiar
                </button>
                {logoPreview && (
                  <button
                    onClick={() => { setLogoFile(null); setLogoPreview(''); setForm(f => ({ ...f, logo_url: null })); }}
                    className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Quitar logotipo"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Nombre */}
            <div className="flex-1">
              <label className="label">Nombre del negocio *</label>
              <div className="relative">
                <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                <input
                  className="input pl-9"
                  placeholder="Ej: Tienda Mi Barrio"
                  value={form.business_name}
                  maxLength={120}
                  onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
                />
              </div>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{form.business_name.length}/120 caracteres</p>

              {/* Preview */}
              <div className="mt-4 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center bg-brand-600 shrink-0">
                  {logoPreview ? (
                    <img src={logoPreview} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <Store className="w-4 h-4 text-white" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{form.business_name || 'Nombre del negocio'}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">Así se verá en el sistema</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ PESTAÑA: OPERACIÓN ════ */}
      {tab === 'operacion' && (
        <>
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Modo de operación</h2>
          <p className="text-xs text-[var(--text-tertiary)] mb-5">Define cómo el sistema organiza la jornada de caja.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setForm(f => ({ ...f, work_mode: 'daily' }))}
              className={cn(
                'text-left p-4 rounded-xl border-2 transition-all duration-200',
                form.work_mode === 'daily'
                  ? 'border-brand-500 bg-brand-500/10 shadow-lg shadow-brand-600/10'
                  : 'border-[var(--border-secondary)] bg-[var(--bg-primary)] hover:border-[#6e7681]'
              )}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', form.work_mode === 'daily' ? 'bg-brand-500/20 text-brand-400' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]')}>
                  <CalendarDays className="w-4.5 h-4.5" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">Por días</span>
              </div>
              <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
                La caja se controla por jornada diaria. Recomendado para negocios con horario fijo.
              </p>
            </button>

            <button
              onClick={() => setForm(f => ({ ...f, work_mode: 'shifts' }))}
              className={cn(
                'text-left p-4 rounded-xl border-2 transition-all duration-200',
                form.work_mode === 'shifts'
                  ? 'border-brand-500 bg-brand-500/10 shadow-lg shadow-brand-600/10'
                  : 'border-[var(--border-secondary)] bg-[var(--bg-primary)] hover:border-[#6e7681]'
              )}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', form.work_mode === 'shifts' ? 'bg-brand-500/20 text-brand-400' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]')}>
                  <Clock3 className="w-4.5 h-4.5" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">Por turnos</span>
              </div>
              <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
                Cada empleado abre y cierra su turno de caja con arqueo (fondo inicial, ventas y diferencia). Ideal si hay varios turnos al día.
              </p>
            </button>
          </div>

          {form.work_mode === 'shifts' && (
            <div className="mt-4 bg-brand-500/5 border border-brand-500/20 rounded-xl px-4 py-3 text-xs text-brand-300">
              <p className="font-medium">Modo por turnos activado</p>
              <p className="text-[var(--text-secondary)] mt-0.5">Aparecerá el módulo <b>Turnos</b> en el menú, donde podrás abrir y cerrar turnos con arqueo de caja (efectivo esperado vs. contado).</p>
            </div>
          )}
        </div>

        {/* ── Módulos del sistema ── */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Módulos del sistema</h2>
          <p className="text-xs text-[var(--text-tertiary)] mb-5">Activa o desactiva módulos según las necesidades de tu negocio.</p>

          <label className="flex items-start gap-3 cursor-pointer select-none max-w-2xl">
            <input
              type="checkbox"
              checked={form.show_reservations}
              onChange={e => setForm(f => ({ ...f, show_reservations: e.target.checked }))}
              className="mt-0.5 w-4 h-4 accent-brand-500"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                <CalendarCheck className="w-4 h-4 text-brand-400" />
                Reservaciones y catálogo público
              </span>
              <span className="block text-xs text-[var(--text-tertiary)] mt-1">
                Muestra el catálogo de productos con pedidos de clientes en la <b>página de entrada</b> y el módulo <b>Reservaciones</b> en el menú del dashboard.
                Al desactivarlo, la página de entrada será la de <b>inicio</b> y el módulo desaparecerá del sistema.
              </span>
            </span>
          </label>

          <label className="mt-5 pt-5 border-t border-[var(--border-primary)] flex items-start gap-3 cursor-pointer select-none max-w-2xl">
            <input
              type="checkbox"
              checked={form.enable_touch_pos}
              onChange={e => setForm(f => ({ ...f, enable_touch_pos: e.target.checked }))}
              className="mt-0.5 w-4 h-4 accent-brand-500"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                <TabletSmartphone className="w-4 h-4 text-brand-400" />
                Punto de venta táctil para vendedores
              </span>
              <span className="block text-xs text-[var(--text-tertiary)] mt-1">
                Los vendedores registran sus ventas en el <b>POS táctil</b> (pantalla completa con catálogo por categorías y carrito) en lugar de la ventana modal.
                Al desactivarlo, los vendedores usan la página de <b>Ventas</b> con la ventana de nueva venta.
              </span>
            </span>
          </label>
        </div>
        </>
      )}

      {/* ════ PESTAÑA: IMPRESIÓN ════ */}
      {tab === 'impresion' && (
        <>
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Ticket del cliente</h2>
            <p className="text-xs text-[var(--text-tertiary)] mb-5">
              Configura la impresora térmica que imprime el comprobante del cliente al registrar cada venta (57 mm u 80 mm).
            </p>

            {/* Ancho del papel */}
            <div className="mb-5">
              <p className="label mb-2">Ancho del papel</p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                {([['57', '57 mm', 'Papel angosto (ticket corto)'], ['80', '80 mm', 'Papel ancho (ticket estándar)']] as const).map(([val, label, desc]) => (
                  <button
                    key={val}
                    onClick={() => setForm(f => ({ ...f, receipt_printer_width: val }))}
                    className={cn(
                      'text-left p-4 rounded-xl border-2 transition-all duration-200',
                      form.receipt_printer_width === val
                        ? 'border-brand-500 bg-brand-500/10 shadow-lg shadow-brand-600/10'
                        : 'border-[var(--border-secondary)] bg-[var(--bg-primary)] hover:border-[#6e7681]'
                    )}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', form.receipt_printer_width === val ? 'bg-brand-500/20 text-brand-400' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]')}>
                        <Ruler className="w-4.5 h-4.5" />
                      </div>
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{label}</span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Método de impresión */}
            <div className="mb-5">
              <p className="label mb-2">Método de impresión</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                <button
                  onClick={() => setForm(f => ({ ...f, receipt_print_method: 'browser' }))}
                  className={cn(
                    'text-left p-4 rounded-xl border-2 transition-all duration-200',
                    form.receipt_print_method === 'browser'
                      ? 'border-brand-500 bg-brand-500/10 shadow-lg shadow-brand-600/10'
                      : 'border-[var(--border-secondary)] bg-[var(--bg-primary)] hover:border-[#6e7681]'
                  )}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', form.receipt_print_method === 'browser' ? 'bg-brand-500/20 text-brand-400' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]')}>
                      <Printer className="w-4.5 h-4.5" />
                    </div>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Diálogo del navegador</span>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
                    Al vender se abre el diálogo de impresión y eliges la impresora térmica instalada. Funciona con cualquier impresora (USB, red, Bluetooth) y navegador.
                  </p>
                </button>

                <button
                  onClick={() => setForm(f => ({ ...f, receipt_print_method: 'usb' }))}
                  className={cn(
                    'text-left p-4 rounded-xl border-2 transition-all duration-200',
                    form.receipt_print_method === 'usb'
                      ? 'border-brand-500 bg-brand-500/10 shadow-lg shadow-brand-600/10'
                      : 'border-[var(--border-secondary)] bg-[var(--bg-primary)] hover:border-[#6e7681]'
                  )}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', form.receipt_print_method === 'usb' ? 'bg-brand-500/20 text-brand-400' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]')}>
                      <Usb className="w-4.5 h-4.5" />
                    </div>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Directo por USB (ESC/POS)</span>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
                    Imprime sin diálogo directamente a la impresora. Requiere Chrome o Edge, impresora conectada por USB y conexión segura (HTTPS).
                  </p>
                </button>
              </div>
            </div>

            {/* Impresión automática */}
            <label className="flex items-start gap-3 cursor-pointer select-none max-w-2xl">
              <input
                type="checkbox"
                checked={form.receipt_auto_print}
                onChange={e => setForm(f => ({ ...f, receipt_auto_print: e.target.checked }))}
                className="mt-0.5 w-4 h-4 accent-brand-500"
              />
              <span>
                <span className="block text-sm font-medium text-[var(--text-primary)]">Imprimir ticket automáticamente</span>
                <span className="block text-xs text-[var(--text-tertiary)] mt-0.5">
                  Al confirmar cada venta se imprime el comprobante del cliente sin pasos adicionales. Desactiva esta opción para imprimir solo cuando lo solicites.
                </span>
              </span>
            </label>
          </div>

          {/* ── Gestor de impresoras registradas ── */}
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Impresoras registradas</h2>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  La impresora marcada como <b>predeterminada</b> es la que imprime los tickets al vender en modo USB.
                </p>
              </div>
              <button
                onClick={handlePickAndRegister}
                disabled={usbBusy || !usbSupported}
                className="btn-primary text-xs px-3 py-2 disabled:opacity-50 flex items-center gap-1.5"
              >
                {usbBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {usbBusy ? 'Seleccionando…' : 'Agregar impresora USB'}
              </button>
            </div>

            {!usbSupported && (
              <div className="mt-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-xs text-yellow-300 flex items-start gap-2.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  WebUSB no está disponible en este navegador. Abre la app en <b>Chrome o Edge</b> (HTTPS o localhost) para registrar impresoras y usar la impresión directa por USB.
                </span>
              </div>
            )}

            <div className="mt-4 space-y-2.5">
              {printersLoading ? (
                <div className="flex items-center justify-center py-8"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : printers.length === 0 ? (
                <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-4 py-8 text-center">
                  <Printer className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-2" />
                  <p className="text-sm font-medium text-[var(--text-primary)]">Aún no hay impresoras registradas</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    Conecta una impresora térmica por USB y pulsa <b>Agregar impresora USB</b>. Con el método del navegador no es obligatorio registrar ninguna.
                  </p>
                </div>
              ) : (
                printers.map(p => (
                  <div
                    key={String(p.id)}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                      p.is_default
                        ? 'border-brand-500/40 bg-brand-500/5'
                        : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
                    )}
                  >
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', p.is_default ? 'bg-brand-500/20 text-brand-400' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]')}>
                      <Printer className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{String(p.name)}</span>
                        {p.is_default && (
                          <span className="badge-success text-[10px] px-1.5 py-0.5 flex items-center gap-1">
                            <Star className="w-3 h-3" /> Tickets
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 font-mono">
                        VID {Number(p.vendor_id).toString(16).padStart(4, '0').toUpperCase()} : PID {Number(p.product_id).toString(16).padStart(4, '0').toUpperCase()}
                        {p.serial_number ? ` · SN ${String(p.serial_number)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {!p.is_default && (
                        <button
                          onClick={() => handleSetDefault(p)}
                          disabled={defaultBusyId === p.id}
                          className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors disabled:opacity-50"
                          title="Usar esta impresora para los tickets"
                        >
                          {defaultBusyId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
                        </button>
                      )}
                      <button
                        onClick={() => handleTestPrint(p)}
                        disabled={testingId === p.id}
                        className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                        title="Imprimir ticket de prueba"
                      >
                        {testingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => { setRenameTarget(p); setRenameName(String(p.name)); }}
                        className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                        title="Renombrar"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(p)}
                        className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {printers.length > 0 && (
              <div className="mt-4 bg-[var(--bg-muted)] border border-[var(--border-primary)] rounded-xl px-4 py-3 text-[11px] text-[var(--text-secondary)] flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-green-400" />
                <span>
                  En modo <b>diálogo del navegador</b> la impresora se elige en cada impresión; el registro aquí es opcional. En modo <b>USB</b> los tickets siempre salen por la impresora predeterminada, aunque haya varias conectadas.
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Guardar ── */}
      <div className="flex items-center justify-end gap-3">
        <button onClick={load} className="btn-secondary">Descartar</button>
        <button onClick={handleSave} disabled={saving || uploading || !form.business_name.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
          {saving || uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Guardando...' : uploading ? 'Subiendo logo...' : 'Guardar cambios'}
        </button>
      </div>

      {/* ── Modal: registrar impresora ── */}
      <Modal open={!!registerTarget} onClose={() => !registering && setRegisterTarget(null)} title="Registrar impresora" size="sm">
        {registerTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-3">
              <div className="w-10 h-10 rounded-xl bg-brand-500/15 text-brand-400 flex items-center justify-center shrink-0">
                <Printer className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{registerTarget.name}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
                  VID {registerTarget.vendorId.toString(16).padStart(4, '0').toUpperCase()} : PID {registerTarget.productId.toString(16).padStart(4, '0').toUpperCase()}
                  {registerTarget.serialNumber ? ` · SN ${registerTarget.serialNumber}` : ''}
                </p>
              </div>
            </div>
            <div>
              <label className="label">Nombre de la impresora</label>
              <input
                className="input"
                placeholder="Ej: Impresora caja principal"
                value={registerName}
                maxLength={120}
                onChange={e => setRegisterName(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={registerDefault}
                onChange={e => setRegisterDefault(e.target.checked)}
                className="w-4 h-4 accent-brand-500"
              />
              <span>
                <span className="block text-sm font-medium text-[var(--text-primary)]">Usar para los tickets de venta</span>
                <span className="block text-xs text-[var(--text-tertiary)] mt-0.5">Será la impresora predeterminada de los comprobantes.</span>
              </span>
            </label>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setRegisterTarget(null)} disabled={registering} className="btn-secondary disabled:opacity-50">Cancelar</button>
              <button onClick={handleRegister} disabled={registering || !registerName.trim()} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
                {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {registering ? 'Registrando…' : 'Registrar impresora'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal: renombrar impresora ── */}
      <Modal open={!!renameTarget} onClose={() => !renaming && setRenameTarget(null)} title="Renombrar impresora" size="sm">
        {renameTarget && (
          <div className="space-y-4">
            <div>
              <label className="label">Nombre de la impresora</label>
              <input
                className="input"
                placeholder="Ej: Impresora caja principal"
                value={renameName}
                maxLength={120}
                onChange={e => setRenameName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setRenameTarget(null)} disabled={renaming} className="btn-secondary disabled:opacity-50">Cancelar</button>
              <button onClick={handleRename} disabled={renaming || !renameName.trim()} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
                {renaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {renaming ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Confirmación: eliminar impresora ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Eliminar impresora"
        message={
          deleteTarget?.is_default
            ? `¿Eliminar "${String(deleteTarget?.name ?? '')}"? Es la impresora de tickets: si hay otras registradas, la más antigua pasará a ser la predeterminada.`
            : `¿Eliminar "${String(deleteTarget?.name ?? '')}"? Ya no aparecerá en la lista de impresoras registradas.`
        }
        confirmLabel="Eliminar"
        loading={deleting}
      />
    </div>
  );
}
