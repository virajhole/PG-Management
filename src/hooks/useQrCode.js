import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Render `text` as a QR code data URL. Returns '' while text is empty. */
export function useQrCode(text, { width = 220 } = {}) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!text) {
      setDataUrl('');
      return undefined;
    }
    let cancelled = false;
    QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [text, width]);

  return dataUrl;
}
