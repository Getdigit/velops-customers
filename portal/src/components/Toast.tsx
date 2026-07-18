/* ============================================================
   Toast — mockup-style dark toast, bottom-center. Provide once
   near the app root; fire via useToast().
     const toast = useToast();
     toast(<>Ticket <b>VEL-01043</b> created.</>);
   ============================================================ */
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

type ToastFn = (content: ReactNode) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const fn = useContext(ToastContext);
  if (!fn) throw new Error("useToast must be used inside <ToastProvider>.");
  return fn;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback<ToastFn>((node) => {
    setContent(node);
    setShow(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 3200);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={`toast${show ? " show" : ""}`} role="status" aria-live="polite">
        {content}
      </div>
    </ToastContext.Provider>
  );
}
