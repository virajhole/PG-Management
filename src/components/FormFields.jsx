import { forwardRef } from 'react';

/** Labelled input wired to react-hook-form's register(). */

function FieldShell({ id, label, error, hint, required, children, className = '' }) {
  return (
    <div className={className}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
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
}

const TextField = forwardRef(function TextField(
  { id, label, error, hint, required, className, wrapperClassName, ...props },
  ref,
) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      <input
        ref={ref}
        id={id}
        className={`field-input ${error ? 'field-input-error' : ''} ${className ?? ''}`}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
    </FieldShell>
  );
});

const Textarea = forwardRef(function Textarea(
  { id, label, error, hint, required, className, wrapperClassName, ...props },
  ref,
) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      <textarea
        ref={ref}
        id={id}
        rows={3}
        className={`field-input resize-y ${error ? 'field-input-error' : ''} ${className ?? ''}`}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
    </FieldShell>
  );
});

const SelectField = forwardRef(function SelectField(
  { id, label, error, hint, required, options, placeholder, className, wrapperClassName, children, ...props },
  ref,
) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      <select
        ref={ref}
        id={id}
        className={`field-input appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-10
                    ${error ? 'field-input-error' : ''} ${className ?? ''}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        {children}
      </select>
    </FieldShell>
  );
});

export { TextField, Textarea, SelectField, FieldShell };
