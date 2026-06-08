'use client';
import { useEffect, useState, useCallback } from 'react';
import { classifyRole, cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/toaster';
import { UserCog, Plus, UserX, UserCheck, Shield } from 'lucide-react';
type R = Record<string,unknown>;
type Role = 'owner'|'admin'|'seller'|'warehouse';

const ALL_MODULES = [
  {key:'inventario',label:'Inventario'},{key:'ventas',label:'Ventas'},
  {key:'clientes',label:'Clientes'},{key:'proveedores',label:'Proveedores'},
  {key:'gastos',label:'Gastos'},{key:'reportes',label:'Reportes'},
];
const ALL_ACTIONS = ['read','create','update','delete'] as const;
const ROLE_PRESETS: Record<string,Record<string,string[]>> = {
  admin: { inventario:['read','create','update'], ventas:['read','create','update'], clientes:['read','create','update'], proveedores:['read','create','update'], gastos:['read','create'], reportes:['read'] },
  seller: { ventas:['read','create'], clientes:['read','create'], inventario:['read'] },
  warehouse: { inventario:['read','create','update'], proveedores:['read','create'] },
};

export default function UsuariosPage() {
  const [users, setUsers] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [showPerms, setShowPerms] = useState(false);
  const [editUser, setEditUser] = useState<R|null>(null);
  const [toggleTarget, setToggleTarget] = useState<R|null>(null);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<{module:string;actions:string[]}[]>([]);
  const [inviteForm, setInviteForm] = useState({ email:'', name:'', role:'seller' as Role, password:'' });
  const [editRole, setEditRole] = useState<Role>('seller');
  const { user: me } = useAuthStore();

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.getUsers(); setUsers(d); } catch(e) { toast.error(e instanceof Error?e.message:'Error al cargar usuarios'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openPerms(u: R) {
    setEditUser(u);
    setEditRole(String(u.role??'seller') as Role);
    const existing = (u.permissions as {module:string;actions:string[]}[]|undefined) ?? [];
    setPermissions(ALL_MODULES.map(m => existing.find(p=>p.module===m.key) ?? {module:m.key,actions:[]}));
    setShowPerms(true);
  }

  function toggleAction(module: string, action: string) {
    setPermissions(prev => prev.map(p => {
      if (p.module!==module) return p;
      const has = p.actions.includes(action);
      return {...p, actions: has ? p.actions.filter(a=>a!==action) : [...p.actions,action]};
    }));
  }

  function applyPreset(role: Role) {
    const preset = ROLE_PRESETS[role] ?? {};
    setPermissions(ALL_MODULES.map(m => ({module:m.key, actions: preset[m.key]??[]})));
  }

  async function handleSavePerms() {
    if (!editUser) return;
    setSaving(true);
    try {
      await api.updateUser(String(editUser.id), { role: editRole, permissions });
      toast.success('Permisos actualizados'); setShowPerms(false); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  async function handleToggleActive() {
    if (!toggleTarget) return;
    setSaving(true);
    try {
      await api.updateUser(String(toggleTarget.id), { active: !toggleTarget.active });
      toast.success(toggleTarget.active?'Usuario desactivado':'Usuario activado');
      setToggleTarget(null); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  async function handleInvite() {
    if (!inviteForm.email||!inviteForm.name||!inviteForm.password) return;
    setSaving(true);
    try {
      await api.createUser(inviteForm);
      toast.success('Usuario creado correctamente'); setShowInvite(false);
      setInviteForm({email:'',name:'',role:'seller',password:''}); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error al crear usuario'); } finally { setSaving(false); }
  }

  const roleColors: Record<string,string> = {
    owner:'badge-info', admin:'badge-success', seller:'badge-warning',
    warehouse:'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20',
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-base font-semibold text-[#e6edf3]">Gestión de usuarios</h2><p className="text-xs text-[#6e7681] mt-0.5">{users.length} usuario(s)</p></div>
        {me?.role==='owner'&&<button onClick={()=>setShowInvite(true)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4"/>Nuevo usuario</button>}
      </div>

      {users.length===0?<EmptyState icon={UserCog} title="Sin usuarios" description="No se encontraron usuarios"/>:(
        <div className="grid gap-3">
          {users.map(u=>(
            <div key={String(u.id)} className={cn('card p-4 flex items-center gap-4',!u.active&&'opacity-50')}>
              <div className="w-10 h-10 rounded-full bg-brand-600/30 flex items-center justify-center text-brand-400 font-bold text-sm shrink-0">
                {String(u.name??'?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-[#e6edf3]">{String(u.name)}</p>
                  <span className={roleColors[String(u.role)]??'badge-info'}>{classifyRole(String(u.role))}</span>
                  {!u.active&&<span className="badge-danger text-xs">Inactivo</span>}
                  {u.id===me?.id&&<span className="text-[10px] text-[#6e7681] bg-[#21262d] px-1.5 py-0.5 rounded">Tú</span>}
                </div>
                <p className="text-xs text-[#6e7681] mt-0.5 truncate">{String(u.email??'')}</p>
                {String(u.role)!=='owner'&&(
                  <p className="text-[11px] text-[#6e7681] mt-1 truncate">
                    Módulos: {((u.permissions as {module:string;actions:string[]}[]|undefined)??[]).filter(p=>p.actions.length>0).map(p=>p.module).join(', ')||'Sin módulos'}
                  </p>
                )}
              </div>
              {me?.role==='owner'&&String(u.id)!==me.id&&(
                <div className="flex items-center gap-2 shrink-0">
                  {String(u.role)!=='owner'&&<button onClick={()=>openPerms(u)} className="p-2 rounded-lg text-[#6e7681] hover:text-brand-400 hover:bg-brand-500/10 transition-colors" title="Editar permisos"><Shield className="w-4 h-4"/></button>}
                  <button onClick={()=>setToggleTarget(u)} className={cn('p-2 rounded-lg transition-colors',u.active?'text-[#6e7681] hover:text-red-400 hover:bg-red-500/10':'text-[#6e7681] hover:text-green-400 hover:bg-green-500/10')} title={u.active?'Desactivar':'Activar'}>
                    {u.active?<UserX className="w-4 h-4"/>:<UserCheck className="w-4 h-4"/>}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showInvite} onClose={()=>setShowInvite(false)} title="Crear usuario" size="md">
        <div className="space-y-4">
          <div><label className="label">Nombre completo</label><input className="input" placeholder="Juan Pérez" value={inviteForm.name} onChange={e=>setInviteForm(f=>({...f,name:e.target.value}))}/></div>
          <div><label className="label">Correo electrónico</label><input className="input" type="email" placeholder="correo@ejemplo.com" value={inviteForm.email} onChange={e=>setInviteForm(f=>({...f,email:e.target.value}))}/></div>
          <div><label className="label">Contraseña</label><input className="input" type="password" placeholder="Mínimo 6 caracteres" value={inviteForm.password} onChange={e=>setInviteForm(f=>({...f,password:e.target.value}))}/></div>
          <div><label className="label">Rol</label>
            <select className="input" value={inviteForm.role} onChange={e=>setInviteForm(f=>({...f,role:e.target.value as Role}))}>
              <option value="seller">Vendedor</option><option value="warehouse">Bodeguero</option><option value="admin">Administrador</option>
            </select>
          </div>
          <p className="text-xs text-[#6e7681] bg-[#0d1117] rounded-lg p-3 border border-[#21262d]">Los permisos específicos se configuran con el botón 🛡 después de crear el usuario.</p>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowInvite(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleInvite} disabled={saving||!inviteForm.email||!inviteForm.name||!inviteForm.password} className="btn-primary flex-1 disabled:opacity-50">{saving?'Creando...':'Crear usuario'}</button></div>
        </div>
      </Modal>

      <Modal open={showPerms} onClose={()=>setShowPerms(false)} title={`Permisos — ${String(editUser?.name??'')}`} size="lg">
        {editUser&&(
          <div className="space-y-5">
            <div>
              <label className="label">Rol</label>
              <div className="flex gap-2 flex-wrap">
                {(['admin','seller','warehouse'] as Role[]).map(r=>(
                  <button key={r} onClick={()=>{setEditRole(r);applyPreset(r);}} className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',editRole===r?'bg-brand-600 border-brand-600 text-white':'border-[#30363d] text-[#8b949e] hover:border-[#6e7681] hover:text-[#e6edf3]')}>{classifyRole(r)}</button>
                ))}
                <button onClick={()=>applyPreset(editRole)} className="btn-secondary text-xs">Aplicar preset</button>
              </div>
            </div>
            <div className="rounded-xl border border-[#21262d] overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-[#0d1117] border-b border-[#21262d]">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6e7681] uppercase tracking-wide">Módulo</th>
                  {ALL_ACTIONS.map(a=><th key={a} className="px-3 py-2.5 text-center text-xs font-medium text-[#6e7681] uppercase tracking-wide">{a==='read'?'Ver':a==='create'?'Crear':a==='update'?'Editar':'Borrar'}</th>)}
                </tr></thead>
                <tbody>{ALL_MODULES.map(m=>{
                  const perm = permissions.find(p=>p.module===m.key);
                  return(<tr key={m.key} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128]">
                    <td className="px-4 py-3 text-[#e6edf3] font-medium">{m.label}</td>
                    {ALL_ACTIONS.map(action=>(
                      <td key={action} className="px-3 py-3 text-center">
                        <input type="checkbox" checked={perm?.actions.includes(action)??false} onChange={()=>toggleAction(m.key,action)} className="w-4 h-4 rounded accent-brand-600 cursor-pointer"/>
                      </td>
                    ))}
                  </tr>);
                })}</tbody>
              </table>
            </div>
            <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowPerms(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSavePerms} disabled={saving} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':'Guardar permisos'}</button></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!toggleTarget} onClose={()=>setToggleTarget(null)} onConfirm={handleToggleActive}
        title={toggleTarget?.active?'Desactivar usuario':'Activar usuario'}
        message={toggleTarget?.active?`¿Desactivar a ${String(toggleTarget?.name)}?`:`¿Activar a ${String(toggleTarget?.name)}?`}
        confirmLabel={toggleTarget?.active?'Desactivar':'Activar'} loading={saving}/>
    </div>
  );
}
