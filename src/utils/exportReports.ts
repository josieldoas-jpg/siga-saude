import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ReportExportMeta {
  title: string;
  institution: string;
  sectorLabel: string;
  periodLabel: string;
  generatedBy: string;
  generatedAt: string;
}

export function exportToExcel(rows: Record<string, unknown>[], meta: ReportExportMeta, fileName: string) {
  const headerRows = [
    [meta.institution],
    [`SIGA Saúde — ${meta.title}`],
    [`Setor: ${meta.sectorLabel} | Período: ${meta.periodLabel}`],
    [`Emitido em: ${new Date(meta.generatedAt).toLocaleString('pt-BR')} | Responsável: ${meta.generatedBy}`],
    [],
  ];

  const ws = XLSX.utils.aoa_to_sheet(headerRows);
  XLSX.utils.sheet_add_json(ws, rows, { origin: 'A6' });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export function exportToPdf(rows: Record<string, unknown>[], meta: ReportExportMeta, fileName: string) {
  const doc = new jsPDF({ orientation: rows.length > 0 && Object.keys(rows[0]).length > 6 ? 'landscape' : 'portrait' });

  // Institutional navy header bar
  doc.setFillColor(11, 37, 69);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('SIGA Saúde — Sistema Integrado de Gestão de Almoxarifado', 14, 10);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(meta.institution, 14, 17);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(meta.title, 14, 36);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`Setor: ${meta.sectorLabel}   |   Período: ${meta.periodLabel}`, 14, 42);
  doc.text(`Emissão: ${new Date(meta.generatedAt).toLocaleString('pt-BR')}   |   Usuário responsável: ${meta.generatedBy}`, 14, 47);

  if (rows.length === 0) {
    doc.setFontSize(10);
    doc.text('Nenhum registro encontrado para os filtros selecionados.', 14, 60);
  } else {
    const columns = Object.keys(rows[0]);
    const body = rows.map((row) => columns.map((col) => String(row[col] ?? '')));

    autoTable(doc, {
      startY: 53,
      head: [columns],
      body,
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [11, 37, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    });
  }

  doc.save(`${fileName}.pdf`);
}
