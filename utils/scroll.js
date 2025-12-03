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

    console.log(`📜 Will scroll up to ${maxScrolls} times to load ${maxResults} results...`);

    while (scrollCount < maxScrolls) {
        // Check how many results we currently have loaded
        const currentResultCount = await page.evaluate(() => {
            const articles = document.querySelectorAll('div[role="article"]');
            const links = document.querySelectorAll('a[href*="/maps/place/"]');
            return Math.max(articles.length, links.length);
        });

        // If we have enough results, stop scrolling early
        if (currentResultCount >= maxResults) {
            console.log(`✓ Already have ${currentResultCount} results loaded, stopping early after ${scrollCount} scrolls`);
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
            console.log(`✓ Reached end of Google Maps results after ${scrollCount} scrolls`);
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
                console.log(`✓ No new content after ${noChangeCount} attempts, stopping at ${scrollCount} scrolls`);
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

        // Log progress every 10 scrolls
        if (scrollCount % 10 === 0) {
            console.log(`   Scrolled ${scrollCount} times, loaded ~${currentResultCount} results so far...`);
        }
    }

    const finalCount = await page.evaluate(() => {
        return document.querySelectorAll('div[role="article"]').length;
    });
    console.log(`✓ Completed maximum ${scrollCount} scrolls, loaded ${finalCount} results`);
    return { scrollCount, reachedEnd: false, resultsLoaded: finalCount };
}

