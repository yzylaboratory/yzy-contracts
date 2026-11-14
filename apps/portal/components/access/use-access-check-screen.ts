"use client";

import { useEffect, useState } from "react";

const minimumVisibleMs = 650;

export function useAccessCheckScreen(loading: boolean) {
  const [wasLoading, setWasLoading] = useState(loading);
  const [check, setCheck] = useState(loading ? 1 : 0);
  const [elapsedCheck, setElapsedCheck] = useState(0);

  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (loading) setCheck(check + 1);
  }

  useEffect(() => {
    if (check === 0) return;
    const timer = window.setTimeout(() => setElapsedCheck(check), minimumVisibleMs);
    return () => window.clearTimeout(timer);
  }, [check]);

  return loading || check !== elapsedCheck;
}
