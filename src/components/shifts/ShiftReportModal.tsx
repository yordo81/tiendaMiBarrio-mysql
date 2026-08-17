'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatCurrency, formatDateTime, formatDate } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { toast } from '@/components/ui/toaster';
import {
  FileDown, Loader2, User, Wallet, TrendingUp, TrendingDown,
  PackageSearch, ShoppingCart, History, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

type R = Record<string, unknown>;

interface ShiftReportModalProps {
  open: boolean;
  shiftId: string | null;
  onClose: () => void;
}

// Tipos de movimiento de caja legibles
const REGISTER_TYPE_LABELS: Record<string, string> = {
  initial: 'Saldo inicial',
  adjustment: 'Ajuste de caja',
  capital: 'Aporte de capital',
};

// Etiquetas de método de pago (ventas del turno)
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  mixed: 'Mixto',
  credit: 'Crédito',
};

export default function ShiftReportModal({ open, shiftId, onClose }: ShiftReportModalProps) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<R | null>(null);

  useEffect(() => {
    if (open && shiftId) {
      setLoading(true);
      setReport(null);
      api.getShiftReport(shiftId)
        .then(r => setReport(r))
        .catch(e => toast.error(e instanceof Error ? e.message : 'Error al cargar el reporte'))
        .finally(() => setLoading(false));
    }
  }, [open, shiftId]);

  // ── Exportar a PDF ────────────────────────────────────────────────
  async function exportPDF() {
    if (!report) return;
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF();

    const shift = report.shift as R;
    const totals = report.totals as R;

    // Encabezado
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Reporte de Turno de Caja', 14, 16);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text(`Apertura: ${formatDateTime(String(shift.opened_at ?? ''))}`, 14, 23);
    doc.text(
      shift.closed_at ? `Cierre: ${formatDateTime(String(shift.closed_at))}` : 'Cierre: (turno abierto)',
      14, 28
    );
    doc.text(`Vendedor: ${String(shift.user_name ?? '—')}`, 14, 33);
    if (shift.closed_by_name) doc.text(`Cerrado por: ${String(shift.closed_by_name)}`, 14, 38);
    doc.text(`Estado: ${shift.status === 'open' ? 'Abierto' : 'Cerrado'}`, 14, shift.closed_by_name ? 43 : 38);

    let y = shift.closed_by_name ? 48 : 43;

    // Resumen de arqueo
    autoTable(doc, {
      startY: y,
      head: [['Concepto', 'Monto']],
      body: [
        ['Fondo inicial', formatCurrency(Number(shift.opening_cash ?? 0))],
        ['Efectivo contado', shift.closing_cash != null ? formatCurrency(Number(shift.closing_cash)) : '—'],
        ['Efectivo esperado', shift.expected_cash != null ? formatCurrency(Number(shift.expected_cash)) : '—'],
        ['Diferencia', shift.difference != null ? formatCurrency(Number(shift.difference)) : '—'],
        ['Total ingresos del turno', formatCurrency(Number(totals.total_income ?? 0))],
        ['Total egresos del turno', formatCurrency(Number(totals.total_outcome ?? 0))],
        ['Neto del turno', formatCurrency(Number(totals.net ?? 0))],
        ['Costo de lo vendido', formatCurrency(Number(totals.total_cogs ?? 0))],
        ['Ganancia del turno', formatCurrency(Number(totals.total_profit ?? 0))],
      ],
      theme: 'grid',
      headStyles: { fillColor: [38, 101, 245], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    // Desglose de ventas por método de pago
    const payBreakdown = (report.payment_breakdown ?? {}) as R;
    const payEntries = payBreakdown && typeof payBreakdown === 'object' ? Object.entries(payBreakdown) : [];
    if (payEntries.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Ventas por método de pago', 14, y);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: y + 2,
        head: [['Método', 'Tickets', 'Total', 'Efectivo', 'Transferencia']],
        body: payEntries.map(([m, v]) => {
          const val = v as R;
          return [
            PAYMENT_METHOD_LABELS[m] ?? m,
            String(Number(val.count ?? 0)),
            formatCurrency(Number(val.total ?? 0)),
            formatCurrency(Number(val.cash ?? 0)),
            formatCurrency(Number(val.transfer ?? 0)),
          ];
        }),
        theme: 'grid',
        headStyles: { fillColor: [38, 101, 245], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }

    // Ventas
    const sales = (report.sales ?? []) as R[];
    if (sales.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`Ventas del turno (${sales.length})`, 14, y);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: y + 2,
        head: [['Fecha', 'Cliente', 'Método', 'Total']],
        body: sales.map(s => [
          formatDateTime(String(s.date ?? '')),
          String(s.customer_name ?? '—'),
          String(s.method ?? '—'),
          formatCurrency(Number(s.total ?? 0)),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [38, 101, 245], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }

    // Abonos de clientes
    const custPay = (report.customer_payments ?? []) as R[];
    if (custPay.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`Abonos de clientes (${custPay.length})`, 14, y);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: y + 2,
        head: [['Fecha', 'Cliente', 'Método', 'Monto']],
        body: custPay.map(cp => [
          formatDateTime(String(cp.date ?? '')),
          String(cp.customer_name ?? '—'),
          String(cp.method ?? '—'),
          formatCurrency(Number(cp.amount ?? 0)),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [38, 101, 245], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }

    // Egresos (gastos)
    const expenses = (report.expenses ?? []) as R[];
    if (expenses.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`Egresos — gastos (${expenses.length})`, 14, y);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: y + 2,
        head: [['Fecha', 'Descripción', 'Categoría', 'Método', 'Monto']],
        body: expenses.map(e => [
          formatDateTime(String(e.date ?? '')),
          String(e.description ?? '—'),
          String(e.category_name ?? '—'),
          String(e.payment_method ?? '—'),
          formatCurrency(Number(e.amount ?? 0)),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [220, 38, 38], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }

    // Compras de inventario
    const purchases = (report.purchases ?? []) as R[];
    if (purchases.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`Egresos — compras de inventario (${purchases.length})`, 14, y);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: y + 2,
        head: [['Fecha', 'Nota', 'Monto']],
        body: purchases.map(p => [
          formatDateTime(String(p.date ?? '')),
          String(p.notes ?? '—'),
          formatCurrency(Math.abs(Number(p.cash_amount ?? 0) + Number(p.transfer_amount ?? 0))),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [220, 38, 38], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }

    // Ajustes de inventario
    const adjustments = (report.stock_adjustments ?? []) as R[];
    if (adjustments.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`Ajustes de inventario (${adjustments.length})`, 14, y);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: y + 2,
        head: [['Fecha', 'Producto', 'Cantidad', 'Motivo', 'Usuario']],
        body: adjustments.map(a => [
          formatDateTime(String(a.date ?? '')),
          String(a.product_name ?? '—'),
          String(a.quantity ?? '—'),
          String(a.reason ?? '—'),
          String(a.user_name ?? '—'),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [234, 88, 12], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }

    // Productos vendidos
    const products = (report.sold_products ?? []) as R[];
    if (products.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`Productos vendidos (${products.length})`, 14, y);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: y + 2,
        head: [['Producto', 'Cantidad', 'Total vendido', 'Ganancia']],
        body: products.map(p => [
          String(p.product_name ?? '—'),
          `${Number(p.quantity ?? 0)} ${String(p.unit ?? '')}`,
          formatCurrency(Number(p.total_sold ?? 0)),
          formatCurrency(Number(p.total_sold ?? 0) - Number(p.total_cost ?? 0)),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });
    }

    // La API devuelve opened_at como ISO UTC; parsear de forma segura
    const openedIso = String(shift.opened_at ?? '');
    const openedLocal = openedIso
      ? new Date(openedIso.includes('T') ? openedIso : openedIso.replace(' ', 'T') + 'Z')
      : new Date();
    doc.save(`reporte-turno-${formatDate(openedLocal, 'yyyy-MM-dd')}.pdf`);
  }

  const shift = report?.shift as R | undefined;
  const totals = report?.totals as R | undefined;

  return (
    <Modal open={open} onClose={onClose} title="Reporte del turno" size="xl">
      <div className="space-y-4">
        {/* Barra de acciones */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--text-tertiary)]">
            Detalle completo de ingresos, egresos, ajustes de inventario y productos vendidos durante el turno.
          </p>
          <button onClick={exportPDF} disabled={!report} className="btn-primary flex items-center gap-1.5 text-xs shrink-0">
            <FileDown className="w-3.5 h-3.5" /> Exportar PDF
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          </div>
        )}

        {!loading && !report && (
          <p className="text-sm text-[var(--text-tertiary)] text-center py-16">No se pudo cargar el reporte.</p>
        )}

        {!loading && report && shift && (
          <>
            {/* Datos del turno */}
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-500/15 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-brand-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Vendedor</p>
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{String(shift.user_name ?? '—')}</p>
                  {!!shift.closed_by_name && (
                    <p className="text-[10px] text-[var(--text-tertiary)]">Cerrado por {String(shift.closed_by_name)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Fondo inicial</p>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{formatCurrency(Number(shift.opening_cash ?? 0))}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
                  <History className="w-4 h-4 text-purple-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Ventana del turno</p>
                  <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {formatDateTime(String(shift.opened_at ?? ''))}
                  </p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    {shift.closed_at ? `→ ${formatDateTime(String(shift.closed_at))}` : '→ (abierto)'}
                  </p>
                </div>
              </div>
            </div>

            {/* Resumen del arqueo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-green-500/5 border border-green-500/10 rounded-xl p-3">
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide flex items-center gap-1">
                  <ArrowUpRight className="w-3 h-3 text-green-400" /> Ingresos
                </p>
                <p className="text-base font-semibold text-green-400 mt-1">{formatCurrency(Number(totals?.total_income ?? 0))}</p>
              </div>
              <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3">
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide flex items-center gap-1">
                  <ArrowDownRight className="w-3 h-3 text-red-400" /> Egresos
                </p>
                <p className="text-base font-semibold text-red-400 mt-1">{formatCurrency(Number(totals?.total_outcome ?? 0))}</p>
              </div>
              <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-3">
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Esperado</p>
                <p className="text-base font-semibold text-[var(--text-primary)] mt-1">
                  {shift.expected_cash != null ? formatCurrency(Number(shift.expected_cash)) : '—'}
                </p>
              </div>
              <div className="bg-yellow-500/5 border border-yellow-500/10 rounded-xl p-3">
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Diferencia</p>
                <p className={`text-base font-semibold mt-1 ${Number(shift.difference ?? 0) < 0 ? 'text-red-400' : Number(shift.difference ?? 0) > 0 ? 'text-green-400' : 'text-[var(--text-primary)]'}`}>
                  {shift.difference != null ? formatCurrency(Number(shift.difference)) : '—'}
                </p>
              </div>
            </div>

            {/* Ventas por método de pago */}
            {(() => {
              const pb = report.payment_breakdown as R | undefined;
              const entries = pb && typeof pb === 'object' ? Object.entries(pb) : [];
              if (entries.length === 0) return null;
              return (
                <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide flex items-center gap-1.5 mb-3">
                    <ShoppingCart className="w-4 h-4 text-brand-400" /> Ventas por método de pago
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {entries.map(([m, v]) => {
                      const val = v as R;
                      const isCash = m === 'cash' || m === 'mixed';
                      return (
                        <div key={m} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-muted)] p-3">
                          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">{PAYMENT_METHOD_LABELS[m] ?? m}</p>
                          <p className="text-base font-semibold text-[var(--text-primary)] mt-1">{formatCurrency(Number(val.total ?? 0))}</p>
                          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                            {Number(val.count ?? 0)} ticket(s)
                            {isCash && (
                              <span className="block">Efectivo: {formatCurrency(Number(val.cash ?? 0))}</span>
                            )}
                            {m === 'transfer' && (
                              <span className="block">Transferencia: {formatCurrency(Number(val.transfer ?? 0))}</span>
                            )}
                            {m === 'mixed' && (
                              <span className="block">Transf: {formatCurrency(Number(val.transfer ?? 0))}</span>
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Ganancia del turno */}
            <div className="bg-gradient-to-br from-emerald-500/15 to-transparent border border-emerald-500/25 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Ganancia del turno</p>
                  <p className="text-xs text-[var(--text-tertiary)]">Ingresos por ventas − costo de lo vendido</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-emerald-400">{formatCurrency(Number(totals?.total_profit ?? 0))}</p>
                <p className="text-[10px] text-[var(--text-tertiary)]">Costo: {formatCurrency(Number(totals?.total_cogs ?? 0))}</p>
              </div>
            </div>

            {/* Ingresos */}
            <Section
              icon={<TrendingUp className="w-4 h-4 text-green-400" />}
              title={`Ingresos — ventas (${((report.sales ?? []) as R[]).length})`}
              right={`Total: ${formatCurrency(Number(totals?.total_sales ?? 0))}`}
            >
              {((report.sales ?? []) as R[]).length === 0 ? (
                <EmptyRow text="No hubo ventas en este turno" />
              ) : (
                <div className="divide-y divide-[var(--border-primary)]">
                  {((report.sales ?? []) as R[]).map(s => (
                    <Row key={String(s.id)} title={`${String(s.customer_name ?? 'Cliente mostrador')} · ${String(s.method ?? '—')}`} sub={formatDateTime(String(s.date ?? ''))} amount={Number(s.total ?? 0)} positive />
                  ))}
                </div>
              )}
            </Section>

            {/* Abonos */}
            {((report.customer_payments ?? []) as R[]).length > 0 && (
              <Section
                icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
                title={`Abonos de clientes (${((report.customer_payments ?? []) as R[]).length})`}
                right={`Total: ${formatCurrency(Number(totals?.total_customer_payments ?? 0))}`}
              >
                <div className="divide-y divide-[var(--border-primary)]">
                  {((report.customer_payments ?? []) as R[]).map(cp => (
                    <Row key={String(cp.id)} title={`${String(cp.customer_name ?? '—')} · ${String(cp.method ?? '—')}`} sub={formatDateTime(String(cp.date ?? ''))} amount={Number(cp.amount ?? 0)} positive />
                  ))}
                </div>
              </Section>
            )}

            {/* Movimientos de caja (no compras) */}
            {((report.register_movements ?? []) as R[]).length > 0 && (
              <Section
                icon={<Wallet className="w-4 h-4 text-brand-400" />}
                title={`Movimientos de caja (${((report.register_movements ?? []) as R[]).length})`}
                right={`Neto: ${formatCurrency(Number(totals?.register_net ?? 0))}`}
              >
                <div className="divide-y divide-[var(--border-primary)]">
                  {((report.register_movements ?? []) as R[]).map(m => {
                    const amount = Number(m.cash_amount ?? 0) + Number(m.transfer_amount ?? 0);
                    return (
                      <Row
                        key={String(m.id)}
                        title={REGISTER_TYPE_LABELS[String(m.type)] ?? String(m.type)}
                        sub={m.notes ? `${String(m.notes)} · ${formatDateTime(String(m.date ?? ''))}` : formatDateTime(String(m.date ?? ''))}
                        amount={amount}
                        positive={amount >= 0}
                      />
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Egresos */}
            <Section
              icon={<TrendingDown className="w-4 h-4 text-red-400" />}
              title={`Egresos — gastos (${((report.expenses ?? []) as R[]).length})`}
              right={`Total: ${formatCurrency(Number(totals?.total_expenses ?? 0))}`}
            >
              {((report.expenses ?? []) as R[]).length === 0 ? (
                <EmptyRow text="No hubo gastos en este turno" />
              ) : (
                <div className="divide-y divide-[var(--border-primary)]">
                  {((report.expenses ?? []) as R[]).map(e => (
                    <Row
                      key={String(e.id)}
                      title={String(e.description ?? '—')}
                      sub={`${String(e.category_name ?? '—')} · ${String(e.payment_method ?? '—')} · ${formatDateTime(String(e.date ?? ''))}`}
                      amount={Number(e.amount ?? 0)}
                      positive={false}
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* Compras de inventario */}
            {((report.purchases ?? []) as R[]).length > 0 && (
              <Section
                icon={<TrendingDown className="w-4 h-4 text-orange-400" />}
                title={`Compras de inventario (${((report.purchases ?? []) as R[]).length})`}
                right={`Total: ${formatCurrency(Number(totals?.total_purchases ?? 0))}`}
              >
                <div className="divide-y divide-[var(--border-primary)]">
                  {((report.purchases ?? []) as R[]).map(p => (
                    <Row
                      key={String(p.id)}
                      title={String(p.notes ?? 'Compra de inventario')}
                      sub={formatDateTime(String(p.date ?? ''))}
                      amount={Number(p.cash_amount ?? 0) + Number(p.transfer_amount ?? 0)}
                      positive={false}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* Ajustes de inventario */}
            <Section
              icon={<PackageSearch className="w-4 h-4 text-orange-400" />}
              title={`Ajustes de inventario (${((report.stock_adjustments ?? []) as R[]).length})`}
            >
              {((report.stock_adjustments ?? []) as R[]).length === 0 ? (
                <EmptyRow text="No hubo ajustes de inventario en este turno" />
              ) : (
                <div className="divide-y divide-[var(--border-primary)]">
                  {((report.stock_adjustments ?? []) as R[]).map(a => (
                    <div key={String(a.id)} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--text-primary)] font-medium truncate">{String(a.product_name ?? '—')}</p>
                        <p className="text-xs text-[var(--text-tertiary)] truncate">
                          {String(a.reason ?? '—')} · {formatDateTime(String(a.date ?? ''))} · {String(a.user_name ?? '—')}
                        </p>
                      </div>
                      <span className={`text-sm font-semibold shrink-0 ${Number(a.quantity ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {Number(a.quantity ?? 0) >= 0 ? '+' : ''}{Number(a.quantity ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Productos vendidos */}
            <Section
              icon={<ShoppingCart className="w-4 h-4 text-emerald-400" />}
              title={`Productos vendidos (${((report.sold_products ?? []) as R[]).length})`}
              right={`Ganancia: ${formatCurrency(Number(totals?.total_profit ?? 0))}`}
            >
              {((report.sold_products ?? []) as R[]).length === 0 ? (
                <EmptyRow text="No se vendieron productos en este turno" />
              ) : (
                <div className="divide-y divide-[var(--border-primary)]">
                  {((report.sold_products ?? []) as R[]).map(p => {
                    const sold = Number(p.total_sold ?? 0);
                    const cost = Number(p.total_cost ?? 0);
                    const profit = sold - cost;
                    return (
                      <div key={String(p.id)} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm text-[var(--text-primary)] font-medium truncate">{String(p.product_name ?? '—')}</p>
                          <p className="text-xs text-[var(--text-tertiary)]">
                            {Number(p.quantity ?? 0)} {String(p.unit ?? '')} · Costo: {formatCurrency(cost)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)]">{formatCurrency(sold)}</p>
                          <p className={`text-[10px] font-medium ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            Ganancia: {formatCurrency(profit)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Sub-componentes ─────────────────────────────────────────────────

function Section({ icon, title, right, children }: { icon: React.ReactNode; title: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide flex items-center gap-1.5">
          {icon} {title}
        </h4>
        {right && <span className="text-xs font-semibold text-[var(--text-primary)] shrink-0">{right}</span>}
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}

function Row({ title, sub, amount, positive }: { title: string; sub: string; amount: number; positive: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-[var(--text-primary)] font-medium truncate">{title}</p>
        <p className="text-xs text-[var(--text-tertiary)] truncate">{sub}</p>
      </div>
      <span className={`text-sm font-semibold shrink-0 ${positive ? 'text-green-400' : 'text-red-400'}`}>
        {positive ? '+' : '-'}{formatCurrency(Math.abs(amount))}
      </span>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-xs text-[var(--text-tertiary)] text-center py-4">{text}</p>;
}
