import { useImageUrl } from '../hooks/useImageUrl.js';
import { getInitials } from '../utils/format.js';

const SIZES = {
  sm: 'size-9 text-xs',
  md: 'size-11 text-sm',
  lg: 'size-14 text-base',
  xl: 'size-24 text-2xl',
};

/** Photo when available, otherwise a tinted initials bubble. */
export default function Avatar({ customer, size = 'md', className = '' }) {
  const imageId = customer?.photoId;
  const { url, loading } = useImageUrl(imageId);
  const initials = getInitials(customer?.name);
  const dimension = SIZES[size] ?? SIZES.md;

  if (url) {
    return (
      <img
        src={url}
        alt={customer?.name ? `${customer.name} photo` : 'Customer photo'}
        className={`${dimension} shrink-0 rounded-full border border-line bg-sunken object-cover ${className}`}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={`${dimension} flex shrink-0 items-center justify-center rounded-full bg-brand-100
                  font-semibold text-brand-700 ${loading ? 'animate-pulse' : ''} ${className}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
