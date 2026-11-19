export function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Sem validade';
  const clean = isoDate.slice(0, 10);
  const [y, m, d] = clean.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return '-';
  const parsed = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface ExpiryClassification {
  level: 'valid' | 'warning' | 'expired' | 'none';
  label: string;
  daysRemaining: number | null;
  colorClass: string;
}

export function classifyExpiry(expiryDate: string | null | undefined, alertDays: number[] = [180, 90, 60, 30]): ExpiryClassification {
  if (!expiryDate) {
    return {
      level: 'none',
      label: 'Sem validade',
      daysRemaining: null,
      colorClass: 'text-slate-600',
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${expiryDate.slice(0, 10)}T00:00:00`);
  const diffDays = Math.ceil((exp.getTime() - today.getTime()) / 86400000);
  const maxThreshold = alertDays.length ? Math.max(...alertDays) : 90;

  if (diffDays < 0) {
    return {
      level: 'expired',
      label: `Vencido (${Math.abs(diffDays)}d)`,
      daysRemaining: diffDays,
      colorClass: 'text-red-700 font-semibold',
    };
  }
  if (diffDays <= maxThreshold) {
    return {
      level: 'warning',
      label: `Vence em ${diffDays}d`,
      daysRemaining: diffDays,
      colorClass: 'text-amber-700 font-semibold',
    };
  }
  return {
    level: 'valid',
    label: `Válido (${diffDays}d)`,
    daysRemaining: diffDays,
    colorClass: 'text-emerald-700 font-medium',
  };
}

export function generateSampleNfeXml(): string {
  const futureA = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const futureB = new Date(Date.now() + 210 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe22261112345678000190550010000051901849201129" versao="4.00">
      <ide>
        <nNF>005190</nNF>
        <dhEmi>${today}T09:30:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>12345678000190</CNPJ>
        <xNome>Distribuidora Farma Piauí Ltda</xNome>
        <enderEmit>
          <xLgr>Av. Frei Serafim</xLgr>
          <nro>1420</nro>
          <xMun>Teresina</xMun>
          <UF>PI</UF>
          <fone>8632214400</fone>
        </enderEmit>
      </emit>
      <det nItem="1">
        <prod>
          <cProd>MED-DIP500</cProd>
          <cEAN>7896422501019</cEAN>
          <xProd>Dipirona Sódica 500mg Comprimido</xProd>
          <uCom>UN</uCom>
          <qCom>1000.00</qCom>
          <vUnCom>0.28</vUnCom>
          <vProd>280.00</vProd>
          <rastro>
            <nLote>L26-XML01</nLote>
            <dFab>${today}</dFab>
            <dVal>${futureA}</dVal>
          </rastro>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cProd>MED-PAR750</cProd>
          <cEAN>7896523209911</cEAN>
          <xProd>Paracetamol 750mg Comprimido (Novo Item XML)</xProd>
          <uCom>UN</uCom>
          <qCom>600.00</qCom>
          <vUnCom>0.35</vUnCom>
          <vProd>210.00</vProd>
          <rastro>
            <nLote>L26-PAR99</nLote>
            <dFab>${today}</dFab>
            <dVal>${futureB}</dVal>
          </rastro>
        </prod>
      </det>
      <total>
        <ICMSTot>
          <vNF>490.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>`;
}
