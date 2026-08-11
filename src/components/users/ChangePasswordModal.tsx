'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import { toast } from '@/components/ui/toaster';
import { KeyRound, Eye, EyeOff } from 'lucide-react';

type AnyRecord = Record<string, unknown>;

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * 'self'  → el usuario autenticado cambia SU propia contraseña
   *           (requiere la contraseña actual, usa /api/auth/change-password).
   * 'other' → el dueño cambia la contraseña de OTRO usuario
   *           (no pide la actual, usa PUT /api/users/[id]).
   */
  mode?: 'self' | 'other';
  /** Usuario objetivo (obligatorio en modo 'other') */
  targetUser?: AnyRecord | null;
  onChanged?: () => void;
}

// ── Cambio de contraseña ───────────────────────────────────────────
// Reutilizable desde el Topbar (cada usuario cambia la suya) y desde el
// módulo de Usuarios (el dueño cambia la de cualquier usuario).

export default function ChangePasswordModal({
  open, onClose, mode = 'self', targetUser, onChanged,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShow(false);
    }
  }, [open]);

  const isSelf = mode === 'self';
  const title = isSelf ? 'Cambiar mi contraseña' : `Cambiar contraseña de ${String(targetUser?.name ?? 'usuario')}`;

  async function handleSave() {
    if (!isSelf && !targetUser?.id) { toast.error('Usuario inválido'); return; }
    if (newPassword.length < 6) { toast.error('La nueva contraseña debe tener al menos 6 caracteres'); return; }
    if (newPassword !== confirmPassword) { toast.error('Las contraseñas no coinciden'); return; }
    if (isSelf && !currentPassword) { toast.error('Indica tu contraseña actual'); return; }
    setSaving(true);
    try {
      if (isSelf) {
        await api.changeOwnPassword({ current_password: currentPassword, new_password: newPassword });
      } else {
        await api.updateUser(String(targetUser!.id), { password: newPassword });
      }
      toast.success(isSelf ? 'Contraseña actualizada correctamente' : 'Contraseña actualizada');
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cambiar la contraseña');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        {isSelf && (
          <div>
            <label className="label">Contraseña actual</label>
            <input
              type={show ? 'text' : 'password'}
              className="input"
              placeholder="Tu contraseña actual"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        )}
        <div>
          <label className="label">Nueva contraseña</label>
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              className="input pr-10"
              placeholder="Mínimo 6 caracteres"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShow(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="label">Confirmar nueva contraseña</label>
          <input
            type={show ? 'text' : 'password'}
            className="input"
            placeholder="Repite la nueva contraseña"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          />
        </div>

        <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] p-3 text-xs text-[var(--text-tertiary)] flex items-start gap-2">
          <KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
          <span>
            {isSelf
              ? 'Verificaremos tu contraseña actual antes de guardar el cambio.'
              : 'Podrás iniciar sesión con esta nueva contraseña.'}
          </span>
        </div>

        <div className="flex flex-col xs:flex-row gap-2 xs:gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
