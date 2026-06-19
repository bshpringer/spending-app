"use client";

import { useEffect, useState } from "react";

export function ObscureToggle() {
  const [obscured, setObscured] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("obscure-mode") === "true";
    setObscured(saved);
    if (saved) document.body.classList.add("obscure-mode");
  }, []);

  function toggle() {
    const next = !obscured;
    setObscured(next);
    if (next) {
      document.body.classList.add("obscure-mode");
      localStorage.setItem("obscure-mode", "true");
    } else {
      document.body.classList.remove("obscure-mode");
      localStorage.removeItem("obscure-mode");
    }
  }

  return (
    <button
      onClick={toggle}
      title={obscured ? "Show amounts" : "Hide amounts for screenshot"}
      style={{
        marginLeft: "auto",
        padding: "3px 10px",
        fontSize: 14,
        border: "1px solid",
        borderRadius: 5,
        cursor: "pointer",
        background: obscured ? "rgba(255,255,255,0.2)" : "transparent",
        color: obscured ? "#fff" : "rgba(255,255,255,0.6)",
        borderColor: obscured ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)",
        fontWeight: 500,
        letterSpacing: "0.02em",
      }}
    >
      {obscured ? "Show $" : "Hide $"}
    </button>
  );
}
