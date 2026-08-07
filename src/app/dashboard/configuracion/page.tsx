'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { toast } from '@/components/ui/toaster';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useSettingsStore, type BusinessSettings } from '@/lib/stores/settings-store';
import { Store, Settings, Upload, X, CalendarDays, Clock3, Save, Loader2, ShieldAlert } from 'lucide-react';

// ── Página de Configuración ───────────────────────────────────────
// Solo el dueño (role = 'owner') puede editar la identidad del negocio
// (nombre y logotipo) y elegir el modo de operación: por días o por turnos.
// Guarda los cambios vía /api/settings y los publica en el settings-store.

export default function ConfiguracionPage() {
  const { user } = useAuthStore();
  const setSettings = useSettingsStore(s => s.setSettings);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<BusinessSettings>({ business_name: 'TiendaMiBarrio', logo_url: null, work_mode: 'daily' });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.getSettings();
      const s = d.settings;
      setForm({ business_name: s.business_name, logo_url: s.logo_url, work_mode: s.work_mode });
      setLogoPreview(s.logo_url ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar la configuración');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

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
      const d = await api.updateSettings({ business_name: form.business_name.trim(), logo_url: logoUrl, work_mode: form.work_mode });
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
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-brand-500/15 rounded-xl flex items-center justify-center">
          <Settings className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Configuración</h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Personaliza la identidad de tu negocio y cómo opera el sistema</p>
        </div>
      </div>

      {/* ── Identidad del negocio ── */}
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

      {/* ── Modo de operación ── */}
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

      {/* ── Guardar ── */}
      <div className="flex items-center justify-end gap-3">
        <button onClick={load} className="btn-secondary">Descartar</button>
        <button onClick={handleSave} disabled={saving || uploading || !form.business_name.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
          {saving || uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Guardando...' : uploading ? 'Subiendo logo...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}
