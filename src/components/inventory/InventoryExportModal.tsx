'use client';
import { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatCurrency, formatNumber, formatDate, cn } from '@/lib/utils';
import { exportToXLSX } from '@/lib/export';
import { toast } from '@/components/ui/toaster';
import { Printer, FileDown, FileSpreadsheet, RefreshCw, PackageSearch } from 'lucide-react';

type R = Record<string, unknown>;

interface Props {
  open: boolean;
  onClose: () => void;
  products: R[]; // productos cargados (según el almacén filtrado)
}

// PRNG determinista (mulberry32) para regenerar la muestra aleatoria
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function InventoryExportModal({ open, onClose, products }: Props) {
  const [scope, setScope] = useState<'100' | 'percent'>('100');
  const [percent, setPercent] = useState(20);
  const [blind, setBlind] = useState(false);
  const [sampleSeed, setSampleSeed] = useState(1);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  // Orden estable por categoría y luego por nombre
  const sorted = useMemo(() => {
    return [...products].sort((a, b) => {
      const ca = String(a.category_name ?? '—').toLowerCase();
      const cb = String(b.category_name ?? '—').toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es');
    });
  }, [products]);

  // Muestra según el alcance elegido: 100% o % aleatorio de la cantidad de productos
  const sample = useMemo(() => {
    if (scope === '100') return sorted;
    const pct = Math.min(100, Math.max(1, Number(percent) || 0));
    const count = Math.max(1, Math.round((sorted.length * pct) / 100));
    if (count >= sorted.length) return sorted;
    const arr = [...sorted];
    const rnd = mulberry32(sampleSeed);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, count);
  }, [sorted, scope, percent, sampleSeed]);

  const fileName = `inventario-${scope === '100' ? 'total' : `muestra-${percent}pct`}-${formatDate(new Date(), 'yyyyMMdd-HHmm')}`;

  function regenerate() {
    setSampleSeed(s => s + 1);
    toast.success('Nueva muestra aleatoria generada');
  }

  // ── PDF ───────────────────────────────────────────────────────────
  async function exportPDF() {
    if (sample.length === 0) return;
    setExporting('pdf');
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF();

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Inventario de productos', 14, 16);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80);
      doc.text(`Fecha: ${formatDate(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 23);
      doc.text(
        `${sample.length} de ${products.length} productos · ${scope === '100' ? '100% del inventario' : `Muestra aleatoria del ${Math.min(100, Math.max(1, Number(percent) || 0))}%`} · ${blind ? 'Conteo ciego (sin existencias)' : 'Con existencias'}`,
        14, 28
      );

      const heads = blind
        ? [['Código', 'Producto', 'Categoría', 'Precio', 'Conteo', 'Observaciones']]
        : [['Código', 'Producto', 'Categoría', 'Stock', 'P. Venta', 'Costo']];

      type Cell = string | { content: string; colSpan: number; styles: Record<string, unknown> };
      const body: Cell[][] = [];
      let lastCat = '';
      sample.forEach(p => {
        const cat = String(p.category_name ?? '—');
        if (cat !== lastCat) {
          lastCat = cat;
          body.push([{
            content: cat,
            colSpan: heads[0].length,
            styles: { fillColor: [240, 243, 247], textColor: [30, 41, 59], fontStyle: 'bold', fontSize: 8 },
          }]);
        }
        if (blind) {
          body.push([String(p.barcode ?? '—'), String(p.name ?? ''), cat, formatCurrency(Number(p.sale_price ?? 0)), '', '']);
        } else {
          body.push([
            String(p.barcode ?? '—'),
            String(p.name ?? ''),
            cat,
            `${formatNumber(Number(p.stock ?? 0), 1)} ${String(p.unit ?? '')}`,
            formatCurrency(Number(p.sale_price ?? 0)),
            formatCurrency(Number(p.cost ?? 0)),
          ]);
        }
      });

      autoTable(doc, {
        startY: 34,
        head: heads,
        body,
        theme: 'grid',
        headStyles: { fillColor: [38, 101, 245], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });
      doc.save(`${fileName}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al generar el PDF');
    } finally {
      setExporting(null);
    }
  }

  // ── Excel ─────────────────────────────────────────────────────────
  async function exportExcel() {
    if (sample.length === 0) return;
    setExporting('xlsx');
    try {
      const headers: Record<string, string> = blind
        ? { barcode: 'Código', name: 'Producto', category_name: 'Categoría', sale_price: 'Precio', conteo: 'Conteo', observaciones: 'Observaciones' }
        : { barcode: 'Código', name: 'Producto', category_name: 'Categoría', stock: 'Stock', unit: 'Unidad', sale_price: 'P. Venta', cost: 'Costo' };
      const data = sample.map(p =>
        blind
          ? {
              barcode: String(p.barcode ?? ''),
              name: String(p.name ?? ''),
              category_name: String(p.category_name ?? '—'),
              sale_price: Number(p.sale_price ?? 0),
              conteo: '',
              observaciones: '',
            }
          : {
              barcode: String(p.barcode ?? ''),
              name: String(p.name ?? ''),
              category_name: String(p.category_name ?? '—'),
              stock: Number(p.stock ?? 0),
              unit: String(p.unit ?? ''),
              sale_price: Number(p.sale_price ?? 0),
              cost: Number(p.cost ?? 0),
            }
      );
      await exportToXLSX(data, fileName, 'Inventario', headers);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al generar el Excel');
    } finally {
      setExporting(null);
    }
  }

  // ── Imprimir ──────────────────────────────────────────────────────
  function printReport() {
    if (sample.length === 0) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) {
      toast.error('Permite las ventanas emergentes para imprimir');
      return;
    }
    const heads = blind
      ? ['Código', 'Producto', 'Categoría', 'Precio', 'Conteo', 'Observaciones']
      : ['Código', 'Producto', 'Categoría', 'Stock', 'P. Venta', 'Costo'];

    const rowsHtml: string[] = [];
    let lastCat = '';
    sample.forEach(p => {
      const cat = String(p.category_name ?? '—');
      if (cat !== lastCat) {
        lastCat = cat;
        rowsHtml.push(`<tr class="cat"><td colspan="${heads.length}">${escapeHtml(cat)}</td></tr>`);
      }
      const dataCells = blind
        ? [String(p.barcode ?? '—'), String(p.name ?? ''), cat, formatCurrency(Number(p.sale_price ?? 0))]
        : [
            String(p.barcode ?? '—'),
            String(p.name ?? ''),
            cat,
            `${formatNumber(Number(p.stock ?? 0), 1)} ${String(p.unit ?? '')}`,
            formatCurrency(Number(p.sale_price ?? 0)),
            formatCurrency(Number(p.cost ?? 0)),
          ];
      const blankCells = blind ? '<td><div class="blank"></div></td><td><div class="blank"></div></td>' : '';
      rowsHtml.push(`<tr>${dataCells.map(c => `<td>${escapeHtml(c)}</td>`).join('')}${blankCells}</tr>`);
    });

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Inventario</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2328; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 11px; color: #57606a; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #0969da; color: #fff; text-align: left; padding: 6px 8px; }
  td { border: 1px solid #d0d7de; padding: 6px 8px; }
  tr.cat td { background: #f0f3f7; font-weight: bold; color: #1f2328; border: 1px solid #d0d7de; }
  .blank { height: 22px; }
  @media print {
    body { margin: 10mm; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <h1>Inventario de productos</h1>
  <div class="meta">
    Fecha: ${formatDate(new Date(), 'dd/MM/yyyy HH:mm')} &nbsp;·&nbsp;
    ${sample.length} de ${products.length} productos · ${scope === '100' ? '100% del inventario' : `Muestra aleatoria del ${Math.min(100, Math.max(1, Number(percent) || 0))}%`} · ${blind ? 'Conteo ciego (sin existencias)' : 'Con existencias'}
    <br/><span class="no-print" style="color:#57606a">— Presiona Ctrl+P o Cmd+P para imprimir esta página —</span>
  </div>
  <table>
    <thead><tr>${heads.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml.join('')}</tbody>
  </table>
</body>
</html>`;

    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  }

  return (
    <Modal open={open} onClose={onClose} title="Imprimir / exportar inventario" size="md">
      <div className="space-y-4">
        <p className="text-xs text-[var(--text-tertiary)]">
          Se exportan los <span className="font-medium text-[var(--text-primary)]">{products.length}</span> productos cargados
          (según el almacén filtrado), <span className="font-medium text-[var(--text-primary)]">siempre ordenados por categoría</span>.
        </p>

        {/* Alcance */}
        <div>
          <label className="label">Alcance</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setScope('100')}
              className={cn('flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-colors', scope === '100' ? 'bg-brand-600/15 border-brand-500/50' : 'border-[var(--border-primary)] hover:border-[#6e7681]')}
            >
              <span className={cn('text-sm font-medium', scope === '100' ? 'text-brand-400' : 'text-[var(--text-primary)]')}>100% del inventario</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">{products.length} productos</span>
            </button>
            <button
              onClick={() => setScope('percent')}
              className={cn('flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-colors', scope === 'percent' ? 'bg-brand-600/15 border-brand-500/50' : 'border-[var(--border-primary)] hover:border-[#6e7681]')}
            >
              <span className={cn('text-sm font-medium', scope === 'percent' ? 'text-brand-400' : 'text-[var(--text-primary)]')}>Porcentaje del inventario</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">Muestra aleatoria para conteo físico</span>
            </button>
          </div>
        </div>

        {scope === 'percent' && (
          <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-3 space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="label">Porcentaje de productos (%)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input"
                  value={percent || ''}
                  onChange={e => setPercent(parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <button onClick={regenerate} className="btn-secondary flex items-center gap-1.5 text-xs shrink-0">
                <RefreshCw className="w-3.5 h-3.5" /> Regenerar muestra
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Se seleccionan <span className="font-medium text-[var(--text-secondary)]">{sample.length}</span> de {products.length} productos al azar.
              Usa "Regenerar muestra" para cambiar cuáles entran al conteo.
            </p>
          </div>
        )}

        {/* Inventario ciego */}
        <div>
          <label className="label">Formato</label>
          <button
            onClick={() => setBlind(v => !v)}
            className={cn('w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors', blind ? 'bg-brand-600/15 border-brand-500/50' : 'border-[var(--border-primary)] hover:border-[#6e7681]')}
          >
            <div className={cn('w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0', blind ? 'bg-brand-500 border-brand-500 text-white' : 'border-[var(--border-secondary)]')}>
              {blind && '✓'}
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Inventario ciego (conteo físico)</p>
              <p className="text-[10px] text-[var(--text-tertiary)]">No muestra las existencias; incluye columnas en blanco de "Conteo" y "Observaciones" para anotar a mano.</p>
            </div>
          </button>
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap gap-2">
          <button onClick={printReport} disabled={sample.length === 0} className="btn-primary flex items-center gap-1.5 text-sm flex-1 disabled:opacity-50">
            <Printer className="w-4 h-4" /> Imprimir
          </button>
          <button onClick={exportPDF} disabled={sample.length === 0 || exporting !== null} className="btn-secondary flex items-center gap-1.5 text-sm flex-1 disabled:opacity-50">
            {exporting === 'pdf' ? <span className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /> : <FileDown className="w-4 h-4" />}
            PDF
          </button>
          <button onClick={exportExcel} disabled={sample.length === 0 || exporting !== null} className="btn-secondary flex items-center gap-1.5 text-sm flex-1 disabled:opacity-50">
            {exporting === 'xlsx' ? <span className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Excel
          </button>
        </div>

        {sample.length === 0 && (
          <p className="text-xs text-yellow-400 flex items-center gap-1.5">
            <PackageSearch className="w-3.5 h-3.5" /> No hay productos para exportar en el almacén seleccionado.
          </p>
        )}
      </div>
    </Modal>
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
