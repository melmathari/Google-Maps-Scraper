import { randomDelay } from './utils.js';

/**
 * Scroll the reviews panel to load more reviews
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews needed
 * @param {Object} log - Logger instance (optional)
 * @returns {Object} - Scroll count and whether end was reached
 */
export async function scrollReviewsPanel(page, maxReviews, log = console) {
    // Calculate max scrolls based on reviews needed
    // Each scroll loads approximately 3-5 reviews
    const maxScrolls = Math.min(200, Math.max(5, Math.ceil(maxReviews / 3) + 10));
    
    let scrollCount = 0;
    let previousHeight = 0;
    let previousCount = 0;
    let noChangeCount = 0;

    while (scrollCount < maxScrolls) {
        // Count reviews using multiple selectors (Google changes these frequently)
        const currentReviewCount = await page.evaluate(() => {
            // Primary: data-review-id attribute
            const byDataId = document.querySelectorAll('div[data-review-id]');
            if (byDataId.length > 0) return byDataId.length;
            
            // Fallback: jftiEf class (common review container class)
            const byClass = document.querySelectorAll('div.jftiEf');
            if (byClass.length > 0) return byClass.length;
            
            // Fallback: Find by "Photo of" buttons (each review has one)
            const photoButtons = document.querySelectorAll('button[aria-label^="Photo of"]');
            if (photoButtons.length > 0) return photoButtons.length;
            
            // Fallback: Find by share buttons pattern
            const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
            if (shareButtons.length > 0) return shareButtons.length;
            
            return 0;
        });

        // If we have enough reviews, stop scrolling early
        if (currentReviewCount >= maxReviews) {
            log.info?.(`📜 Loaded ${currentReviewCount} reviews (target reached)`);
            return { scrollCount, reachedEnd: false, reviewsLoaded: currentReviewCount };
        }

        // Find and scroll the reviews container
        const scrollResult = await page.evaluate(() => {
            // Multiple selectors for the scrollable reviews container
            const containerSelectors = [
                '[role="main"]',                    // Main content area
                '.section-scrollbox',               // Legacy selector
                '[tabindex="-1"]',                  // Common scrollable container attribute
                'div[class*="review"]',             // Any div with review in class
            ];
            
            // Try specific selectors first
            for (const selector of containerSelectors) {
                const container = document.querySelector(selector);
                if (container && container.scrollHeight > container.clientHeight) {
                    const prevTop = container.scrollTop;
                    container.scrollTop = container.scrollHeight;
                    return { 
                        height: container.scrollHeight, 
                        found: true, 
                        scrolled: container.scrollTop !== prevTop 
                    };
                }
            }
            
            // Fallback: Find any scrollable container with reviews inside
            const allDivs = document.querySelectorAll('div');
            for (const div of allDivs) {
                const style = window.getComputedStyle(div);
                const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                    div.scrollHeight > div.clientHeight;
                // Must be a substantial container (not a tiny scrollable area)
                if (isScrollable && div.scrollHeight > 500) {
                    // Check if this container has reviews inside
                    const hasReviews = div.querySelector('[data-review-id]') || 
                                      div.querySelector('button[aria-label^="Photo of"]');
                    if (hasReviews) {
                        const prevTop = div.scrollTop;
                        div.scrollTop = div.scrollHeight;
                        return { 
                            height: div.scrollHeight, 
                            found: true, 
                            scrolled: div.scrollTop !== prevTop 
                        };
                    }
                }
            }
            
            // Last resort: scroll any large scrollable div
            for (const div of allDivs) {
                const style = window.getComputedStyle(div);
                const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                    div.scrollHeight > div.clientHeight;
                if (isScrollable && div.scrollHeight > 500) {
                    const prevTop = div.scrollTop;
                    div.scrollTop = div.scrollHeight;
                    return { 
                        height: div.scrollHeight, 
                        found: true, 
                        scrolled: div.scrollTop !== prevTop 
                    };
                }
            }
            
            return { height: 0, found: false, scrolled: false };
        });

        await randomDelay(1500, 2500);

        // Check for "end of reviews" indicators
        const reachedEnd = await page.evaluate(() => {
            const pageText = document.body.innerText || '';
            // Check for common "no more reviews" patterns
            return pageText.includes("No more reviews") ||
                   pageText.includes("end of reviews") ||
                   // If there's a "More reviews" button that's not clickable, we've loaded all
                   (document.querySelector('button[aria-label*="More reviews"]')?.disabled === true);
        });

        if (reachedEnd) {
            const finalCount = await page.evaluate(() => {
                const byDataId = document.querySelectorAll('div[data-review-id]');
                if (byDataId.length > 0) return byDataId.length;
                const photoButtons = document.querySelectorAll('button[aria-label^="Photo of"]');
                return photoButtons.length;
            });
            log.info?.(`📜 Reached end of reviews (${finalCount} total)`);
            return { scrollCount, reachedEnd: true, reviewsLoaded: finalCount };
        }

        // Check if content changed (height or review count)
        const heightUnchanged = scrollResult.height === previousHeight || scrollResult.height === 0;
        const countUnchanged = currentReviewCount === previousCount;
        
        if (heightUnchanged && countUnchanged) {
            noChangeCount++;
            // Wait a bit longer and try again (Google Maps can be slow to load)
            if (noChangeCount >= 5) {
                log.info?.(`📜 No more reviews loading after ${noChangeCount} attempts (${currentReviewCount} total)`);
                return { scrollCount, reachedEnd: true, reviewsLoaded: currentReviewCount };
            }
            await randomDelay(2000, 3000);
        } else {
            noChangeCount = 0;
            if (currentReviewCount > previousCount) {
                log.debug?.(`📜 Loaded ${currentReviewCount} reviews so far...`);
            }
        }

        previousHeight = scrollResult.height;
        previousCount = currentReviewCount;
        scrollCount++;
    }

    // Final count
    const finalCount = await page.evaluate(() => {
        const byDataId = document.querySelectorAll('div[data-review-id]');
        if (byDataId.length > 0) return byDataId.length;
        const photoButtons = document.querySelectorAll('button[aria-label^="Photo of"]');
        return photoButtons.length;
    });
    
    log.info?.(`📜 Finished scrolling reviews (${finalCount} loaded, ${scrollCount} scrolls)`);
    return { scrollCount, reachedEnd: false, reviewsLoaded: finalCount };
}

