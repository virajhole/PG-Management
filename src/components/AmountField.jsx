import { forwardRef } from 'react';

/** Numeric field with a `Rs` prefix and `inputMode="numeric"` for mobile keyboards. */
const AmountField = forwardRef(function AmountField(
  { id, label, error, hint, required, className, wrapperClassName, prefix = 'Rs', ...props },
  ref,
) {
  return (
    <div className={wrapperClassName}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-medium text-ink-subtle">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          type="number"
          inputMode="numeric"
          className={`field-input tabular-nums ${prefix ? 'pl-10' : ''} ${error ? 'field-input-error' : ''} ${
            className ?? ''
          }`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          {...props}
        />
      </div>
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
});

export { AmountField };
