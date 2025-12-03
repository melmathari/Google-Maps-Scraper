import { randomDelay } from './utils.js';

/**
 * Auto-scroll function that runs entirely inside the browser context
 * This is the exact approach from the tutorial - everything runs inside page.evaluate
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews to load
 * @returns {Promise<number>} - Number of reviews loaded
 */
async function autoScrollInBrowser(page, maxReviews) {
    return page.evaluate(async (targetReviews) => {
        // Helper function to find the scrollable element
        async function getScrollableElement() {
            const selectors = [
                '.DxyBCb [role="main"]',
                '.WNBkOb [role="main"]',
                '.review-dialog-list',
                '.section-layout-root',
                '.m6QErb.DxyBCb.kA9KIf.dS8AEf',  // Common reviews container
                '.m6QErb[aria-label]',
                '.m6QErb.DxyBCb',
                '[role="main"]',
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    // Check if this element is scrollable
                    if (element.scrollHeight > element.clientHeight) {
                        return element;
                    }
                }
            }

            // Fallback: find any scrollable container with reviews
            const possibleContainers = document.querySelectorAll('div');
            for (const container of possibleContainers) {
                if (
                    container.scrollHeight > container.clientHeight &&
                    container.querySelector('.jftiEf.fontBodyMedium')
                ) {
                    return container;
                }
            }

            return null;
        }

        // Count reviews using the tutorial's selector
        const getReviewCount = () => {
            const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium');
            return reviews.length;
        };

        const scrollable = await getScrollableElement();
        if (!scrollable) {
            console.error('Could not find scrollable container');
            return 0;
        }

        let lastCount = getReviewCount();
        let noChangeCount = 0;
        const maxTries = 15; // More attempts than tutorial's 10
        let scrollAttempts = 0;
        const maxScrollAttempts = 500; // Safety limit

        while (noChangeCount < maxTries && scrollAttempts < maxScrollAttempts) {
            // Check if we've reached our target
            const currentCount = getReviewCount();
            if (targetReviews !== Infinity && currentCount >= targetReviews) {
                return currentCount;
            }

            // Scroll to bottom of the container
            if (scrollable.scrollTo) {
                scrollable.scrollTo(0, scrollable.scrollHeight);
            } else {
                scrollable.scrollTop = scrollable.scrollHeight;
            }

            // Wait for new content to load
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const newCount = getReviewCount();
            if (newCount === lastCount) {
                noChangeCount++;
            } else {
                noChangeCount = 0;
                lastCount = newCount;
            }

            scrollAttempts++;
        }

        return getReviewCount();
    }, maxReviews);
}

/**
 * Count the number of reviews currently loaded on the page
 * @param {Object} page - Puppeteer page
 * @returns {Promise<number>} - Number of reviews found
 */
async function countReviews(page) {
    return page.evaluate(() => {
        // Use the same selector as the tutorial
        const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium');
        if (reviews.length > 0) return reviews.length;
        
        // Fallbacks
        const byDataId = document.querySelectorAll('div[data-review-id]');
        if (byDataId.length > 0) return byDataId.length;
        
        const byClass = document.querySelectorAll('div.jftiEf');
        if (byClass.length > 0) return byClass.length;
        
        return 0;
    });
}

/**
 * Scroll the reviews panel to load more reviews
 * Uses the auto-scroll approach from the tutorial
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews needed
 * @param {Object} log - Logger instance (optional)
 * @returns {Object} - Scroll count and whether end was reached
 */
export async function scrollReviewsPanel(page, maxReviews, log = console) {
    log.info?.(`📜 Starting review scroll (target: ${maxReviews === Infinity ? 'unlimited' : maxReviews})`);
    
    // Get initial count
    const initialCount = await countReviews(page);
    log.info?.(`📜 Initial review count: ${initialCount}`);
    
    // If we already have enough reviews, return early
    if (initialCount >= maxReviews) {
        log.info?.(`📜 Already have ${initialCount} reviews (target: ${maxReviews})`);
        return { scrollCount: 0, reachedEnd: false, reviewsLoaded: initialCount };
    }
    
    // Run the auto-scroll function inside the browser
    // This is the key change - everything happens in browser context like the tutorial
    log.info?.(`📜 Starting auto-scroll in browser context...`);
    const totalReviews = await autoScrollInBrowser(page, maxReviews);
    
    log.info?.(`📜 Auto-scroll complete. Loaded ${totalReviews} reviews`);
    
    // Additional fallback: if auto-scroll didn't work well, try manual scrolling
    if (totalReviews < maxReviews && totalReviews < 50) {
        log.info?.(`📜 Attempting fallback scroll methods...`);
        
        // Try mouse wheel scrolling as fallback
        for (let attempt = 0; attempt < 20; attempt++) {
            const reviewElement = await page.$('.jftiEf.fontBodyMedium') || 
                                 await page.$('div[data-review-id]');
            
            if (reviewElement) {
                const box = await reviewElement.boundingBox();
                if (box) {
                    // Move to middle of reviews area
                    await page.mouse.move(box.x + 100, box.y + 200);
                    
                    // Scroll with mouse wheel
                    for (let i = 0; i < 5; i++) {
                        await page.mouse.wheel({ deltaY: 1000 });
                        await randomDelay(300, 500);
                    }
                }
            }
            
            await randomDelay(1500, 2000);
            
            const newCount = await countReviews(page);
            if (newCount >= maxReviews || newCount === totalReviews) {
                break;
            }
            
            if (attempt % 5 === 0) {
                log.info?.(`📜 Fallback scroll attempt ${attempt}: ${newCount} reviews`);
            }
        }
    }
    
    const finalCount = await countReviews(page);
    log.info?.(`📜 Finished scrolling. Total reviews loaded: ${finalCount}`);
    
    return { 
        scrollCount: 0, 
        reachedEnd: finalCount < maxReviews, 
        reviewsLoaded: finalCount 
    };
}

