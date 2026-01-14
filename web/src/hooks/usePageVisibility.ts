import { useEffect, useState } from "react";

export function usePageVisibility() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const updateVisibility = () => {
      setVisible(!document.hidden);
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  return visible;
}
