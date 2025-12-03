import { randomDelay } from './utils.js';

/**
 * Find the scrollable container for reviews in Google Maps
 * Uses multiple selectors as Google changes the DOM structure frequently
 * @param {Object} page - Puppeteer page
 * @returns {Promise<boolean>} - Whether a scrollable element was found
 */
async function findAndScrollReviewsContainer(page) {
    return page.evaluate(async () => {
        // Helper function to find the scrollable element
        async function getScrollableElement() {
            // Primary selectors used by Google Maps for the reviews panel
            const selectors = [
                '.DxyBCb [role="main"]',           // Reviews panel in main view
                '.WNBkOb [role="main"]',           // Alternative main container
                '.review-dialog-list',             // Review dialog list
                '.section-layout-root',            // Section layout
                '[role="main"]',                   // Generic main role
                '.m6QErb[aria-label]',             // Scrollable list with aria-label
                '.m6QErb.DxyBCb',                  // Another common container
                'div[tabindex="-1"][class*="m6QErb"]', // Focusable scrollable div
            ];

            // Try each selector
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.scrollHeight > element.clientHeight) {
                    return element;
                }
            }

            // Fallback: Find any scrollable container that contains reviews
            const possibleContainers = document.querySelectorAll('div');
            for (const container of possibleContainers) {
                // Check if container is scrollable and contains review elements
                if (container.scrollHeight > container.clientHeight &&
                    (container.querySelector('.jftiEf') || 
                     container.querySelector('div[data-review-id]') ||
                     container.querySelector('button[aria-label^="Photo of"]'))) {
                    return container;
                }
            }

            return null;
        }

        const scrollable = await getScrollableElement();
        if (!scrollable) {
            return { success: false, message: 'Could not find scrollable container' };
        }

        // Perform the scroll
        if (scrollable.scrollTo) {
            scrollable.scrollTo(0, scrollable.scrollHeight);
        } else {
            scrollable.scrollTop = scrollable.scrollHeight;
        }

        return { success: true, scrollHeight: scrollable.scrollHeight };
    });
}

/**
 * Count the number of reviews currently loaded on the page
 * @param {Object} page - Puppeteer page
 * @returns {Promise<number>} - Number of reviews found
 */
async function countReviews(page) {
    return page.evaluate(() => {
        // Primary: data-review-id attribute (most reliable)
        const byDataId = document.querySelectorAll('div[data-review-id]');
        if (byDataId.length > 0) return byDataId.length;
        
        // Fallback: jftiEf class (common review container class)
        const byClass = document.querySelectorAll('div.jftiEf.fontBodyMedium');
        if (byClass.length > 0) return byClass.length;
        
        // Fallback: jftiEf without fontBodyMedium
        const byClassAlt = document.querySelectorAll('div.jftiEf');
        if (byClassAlt.length > 0) return byClassAlt.length;
        
        // Fallback: Find by "Photo of" buttons (each review has one)
        const photoButtons = document.querySelectorAll('button[aria-label^="Photo of"]');
        if (photoButtons.length > 0) return photoButtons.length;
        
        return 0;
    });
}

/**
 * Scroll the reviews panel to load more reviews
 * Uses the auto-scroll approach similar to the tutorial
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews needed
 * @param {Object} log - Logger instance (optional)
 * @returns {Object} - Scroll count and whether end was reached
 */
export async function scrollReviewsPanel(page, maxReviews, log = console) {
    // Calculate max scrolls based on reviews needed
    // Each scroll loads approximately 3-5 reviews
    const maxScrolls = Math.min(300, Math.max(10, Math.ceil(maxReviews / 3) + 20));
    const maxNoChangeAttempts = 10; // How many times to try before giving up
    
    let scrollCount = 0;
    let previousCount = 0;
    let noChangeCount = 0;

    log.info?.(`📜 Starting review scroll (target: ${maxReviews === Infinity ? 'unlimited' : maxReviews}, max scrolls: ${maxScrolls})`);

    while (scrollCount < maxScrolls && noChangeCount < maxNoChangeAttempts) {
        // Count current reviews
        const currentReviewCount = await countReviews(page);

        // If we have enough reviews, stop scrolling early
        if (currentReviewCount >= maxReviews) {
            log.info?.(`📜 Loaded ${currentReviewCount} reviews (target reached)`);
            return { scrollCount, reachedEnd: false, reviewsLoaded: currentReviewCount };
        }

        // Try to scroll using the container scroll method (most reliable)
        const scrollResult = await findAndScrollReviewsContainer(page);
        
        if (!scrollResult.success) {
            log.debug?.(`📜 Container scroll failed, trying fallback methods...`);
            
            // Fallback 1: Try mouse wheel scrolling on a review element
            const reviewElement = await page.$('div[data-review-id]') || 
                                 await page.$('div.jftiEf') ||
                                 await page.$('button[aria-label^="Photo of"]');
            
            if (reviewElement) {
                const box = await reviewElement.boundingBox();
                if (box) {
                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                    for (let i = 0; i < 5; i++) {
                        await page.mouse.wheel({ deltaY: 800 });
                        await randomDelay(200, 400);
                    }
                }
            } else {
                // Fallback 2: Try keyboard navigation
                const mainPanel = await page.$('[role="main"]');
                if (mainPanel) {
                    await mainPanel.click();
                    for (let i = 0; i < 3; i++) {
                        await page.keyboard.press('PageDown');
                        await randomDelay(200, 300);
                    }
                }
            }
        }

        // Wait for Google Maps to load more reviews (lazy loading needs time)
        await randomDelay(1500, 2500);

        // Get updated review count
        const newReviewCount = await countReviews(page);
        
        // Log progress every 10 scrolls or when count changes significantly
        if (scrollCount % 10 === 0 || newReviewCount - currentReviewCount > 5) {
            log.info?.(`📜 Scroll ${scrollCount}: ${newReviewCount} reviews loaded`);
        }

        // Check if review count changed
        if (newReviewCount === previousCount) {
            noChangeCount++;
            log.debug?.(`📜 No new reviews loaded (attempt ${noChangeCount}/${maxNoChangeAttempts})`);
            
            // Wait longer and try more aggressive scrolling
            await randomDelay(2000, 3000);
            
            // Try clicking "More reviews" button if it exists
            const clickedMore = await page.evaluate(() => {
                const moreBtn = document.querySelector('button[aria-label*="More reviews"]');
                if (moreBtn && !moreBtn.disabled) {
                    moreBtn.click();
                    return true;
                }
                return false;
            });
            
            if (clickedMore) {
                log.debug?.(`📜 Clicked "More reviews" button`);
                await randomDelay(2000, 3000);
                noChangeCount = 0; // Reset counter since we took an action
            }
        } else {
            noChangeCount = 0;
            log.debug?.(`📜 Loaded ${newReviewCount} reviews so far...`);
        }

        previousCount = newReviewCount;
        scrollCount++;
    }

    // Final count
    const finalCount = await countReviews(page);
    
    if (noChangeCount >= maxNoChangeAttempts) {
        log.info?.(`📜 Reached end of reviews (no new reviews after ${maxNoChangeAttempts} attempts, ${finalCount} total)`);
        return { scrollCount, reachedEnd: true, reviewsLoaded: finalCount };
    }
    
    log.info?.(`📜 Finished scrolling reviews (${finalCount} loaded, ${scrollCount} scrolls)`);
    return { scrollCount, reachedEnd: false, reviewsLoaded: finalCount };
}

