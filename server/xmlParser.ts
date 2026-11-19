import type { ParsedNfeXml, ParsedXmlItem } from '../src/types/siga.ts';

function extractTag(block: string, tag: string): string {
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : '';
}

function extractAllTags(block: string, tag: string): string[] {
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>[\\s\\S]*?<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'gi');
  return block.match(regex) || [];
}

function cleanCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return raw;
}

export function parseNfeXml(xmlText: string): ParsedNfeXml {
  if (!xmlText || !xmlText.includes('<')) {
    throw new Error('Conteúdo XML inválido ou vazio.');
  }

  const ide = extractTag(xmlText, 'ide');
  const emit = extractTag(xmlText, 'emit');
  const enderEmit = extractTag(emit, 'enderEmit');
  const totalBlock = extractTag(xmlText, 'ICMSTot') || extractTag(xmlText, 'total');

  // Access key from infNFe Id attribute or chNFe tag
  let accessKey = extractTag(xmlText, 'chNFe');
  if (!accessKey) {
    const idMatch = xmlText.match(/infNFe[^>]*Id=["']NFe(\d{44})["']/i);
    if (idMatch) accessKey = idMatch[1];
  }

  const invoiceNumber = extractTag(ide, 'nNF') || 'S/N';
  const rawDhEmi = extractTag(ide, 'dhEmi') || extractTag(ide, 'dEmi');
  const issueDate = rawDhEmi ? rawDhEmi.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const supplierName = extractTag(emit, 'xNome') || extractTag(emit, 'xFant') || 'Fornecedor não identificado';
  const rawCnpj = extractTag(emit, 'CNPJ') || extractTag(emit, 'CPF');
  const supplierCnpj = cleanCnpj(rawCnpj);
  const supplierPhone = extractTag(enderEmit, 'fone');
  const xLgr = extractTag(enderEmit, 'xLgr');
  const nro = extractTag(enderEmit, 'nro');
  const xMun = extractTag(enderEmit, 'xMun');
  const uf = extractTag(enderEmit, 'UF');
  const supplierAddress = [xLgr, nro, xMun && uf ? `${xMun}/${uf}` : xMun].filter(Boolean).join(', ');

  const detBlocks = extractAllTags(xmlText, 'det');
  if (detBlocks.length === 0) {
    throw new Error('Nenhum item (<det>) encontrado no XML da NF-e.');
  }

  const items: ParsedXmlItem[] = detBlocks.map((det, idx) => {
    const prod = extractTag(det, 'prod');
    const rastro = extractTag(prod, 'rastro') || extractTag(det, 'rastro') || extractTag(det, 'med');
    const xmlCode = extractTag(prod, 'cProd');
    const rawEan = extractTag(prod, 'cEAN');
    const barcode = rawEan && rawEan.toUpperCase() !== 'SEM GTIN' ? rawEan : '';
    const name = extractTag(prod, 'xProd') || `Item ${idx + 1}`;
    const rawUnit = extractTag(prod, 'uCom') || 'UN';
    const unitMap: Record<string, string> = {
      UN: 'Unidade',
      UND: 'Unidade',
      CX: 'Caixa',
      FR: 'Frasco',
      AMP: 'Ampola',
      PCT: 'Pacote',
      KIT: 'Kit',
      LT: 'Litro',
      TB: 'Bisnaga',
    };
    const unit = unitMap[rawUnit.toUpperCase()] || rawUnit;
    const quantity = Number(extractTag(prod, 'qCom')) || 0;
    const unitValue = Number(extractTag(prod, 'vUnCom')) || 0;
    const totalValue = Number(extractTag(prod, 'vProd')) || Number((quantity * unitValue).toFixed(2));
    const batchNumber = extractTag(rastro, 'nLote');
    const manufactureDate = (extractTag(rastro, 'dFab') || '').slice(0, 10);
    const expiryDate = (extractTag(rastro, 'dVal') || '').slice(0, 10);

    return {
      lineNumber: idx + 1,
      xmlCode,
      barcode,
      name,
      unit,
      quantity,
      unitValue,
      totalValue,
      batchNumber,
      manufactureDate,
      expiryDate,
      matchedProductId: null,
      matchedProductName: null,
      createNewProduct: false,
      categoryId: 1,
    };
  });

  const xmlTotal = Number(extractTag(totalBlock, 'vNF')) || items.reduce((acc, it) => acc + it.totalValue, 0);

  return {
    invoiceNumber,
    issueDate,
    accessKey,
    supplierName,
    supplierCnpj,
    supplierPhone,
    supplierAddress,
    matchedSupplierId: null,
    totalValue: Number(xmlTotal.toFixed(2)),
    items,
  };
}
