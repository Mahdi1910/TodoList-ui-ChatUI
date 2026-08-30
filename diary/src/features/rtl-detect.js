/**
 * Detects if a given string contains characters from Right-To-Left languages 
 * (like Arabic, Kurdish, Persian, Hebrew, Urdu, etc.).
 * 
 * @param {string} text - The text to evaluate.
 * @returns {boolean} - True if RTL characters are detected.
 */
export function isRTL(text) {
    if (!text) return false;
    // Arabic, Hebrew, Syriac, Thaana, N'Ko, etc.
    const rtlRegex = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
    return rtlRegex.test(text);
}

/**
 * Applies the 'dir' attribute (rtl or ltr) to a DOM element based on its text content.
 * 
 * @param {HTMLElement} element - The DOM element to update.
 * @param {string} text - The text content to evaluate.
 */
export function applyTextDirection(element, text) {
    if (!element || !text) return;
    
    if (isRTL(text)) {
        element.setAttribute('dir', 'rtl');
        // Optional: you can add specific classes if needed for RTL-specific CSS
        element.classList.add('is-rtl');
    } else {
        element.setAttribute('dir', 'ltr');
        element.classList.remove('is-rtl');
    }
}
