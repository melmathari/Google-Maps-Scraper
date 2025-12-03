import { randomDelay } from './utils.js';

/**
 * Scroll the reviews panel to load more reviews
 * Uses scrollIntoView() on the last review element to trigger lazy loading
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

        // NEW APPROACH: Use scrollIntoView on the last review element
        // This triggers lazy loading better than scrollTop
        const scrollResult = await page.evaluate(() => {
            // Find all review elements
            const reviews = document.querySelectorAll('div[data-review-id]');
            
            if (reviews.length === 0) {
                // Fallback: try other selectors
                const altReviews = document.querySelectorAll('div.jftiEf');
                if (altReviews.length > 0) {
                    const lastReview = altReviews[altReviews.length - 1];
                    lastReview.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    return { found: true, method: 'scrollIntoView-jftiEf', count: altReviews.length };
                }
                return { found: false, method: 'none', count: 0 };
            }
            
            // Scroll the last review into view - this triggers lazy loading
            const lastReview = reviews[reviews.length - 1];
            lastReview.scrollIntoView({ behavior: 'smooth', block: 'end' });
            
            return { found: true, method: 'scrollIntoView-dataReviewId', count: reviews.length };
        });

        // Log scroll result for debugging
        if (scrollResult.found) {
            log.debug?.(`📜 Scrolled using method: ${scrollResult.method}, reviews visible: ${scrollResult.count}`);
        } else {
            log.warning?.(`📜 Could not find review elements to scroll`);
        }

        // Wait for Google Maps to load more reviews (lazy loading needs time)
        await randomDelay(2500, 4000);

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

        // Check if review count changed
        if (currentReviewCount === previousCount) {
            noChangeCount++;
            // Wait a bit longer and try again (Google Maps can be slow to load)
            if (noChangeCount >= 5) {
                log.info?.(`📜 No more reviews loading after ${noChangeCount} attempts (${currentReviewCount} total)`);
                return { scrollCount, reachedEnd: true, reviewsLoaded: currentReviewCount };
            }
            await randomDelay(2000, 3000);
        } else {
            noChangeCount = 0;
            log.debug?.(`📜 Loaded ${currentReviewCount} reviews so far...`);
        }

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

