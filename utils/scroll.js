import { randomDelay } from './utils.js';

/**
 * Scroll the sidebar to load more results
 * @param {Object} page - Puppeteer page
 * @param {number} maxResults - Maximum results needed
 * @returns {Object} - Scroll count and whether end was reached
 */
export async function scrollSidebar(page, maxResults) {
    // Calculate max scrolls based on results needed
    // Each scroll loads approximately 5-10 results, so we need roughly maxResults/5 scrolls
    // Add extra buffer for safety, cap at 300 scrolls max to prevent infinite scrolling
    const maxScrolls = Math.min(300, Math.max(5, Math.ceil(maxResults / 5) + 10));
    
    let scrollCount = 0;
    let previousHeight = 0;
    let noChangeCount = 0;

    while (scrollCount < maxScrolls) {
        // Check how many results we currently have loaded
        const currentResultCount = await page.evaluate(() => {
            const articles = document.querySelectorAll('div[role="article"]');
            const links = document.querySelectorAll('a[href*="/maps/place/"]');
            return Math.max(articles.length, links.length);
        });

        // If we have enough results, stop scrolling early
        if (currentResultCount >= maxResults) {
            return { scrollCount, reachedEnd: false, resultsLoaded: currentResultCount };
        }

        // Scroll the results sidebar
        const scrollResult = await page.evaluate(() => {
            const sidebar = document.querySelector('[role="feed"]') ||
                          document.querySelector('div[class*="scrollable"]') ||
                          document.querySelector('[aria-label*="Results"]');

            if (sidebar) {
                sidebar.scrollTop = sidebar.scrollHeight;
                return { height: sidebar.scrollHeight, found: true };
            }
            return { height: 0, found: false };
        });

        await randomDelay(1500, 2500);

        // Check for "end of list" indicator
        const reachedEnd = await page.evaluate(() => {
            const pageText = document.body.innerText || '';
            return pageText.includes("You've reached the end of the list") ||
                   pageText.includes("No more results") ||
                   pageText.includes("Can't find more places");
        });

        if (reachedEnd) {
            const finalCount = await page.evaluate(() => {
                return document.querySelectorAll('div[role="article"]').length;
            });
            return { scrollCount, reachedEnd: true, resultsLoaded: finalCount };
        }

        // Check if height changed
        if (scrollResult.height === previousHeight || scrollResult.height === 0) {
            noChangeCount++;
            // Wait a bit longer and try again (Google Maps can be slow to load)
            if (noChangeCount >= 3) {
                const finalCount = await page.evaluate(() => {
                    return document.querySelectorAll('div[role="article"]').length;
                });
                return { scrollCount, reachedEnd: true, resultsLoaded: finalCount };
            }
            await randomDelay(2000, 3000);
        } else {
            noChangeCount = 0;
        }

        previousHeight = scrollResult.height;
        scrollCount++;
    }

    const finalCount = await page.evaluate(() => {
        return document.querySelectorAll('div[role="article"]').length;
    });
    return { scrollCount, reachedEnd: false, resultsLoaded: finalCount };
}

