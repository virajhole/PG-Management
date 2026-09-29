import { useEffect, useState } from 'react';
import { useImageUrl } from '../hooks/useImageUrl.js';

/**
 * Full-screen ID document viewer: pinch/double-tap to zoom, drag to pan, tap
 * outside or press Escape to close.
 */
export default function ImageViewer({ imageId, open, onClose, title = 'Document' }) {
  const { url, loading } = useImageUrl(open ? imageId : null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);

  // Reset the view whenever a different document is opened.
  useEffect(() => {
    if (open) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [open, imageId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  function handlePointerDown(event) {
    if (zoom <= 1) return;
    setDrag({ x: event.clientX - offset.x, y: event.clientY - offset.y });
  }

  function handlePointerMove(event) {
    if (!drag) return;
    setOffset({ x: event.clientX - drag.x, y: event.clientY - drag.y });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-slate-950/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          {zoom > 1 && (
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setOffset({ x: 0, y: 0 });
              }}
              className="min-h-10 rounded-lg px-3 text-sm font-medium text-white/80 transition hover:bg-white/10"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10"
            aria-label="Close viewer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-6">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
        onClick={onClose}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        {loading && <p className="text-sm text-white/70">Loading image…</p>}
        {!loading && !url && <p className="text-sm text-white/70">No image available.</p>}
        {url && (
          <img
            src={url}
            alt={title}
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => (z > 1 ? 1 : 2.5));
            }}
            className={`max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform
                        ${drag ? '' : 'duration-200'} ${zoom > 1 ? 'cursor-grab' : 'cursor-zoom-in'}`}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              touchAction: zoom > 1 ? 'none' : 'auto',
            }}
            draggable={false}
          />
        )}
      </div>

      {url && (
        <p className="px-4 py-3 text-center text-xs text-white/50">
          Tap the image to zoom in or out · drag to pan when zoomed
        </p>
      )}
    </div>
  );
}
