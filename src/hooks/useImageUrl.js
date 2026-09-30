import { useEffect, useState } from 'react';
import { getImage } from '../services/imageService.js';

/**
 * Resolve a stored image path to a displayable signed URL.
 * Returns `{ url, loading, error }`; pass `null` to get a permanent "no image".
 */
export function useImageUrl(imageId) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(Boolean(imageId));
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (!imageId) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    getImage(imageId)
      .then((data) => {
        if (cancelled) return;
        setUrl(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [imageId]);

  return { url, loading, error };
}
