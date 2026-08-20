import { useCallback, useEffect, useRef, useState } from 'react';

export function useToasts() {
  const [toast, setToast] = useState('');
  const timerRef = useRef<number | undefined>(undefined);

  const push = useCallback((message: string) => {
    setToast(message);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    timerRef.current = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timerRef.current);
  }, [toast]);

  return { toast, push };
}

export function ToastHost({ toast }: { toast: string }) {
  if (!toast) return null;
  return <div className="toast" role="status">{toast}</div>;
}
