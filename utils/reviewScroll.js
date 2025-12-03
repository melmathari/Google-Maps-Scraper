import { randomDelay } from './utils.js';

/**
 * Auto-scroll function that runs entirely inside the browser context
 * Based on the official tutorial approach - everything runs inside page.evaluate
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews to load
 * @returns {Promise<number>} - Number of reviews loaded
 */
async function autoScrollInBrowser(page, maxReviews) {
    return page.evaluate(async (targetReviews) => {
        // Helper function to find the scrollable element - exact approach from tutorial
        async function getScrollableElement() {
            // Primary selectors from tutorial
            const selectors = [
                '.DxyBCb [role="main"]',
                '.WNBkOb [role="main"]',
                '.review-dialog-list',
                '.section-layout-root',
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    console.log(`Found scrollable element with selector: ${selector}`);
                    return element;
                }
            }

            // Fallback: find any scrollable container with reviews (from tutorial)
            const possibleContainers = document.querySelectorAll('div');
            for (const container of possibleContainers) {
                if (
                    container.scrollHeight > container.clientHeight &&
                    container.querySelector('.jftiEf.fontBodyMedium')
                ) {
                    console.log('Found scrollable container via fallback (contains reviews)');
                    return container;
                }
            }

            // Additional fallback: look for m6QErb class containers (common in Google Maps)
            const m6QErbContainers = document.querySelectorAll('.m6QErb');
            for (const container of m6QErbContainers) {
                if (container.scrollHeight > container.clientHeight) {
                    console.log('Found scrollable m6QErb container');
                    return container;
                }
            }

            return null;
        }

        // Count reviews using the tutorial's selector
        const getScrollHeight = () => {
            const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium');
            return reviews.length;
        };

        const scrollable = await getScrollableElement();
        if (!scrollable) {
            console.error('Could not find scrollable container');
            // Debug: log what containers exist
            const allContainers = document.querySelectorAll('div[class*="m6QErb"], div[class*="DxyBCb"], div[role="main"]');
            console.log(`Found ${allContainers.length} potential containers`);
            return getScrollHeight(); // Return current count even if can't scroll
        }

        console.log(`Scrollable container: scrollHeight=${scrollable.scrollHeight}, clientHeight=${scrollable.clientHeight}`);

        let lastHeight = getScrollHeight();
        let noChangeCount = 0;
        const maxTries = 10; // Match tutorial's value

        while (noChangeCount < maxTries) {
            // Check if we've reached our target
            const currentCount = getScrollHeight();
            if (targetReviews !== Infinity && currentCount >= targetReviews) {
                console.log(`Reached target of ${targetReviews} reviews`);
                return currentCount;
            }

            // Scroll to bottom of the container (exact approach from tutorial)
            if (scrollable.scrollTo) {
                scrollable.scrollTo(0, scrollable.scrollHeight);
            } else {
                scrollable.scrollTop = scrollable.scrollHeight;
            }

            // Wait for new content to load (2 seconds as in tutorial)
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const newHeight = getScrollHeight();
            console.log(`Scroll attempt: ${newHeight} reviews (was ${lastHeight})`);
            
            if (newHeight === lastHeight) {
                noChangeCount++;
                console.log(`No new reviews loaded (attempt ${noChangeCount}/${maxTries})`);
            } else {
                noChangeCount = 0;
                lastHeight = newHeight;
            }
        }

        console.log(`Finished scrolling: ${getScrollHeight()} total reviews`);
        return getScrollHeight();
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
    
    // Additional fallback: if auto-scroll didn't work well, try alternative methods
    if (totalReviews < maxReviews && totalReviews < 50) {
        log.info?.(`📜 Attempting fallback scroll methods...`);
        
        // Fallback 1: Try keyboard-based scrolling (Page Down)
        for (let attempt = 0; attempt < 10; attempt++) {
            // Focus on the reviews area first
            await page.evaluate(() => {
                const reviewContainer = document.querySelector('.m6QErb') || 
                                       document.querySelector('[role="main"]') ||
                                       document.querySelector('.DxyBCb');
                if (reviewContainer) {
                    reviewContainer.focus();
                }
            });
            
            // Press Page Down multiple times
            for (let i = 0; i < 3; i++) {
                await page.keyboard.press('PageDown');
                await randomDelay(500, 800);
            }
            
            await randomDelay(1500, 2000);
            
            const newCount = await countReviews(page);
            if (newCount >= maxReviews) {
                log.info?.(`📜 Keyboard scroll loaded ${newCount} reviews`);
                break;
            }
            
            // Also try direct scroll via evaluate
            await page.evaluate(() => {
                const containers = document.querySelectorAll('.m6QErb, [role="main"], .DxyBCb');
                for (const container of containers) {
                    if (container.scrollHeight > container.clientHeight) {
                        container.scrollTop = container.scrollHeight;
                    }
                }
            });
            
            await randomDelay(1000, 1500);
        }
        
        // Fallback 2: Try mouse wheel scrolling
        const reviewElement = await page.$('.jftiEf.fontBodyMedium') || 
                             await page.$('div[data-review-id]') ||
                             await page.$('.m6QErb');
        
        if (reviewElement) {
            const box = await reviewElement.boundingBox();
            if (box) {
                // Move to middle of reviews area
                await page.mouse.move(box.x + 100, box.y + 200);
                
                for (let attempt = 0; attempt < 15; attempt++) {
                    // Scroll with mouse wheel
                    for (let i = 0; i < 5; i++) {
                        await page.mouse.wheel({ deltaY: 800 });
                        await randomDelay(200, 400);
                    }
                    
                    await randomDelay(1500, 2000);
                    
                    const newCount = await countReviews(page);
                    if (newCount >= maxReviews) {
                        log.info?.(`📜 Mouse wheel scroll loaded ${newCount} reviews`);
                        break;
                    }
                    
                    if (attempt % 5 === 0) {
                        log.info?.(`📜 Fallback scroll attempt ${attempt}: ${newCount} reviews`);
                    }
                }
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

