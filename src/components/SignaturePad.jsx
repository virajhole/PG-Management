import { useEffect, useRef, useState } from 'react';

/**
 * Signature pad: draws with pointer events (touch + mouse), exports a PNG data
 * URL sized to the strokes. Used to sign the rent agreement.
 */
export default function SignaturePad({ value, onChange, label = 'Tenant signature' }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [dirty, setDirty] = useState(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);

    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = value;
    }
  }, [value]);

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    setDirty(true);
  }

  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange?.(canvasRef.current.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDirty(false);
    onChange?.(null);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="field-label mb-0">{label}</span>
        <button type="button" onClick={clear} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300" disabled={!dirty}>
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-36 w-full touch-none rounded-xl border-2 border-dashed border-line-strong bg-white"
        aria-label={label}
        role="img"
      />
      {!dirty && <p className="field-hint">Draw the signature above using a finger or mouse.</p>}
    </div>
  );
}
