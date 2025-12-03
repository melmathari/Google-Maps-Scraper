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
 * @returns {string} Google Maps search URL
 */
export function constructGoogleMapsUrl(searchQuery, location = null) {
    const baseUrl = 'https://www.google.com/maps/search/';

    let query = searchQuery.trim();
    if (location && location.trim()) {
        query = `${query} in ${location.trim()}`;
    }

    // Force English language with hl=en parameter
    return `${baseUrl}${encodeURIComponent(query)}?hl=en`;
}

