import { randomDelay } from './utils.js';

/**
 * Find review elements on the page using multiple detection methods
 * @param {Object} page - Puppeteer page
 * @returns {Promise<number>} - Number of reviews found
 */
async function countReviews(page) {
    return page.evaluate(() => {
        // Method 1: Find elements with star rating aria-labels (most reliable)
        const starElements = document.querySelectorAll('span[role="img"][aria-label*="star"]');
        if (starElements.length > 0) {
            // Each review has one star rating, so count unique parent containers
            const reviewContainers = new Set();
            for (const star of starElements) {
                // Go up to find the review container (usually 3-5 levels up)
                let parent = star.parentElement;
                for (let i = 0; i < 8 && parent; i++) {
                    // A review container typically has substantial height and contains text
                    if (parent.offsetHeight > 80 && parent.offsetHeight < 500) {
                        reviewContainers.add(parent);
                        break;
                    }
                    parent = parent.parentElement;
                }
            }
            if (reviewContainers.size > 0) return reviewContainers.size;
        }
        
        // Method 2: Find by common review class (fallback)
        const byClass = document.querySelectorAll('.jftiEf');
        if (byClass.length > 0) return byClass.length;
        
        // Method 3: Find by data-review-id attribute
        const byDataId = document.querySelectorAll('[data-review-id]');
        if (byDataId.length > 0) return byDataId.length;
        
        return 0;
    });
}

/**
 * Get the last review element on the page
 * @param {Object} page - Puppeteer page
 * @returns {Promise<ElementHandle|null>} - Last review element or null
 */
async function getLastReviewElement(page) {
    // Try multiple methods to find review elements
    const selectors = [
        'span[role="img"][aria-label*="star"]',  // Star ratings
        '.jftiEf',                                // Common review class
        '[data-review-id]',                       // Data attribute
    ];
    
    for (const selector of selectors) {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
            // For star ratings, we need to go up to the review container
            if (selector.includes('star')) {
                const lastStar = elements[elements.length - 1];
                // Get the parent review container
                const reviewContainer = await page.evaluateHandle((el) => {
                    let parent = el.parentElement;
                    for (let i = 0; i < 8 && parent; i++) {
                        if (parent.offsetHeight > 80 && parent.offsetHeight < 500) {
                            return parent;
                        }
                        parent = parent.parentElement;
                    }
                    return el.parentElement?.parentElement?.parentElement || el;
                }, lastStar);
                return reviewContainer;
            }
            return elements[elements.length - 1];
        }
    }
    return null;
}

/**
 * Scroll reviews by clicking on the last review and using keyboard/scroll
 * This approach doesn't rely on finding the scrollable container
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews to load
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} - Scroll result with review count
 */
export async function scrollReviewsPanel(page, maxReviews, log = console) {
    log.info?.(`📜 Starting review scroll (target: ${maxReviews === Infinity ? 'unlimited' : maxReviews})`);
    
    const initialCount = await countReviews(page);
    log.info?.(`📜 Initial review count: ${initialCount}`);
    
    if (initialCount >= maxReviews) {
        return { scrollCount: 0, reachedEnd: false, reviewsLoaded: initialCount };
    }
    
    let lastCount = initialCount;
    let noChangeCount = 0;
    const maxTries = 15;
    let scrollAttempts = 0;
    
    while (noChangeCount < maxTries && scrollAttempts < 100) {
        const currentCount = await countReviews(page);
        
        // Check if we've reached our target
        if (currentCount >= maxReviews) {
            log.info?.(`📜 Reached target: ${currentCount} reviews`);
            break;
        }
        
        // Get the last review element and click on it
        const lastReview = await getLastReviewElement(page);
        
        if (lastReview) {
            try {
                // Click on the last review to focus that area
                await lastReview.click({ delay: 100 });
                await randomDelay(300, 500);
                
                // Method 1: Scroll the element into view and beyond
                await page.evaluate((el) => {
                    if (el && el.scrollIntoView) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    }
                }, lastReview);
                
                await randomDelay(500, 800);
                
                // Method 2: Use keyboard to scroll down
                await page.keyboard.press('PageDown');
                await randomDelay(300, 500);
                await page.keyboard.press('PageDown');
                await randomDelay(300, 500);
                await page.keyboard.press('End');
                
            } catch (e) {
                // Element might have been removed from DOM, continue
                log.debug?.(`Click failed: ${e.message}`);
            }
        }
        
        // Also try scrolling any scrollable container near the reviews
        await page.evaluate(() => {
            // Find all scrollable elements
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                if (el.scrollHeight > el.clientHeight + 100) {
                    // Check if this element contains star ratings (reviews)
                    if (el.querySelector('span[role="img"][aria-label*="star"]')) {
                        el.scrollTop = el.scrollHeight;
                    }
                }
            }
        });
        
        // Wait for new content to load
        await randomDelay(1500, 2500);
        
        const newCount = await countReviews(page);
        
        if (newCount === lastCount) {
            noChangeCount++;
            if (noChangeCount % 3 === 0) {
                log.info?.(`📜 No new reviews (attempt ${noChangeCount}/${maxTries}), current: ${newCount}`);
            }
        } else {
            log.info?.(`📜 Loaded ${newCount} reviews (+${newCount - lastCount})`);
            noChangeCount = 0;
            lastCount = newCount;
        }
        
        scrollAttempts++;
    }
    
    const finalCount = await countReviews(page);
    log.info?.(`📜 Finished scrolling. Total reviews: ${finalCount}`);
    
    return {
        scrollCount: scrollAttempts,
        reachedEnd: noChangeCount >= maxTries,
        reviewsLoaded: finalCount
    };
}
