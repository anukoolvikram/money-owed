"use client";
// Lets a button keep its loading spinner until the page is showing the result
// of the save, instead of stopping as soon as the server replies (which would
// leave old numbers on screen while the refreshed page is still on its way).
//
// The server page passes a short `stamp` (a fingerprint of the data it shows).
// begin() remembers the current stamp; the returned wait() resolves once a new
// stamp arrives, or after a timeout so a button can never spin forever.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

type Waiter = { from: string; done: () => void };
type Fresh = { begin: () => () => Promise<void> };

const FreshCtx = createContext<Fresh>({ begin: () => () => Promise.resolve() });

const MAX_WAIT_MS = 8_000;

export function FreshData({ stamp, children }: { stamp: string; children: ReactNode }) {
  const current = useRef(stamp);
  const waiters = useRef(new Set<Waiter>());

  useEffect(() => {
    current.current = stamp;
    for (const w of waiters.current) if (w.from !== stamp) w.done();
  }, [stamp]);

  const begin = useCallback(() => {
    const from = current.current;
    return () =>
      new Promise<void>((resolve) => {
        if (current.current !== from) return resolve();
        const w: Waiter = {
          from,
          done: () => {
            clearTimeout(timer);
            waiters.current.delete(w);
            resolve();
          },
        };
        const timer = setTimeout(w.done, MAX_WAIT_MS);
        waiters.current.add(w);
      });
  }, []);

  const value = useMemo(() => ({ begin }), [begin]);
  return <FreshCtx.Provider value={value}>{children}</FreshCtx.Provider>;
}

/** Call begin() before saving; await the returned function after a successful save. */
export function useFresh(): Fresh {
  return useContext(FreshCtx);
}
