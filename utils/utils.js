/**
 * Random delay to simulate human behavior
 * @param {number} min - Minimum delay in milliseconds
 * @param {number} max - Maximum delay in milliseconds
 */
export async function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Construct Google Maps search URL
 * @param {string} searchQuery - What to search for (e.g., "restaurants in Dubai")
 * @param {string} location - Optional location override
 * @param {string} language - Language code (e.g., 'en', 'ar', 'fr')
 * @returns {string} Google Maps search URL
 */
export function constructGoogleMapsUrl(searchQuery, location = null, language = 'en') {
    const baseUrl = 'https://www.google.com/maps/search/';

    let query = searchQuery.trim();
    if (location && location.trim()) {
        query = `${query} in ${location.trim()}`;
    }

    // Set language with hl parameter (defaults to English)
    const lang = language && language.trim() ? language.trim() : 'en';
    return `${baseUrl}${encodeURIComponent(query)}?hl=${lang}`;
}

/**
 * Capture debug screenshot and page info when errors occur
 * @param {Object} page - Puppeteer page
 * @param {Object} Actor - Apify Actor instance
 * @param {Object} log - Logger instance
 * @param {string} prefix - Screenshot name prefix (e.g., 'error', 'consent')
 * @returns {Object|null} Debug info object or null if capture failed
 */
export async function captureDebugScreenshot(page, Actor, log, prefix = 'error') {
    try {
        const screenshotKey = `SCREENSHOT-${prefix}-${Date.now()}`;
        const screenshot = await page.screenshot({ fullPage: false, type: 'png' });
        await Actor.setValue(screenshotKey, Buffer.from(screenshot), { contentType: 'image/png' });
        log.info(`📸 Debug screenshot saved as ${screenshotKey}`);

        // Collect debug info about the page state
        const debugInfo = await page.evaluate(() => ({
            url: window.location.href,
            title: document.title,
            bodyText: document.body?.innerText?.substring(0, 1000) || '',
            hasConsent: !!document.querySelector('form[action*="consent"]'),
            hasCaptcha: document.body?.innerText?.includes('captcha') || document.body?.innerText?.includes('unusual traffic')
        }));
        log.info(`Debug info: ${JSON.stringify(debugInfo, null, 2)}`);

        return debugInfo;
    } catch (screenshotError) {
        log.warning(`Could not capture debug screenshot: ${screenshotError.message}`);
        return null;
    }
}

