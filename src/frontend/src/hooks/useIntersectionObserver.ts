import { useEffect, useRef, useState } from "react";

interface UseIntersectionObserverOptions {
  root?: Element | null;
  rootMargin?: string;
  threshold?: number | number[];
}

/**
 * Reusable hook that wraps the native IntersectionObserver API.
 * Returns a [ref, isIntersecting] tuple.
 * - Attach `ref` to the element you want to observe.
 * - `isIntersecting` is true when the element is within the viewport.
 * Cleans up the observer on unmount.
 */
export function useIntersectionObserver<T extends Element>(
  options: UseIntersectionObserverOptions = {},
): [React.RefCallback<T>, boolean] {
  const { root = null, rootMargin = "200px 0px", threshold = 0 } = options;

  const [isIntersecting, setIsIntersecting] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRef = useRef<T | null>(null);

  // Stable ref callback — attaches/detaches the observer when the element mounts/unmounts
  const refCallback: React.RefCallback<T> = (element) => {
    // Disconnect from the previous element if any
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    elementRef.current = element;

    if (!element) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        const update = () => setIsIntersecting(entry.isIntersecting);
        if ("requestIdleCallback" in window) {
          requestIdleCallback(update, { timeout: 100 });
        } else {
          setTimeout(update, 0);
        }
      },
      { root, rootMargin, threshold },
    );

    observerRef.current.observe(element);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  return [refCallback, isIntersecting];
}
