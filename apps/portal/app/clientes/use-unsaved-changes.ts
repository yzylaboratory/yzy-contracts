"use client";

import { useCallback, useEffect, useRef } from "react";

export function useUnsavedChanges() {
  const dirty = useRef(false);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const confirmNavigation = useCallback(() => !dirty.current || window.confirm("¿Salir sin guardar los cambios?"), []);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty.current) event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return { setDirty, confirmNavigation };
}
