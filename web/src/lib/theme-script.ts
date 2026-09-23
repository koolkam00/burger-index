// Shared by the root layout (server) and the theme controls (client). Not a client module, so the
// string is a real string on the server.

export const THEME_KEY = "bi-theme";
export const BOARD_SEEN_KEY = "bi-board-seen";

/** Runs in <head> before first paint: applies a stored theme, flags JS, remembers the board animation. */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')d.setAttribute('data-theme',t)}catch(e){}try{if(sessionStorage.getItem('${BOARD_SEEN_KEY}'))d.classList.add('board-seen')}catch(e){}})();`;
