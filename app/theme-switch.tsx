"use client";
import {useLanguage} from "./language-provider";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
export default function ThemeSwitch() {
    const { t } = useLanguage();
    const [theme, setTheme] = useState("light");
    useEffect(() => { setTheme(document.documentElement.dataset.theme || "light"); }, []);
    function choose(value: "light" | "dark") {
        document.documentElement.dataset.theme = value;
        setTheme(value);
        try {
            localStorage.setItem("localtransfer-theme", value);
        }
        catch { /* The selection still works without local storage. */ }
    }
    return <div className="theme-switch" role="group" aria-label={t("Apar\u00EAncia da p\u00E1gina")}>
    <button className="theme-button" type="button" aria-label={t("Modo claro")} title={t("Modo claro")} aria-pressed={theme === "light"} onClick={() => choose("light")}><Sun size={20}/></button>
    <button className="theme-button" type="button" aria-label={t("Modo escuro")} title={t("Modo escuro")} aria-pressed={theme === "dark"} onClick={() => choose("dark")}><Moon size={20}/></button>
  </div>;
}
