import { useRef, useState } from 'react';
import { compressImage, formatBytes } from '../utils/image.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner } from './States.jsx';
import { CameraIcon, TrashIcon, IdCardIcon } from './icons.jsx';

/**
 * Image field with preview.
 *
 * Two separate inputs so mobile browsers behave predictably: one launches the
 * camera directly (`capture`), the other opens the gallery. Both go through
 * `compressImage` before the data URL reaches the storage layer.
 */
export default function ImagePicker({
  value,
  onChange,
  label = 'Photo',
  hint = 'JPG or PNG. Auto-compressed to about 800px wide.',
  icon: Icon = CameraIcon,
  disabled = false,
  testId,
}) {
  const toast = useToast();
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [previewMeta, setPreviewMeta] = useState(null);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires onChange.
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const result = await compressImage(file);
      setPreviewMeta({ bytes: result.bytes, width: result.width, height: result.height });
      onChange?.(result.dataUrl);
    } catch (error) {
      toast.error(error.message || 'Could not process that image.');
    } finally {
      setBusy(false);
    }
  }

  function handleRemove() {
    onChange?.(null);
    setPreviewMeta(null);
  }

  return (
    <div data-testid={testId}>
      <span className="field-label">{label}</span>

      <div className="flex flex-wrap items-start gap-4">
        <div
          className={`flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border
                      border-dashed bg-sunken ${value ? 'border-brand-300' : 'border-line-strong'}`}
        >
          {busy ? (
            <Spinner className="size-6 text-brand-600" />
          ) : value ? (
            <img src={value} alt={`${label} preview`} className="size-full object-cover" />
          ) : (
            <Icon className="size-7 text-ink-subtle" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={disabled || busy}
              className="btn-secondary flex-1"
            >
              <CameraIcon className="size-4 shrink-0" />
              Take photo
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={disabled || busy}
              className="btn-secondary flex-1"
            >
              <IdCardIcon className="size-4 shrink-0" />
              {value ? 'Replace' : 'Upload'}
            </button>
          </div>

          {value && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={disabled}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              <TrashIcon className="size-4" />
              Remove image
            </button>
          )}

          <p className="field-hint">
            {value && previewMeta ? (
              <>
                Saved at {previewMeta.width}×{previewMeta.height}px · {formatBytes(previewMeta.bytes)}
              </>
            ) : (
              hint
            )}
          </p>
        </div>
      </div>

      {/* `capture` makes Android/iOS open the camera instead of the file list. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleFile}
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFile}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
