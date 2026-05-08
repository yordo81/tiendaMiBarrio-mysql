/**
 * Export utilities — replaces deprecated xlsx (SheetJS community)
 * Uses ExcelJS for proper .xlsx generation and native API for CSV
 */

/** Export data to CSV and trigger download */
export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(r =>
    Object.values(r).map(v => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(',')
  );
  const csv = '\uFEFF' + [headers, ...rows].join('\n'); // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/** Export data to XLSX using ExcelJS */
export async function exportToXLSX(
  data: Record<string, unknown>[],
  filename: string,
  sheetName = 'Datos',
  headers?: Record<string, string> // { key: 'Label' }
): Promise<void> {
  if (!data.length) return;

  // Dynamic import — only loaded when needed
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TiendaMiBarrio';
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName);

  const keys = Object.keys(data[0]);
  const cols = keys.map(k => ({
    header: headers?.[k] ?? k,
    key: k,
    width: Math.min(Math.max(15, String(headers?.[k] ?? k).length + 4), 40),
  }));
  ws.columns = cols;

  // Header style
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1264F5' } };
    cell.alignment = { vertical: 'middle' };
  });
  ws.getRow(1).height = 22;

  // Data rows
  data.forEach((row, i) => {
    const wsRow = ws.addRow(keys.map(k => row[k] ?? ''));
    if (i % 2 === 1) {
      wsRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } };
      });
    }
  });

  // Auto-filter
  ws.autoFilter = { from: 'A1', to: { row: 1, column: keys.length } };

  // Download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}
