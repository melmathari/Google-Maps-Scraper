import { randomDelay } from './utils.js';

/**
 * Count reviews by data-review-id only
 * This matches what we actually extract, ensuring scroll loads enough
 * @param {Object} page - Puppeteer page
 * @returns {Promise<number>} - Number of reviews found
 */
async function countReviews(page) {
    return page.evaluate(() => {
        // Count UNIQUE review IDs (multiple elements share the same ID - container + share button)
        const elements = document.querySelectorAll('[data-review-id]');
        const uniqueIds = new Set();
        for (const el of elements) {
            uniqueIds.add(el.getAttribute('data-review-id'));
        }
        return uniqueIds.size;
    });
}

/**
 * Get the last review element on the page
 * @param {Object} page - Puppeteer page
 * @returns {Promise<ElementHandle|null>} - Last review element or null
 */
async function getLastReviewElement(page) {
    const lastReview = await page.evaluateHandle(() => {
        // Get unique review IDs and find the last review container
        const elements = document.querySelectorAll('[data-review-id]');
        const seenIds = new Set();
        let lastContainer = null;
        
        for (const el of elements) {
            const id = el.getAttribute('data-review-id');
            if (!seenIds.has(id)) {
                seenIds.add(id);
                // The container is the larger element, not a button
                if (el.tagName !== 'BUTTON') {
                    lastContainer = el;
                }
            }
        }
        
        return lastContainer;
    });
    
    const isValidElement = await page.evaluate((el) => el !== null && el !== undefined, lastReview);
    return isValidElement ? lastReview : null;
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
    
    let initialCount = await countReviews(page);
    log.info?.(`📜 Initial review count: ${initialCount}`);
    
    // If no reviews found initially, wait for them to load
    // On Apify/proxies, reviews can take several seconds to appear after clicking the tab
    if (initialCount === 0) {
        log.info?.(`📜 Waiting for reviews to load (cloud mode - extended wait)...`);
        
        // DEBUG: Log what we see on the page
        const pageDebug = await page.evaluate(() => {
            return {
                url: window.location.href,
                hasReviewPanel: !!document.querySelector('[role="tabpanel"]'),
                allDataReviewIds: document.querySelectorAll('[data-review-id]').length,
                starElements: document.querySelectorAll('span[role="img"][aria-label*="star"]').length,
                scrollableContainers: document.querySelectorAll('[style*="overflow"]').length
            };
        });
        log.info?.(`📊 Page debug: ${JSON.stringify(pageDebug)}`);
        
        // Try multiple times with increasing delays (extended for cloud)
        for (let waitAttempt = 0; waitAttempt < 8; waitAttempt++) {
            await randomDelay(3000, 4000);
            
            // Try to trigger loading by scrolling the reviews container
            await page.evaluate(() => {
                // Find any scrollable container that might contain reviews
                const containers = document.querySelectorAll('[role="main"], [role="region"], [tabindex="0"], [role="tabpanel"]');
                for (const container of containers) {
                    if (container.scrollHeight > container.clientHeight) {
                        // Small scroll to trigger lazy loading
                        container.scrollTop = 50;
                        container.scrollTop = 0;
                    }
                }
                
                // Also try scrolling by finding elements with specific classes
                const scrollables = document.querySelectorAll('div[style*="overflow"]');
                for (const el of scrollables) {
                    if (el.scrollHeight > el.clientHeight + 50) {
                        el.scrollTop = 50;
                        el.scrollTop = 0;
                    }
                }
            });
            
            initialCount = await countReviews(page);
            if (initialCount > 0) {
                log.info?.(`📜 Reviews loaded after wait: ${initialCount}`);
                break;
            }
            
            log.info?.(`📜 Still waiting for reviews (attempt ${waitAttempt + 1}/8)...`);
        }
        
        // If still no reviews, the panel may not have opened correctly
        if (initialCount === 0) {
            log.warning?.(`📜 No reviews found after waiting. Reviews panel may not have loaded.`);
            
            // Final debug: check if we're on a restricted/bot-blocked page
            const finalDebug = await page.evaluate(() => {
                const bodyText = document.body?.innerText || '';
                return {
                    hasUnusualTraffic: bodyText.toLowerCase().includes('unusual traffic'),
                    hasConsent: bodyText.toLowerCase().includes('consent') || bodyText.toLowerCase().includes('cookie'),
                    pageTitle: document.title,
                    bodyPreview: bodyText.substring(0, 300)
                };
            });
            log.warning?.(`📊 Final page state: ${JSON.stringify(finalDebug)}`);
            
            return { scrollCount: 0, reachedEnd: true, reviewsLoaded: 0 };
        }
    }
    
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
