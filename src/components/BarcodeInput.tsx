import React, { useRef, useState } from 'react';
import { ScanBarcode, Search } from 'lucide-react';

interface BarcodeInputProps {
  value: string;
  onChange: (val: string) => void;
  onScan: (code: string) => void;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
}

/**
 * Componente preparado para leitores USB HID (emulação de teclado + Enter)
 * e entrada manual, com estrutura extensível para leitores móveis / QR Code.
 */
export const BarcodeInput: React.FC<BarcodeInputProps> = ({
  value,
  onChange,
  onScan,
  placeholder = 'Bipar código de barras USB ou digitar código interno...',
  label,
  autoFocus = false,
}) => {
  const lastKeystrokeRef = useRef<number>(0);
  const [scannerPulse, setScannerPulse] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = performance.now();
    // Leitores USB enviam caracteres em < 50ms
    if (now - lastKeystrokeRef.current < 50 && e.key.length === 1) {
      setScannerPulse(true);
    }
    lastKeystrokeRef.current = now;

    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        onScan(trimmed);
        setTimeout(() => setScannerPulse(false), 300);
      }
    }
  };

  return (
    <div className="w-full">
      {label && (
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      )}
      <div className="relative flex items-center">
        <ScanBarcode
          className={`w-4 h-4 absolute left-3 pointer-events-none transition-colors ${
            scannerPulse ? 'text-blue-600' : 'text-slate-400'
          }`}
        />
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full h-10 pl-9 pr-24 rounded-lg border border-slate-300 bg-white text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
        />
        <button
          type="button"
          onClick={() => {
            if (value.trim()) onScan(value.trim());
          }}
          className="absolute right-1.5 h-7 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-blue-700 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Search className="w-3.5 h-3.5" />
          <span>Localizar</span>
        </button>
      </div>
    </div>
  );
};
