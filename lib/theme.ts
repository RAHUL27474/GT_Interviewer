// Theme (light / dark / system) shared by the root layout and the switcher. No React, so the server can use it.

export const THEME_STORAGE_KEY = "theme";

/** Inlined in <head>: applies the saved theme before the first paint, so dark mode never flashes white. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
