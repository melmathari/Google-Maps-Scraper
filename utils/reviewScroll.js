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
            // IMPORTANT: The reviews panel is a specific scrollable container
            // It's typically a div with overflow-y: auto/scroll that contains the reviews
            
            // Method 0: Use the exact XPath (most reliable)
            const reviewsXPath = '/html/body/div[1]/div[2]/div[9]/div[9]/div/div/div[1]/div[3]/div/div[1]/div/div/div[3]';
            const xpathResult = document.evaluate(reviewsXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const xpathContainer = xpathResult.singleNodeValue;
            
            if (xpathContainer && xpathContainer.scrollHeight > xpathContainer.clientHeight) {
                const prevTop = xpathContainer.scrollTop;
                xpathContainer.scrollTop = xpathContainer.scrollHeight;
                return { 
                    height: xpathContainer.scrollHeight, 
                    found: true, 
                    scrolled: xpathContainer.scrollTop > prevTop,
                    method: 'xpath-exact'
                };
            }
            
            // Method 0b: Try variations of the XPath (Google sometimes changes the structure slightly)
            const xpathVariations = [
                '/html/body/div[1]/div[2]/div[9]/div[9]/div/div/div[1]/div[3]/div/div[1]/div/div/div[3]',
                '/html/body/div[2]/div[9]/div[9]/div/div/div[1]/div[3]/div/div[1]/div/div/div[3]',
                '//div[@role="main"]//div[contains(@class, "m6QErb")]',
                '//div[contains(@class, "DxyBCb") and contains(@class, "kA9KIf")]',
            ];
            
            for (const xpath of xpathVariations) {
                try {
                    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    const container = result.singleNodeValue;
                    if (container && container.scrollHeight > container.clientHeight + 50) {
                        const prevTop = container.scrollTop;
                        container.scrollTop = container.scrollHeight;
                        return { 
                            height: container.scrollHeight, 
                            found: true, 
                            scrolled: container.scrollTop > prevTop,
                            method: 'xpath-variation'
                        };
                    }
                } catch (e) {
                    // XPath evaluation failed, try next
                }
            }
            
            // Method 1: Find the scrollable parent of review elements
            const reviewElement = document.querySelector('[data-review-id]') || 
                                 document.querySelector('div.jftiEf') ||
                                 document.querySelector('button[aria-label^="Photo of"]');
            
            if (reviewElement) {
                // Walk up the DOM to find the scrollable parent
                let parent = reviewElement.parentElement;
                for (let i = 0; i < 10 && parent; i++) {
                    const style = window.getComputedStyle(parent);
                    const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                        parent.scrollHeight > parent.clientHeight + 50;
                    if (isScrollable) {
                        const prevTop = parent.scrollTop;
                        parent.scrollTop = parent.scrollHeight;
                        return { 
                            height: parent.scrollHeight, 
                            found: true, 
                            scrolled: parent.scrollTop > prevTop,
                            method: 'parent-walk'
                        };
                    }
                    parent = parent.parentElement;
                }
            }
            
            // Method 2: Find scrollable container by specific Google Maps classes/attributes
            const containerSelectors = [
                'div.m6QErb.DxyBCb.kA9KIf.dS8AEf',  // Common Google Maps review container
                'div.m6QErb.DxyBCb',                  // Alternative
                'div.m6QErb[aria-label]',             // With aria-label
                'div[role="main"] div.m6QErb',        // Inside main
                '.section-layout.section-scrollbox',  // Legacy
            ];
            
            for (const selector of containerSelectors) {
                const container = document.querySelector(selector);
                if (container && container.scrollHeight > container.clientHeight + 50) {
                    const prevTop = container.scrollTop;
                    container.scrollTop = container.scrollHeight;
                    return { 
                        height: container.scrollHeight, 
                        found: true, 
                        scrolled: container.scrollTop > prevTop,
                        method: 'selector-' + selector.substring(0, 20)
                    };
                }
            }
            
            // Method 3: Find any scrollable div that contains reviews
            const allDivs = document.querySelectorAll('div');
            for (const div of allDivs) {
                const style = window.getComputedStyle(div);
                const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                    div.scrollHeight > div.clientHeight + 100;
                
                if (isScrollable && div.scrollHeight > 500) {
                    // Check if this container has reviews inside
                    const reviewCount = div.querySelectorAll('[data-review-id]').length;
                    if (reviewCount > 0) {
                        const prevTop = div.scrollTop;
                        div.scrollTop = div.scrollHeight;
                        return { 
                            height: div.scrollHeight, 
                            found: true, 
                            scrolled: div.scrollTop > prevTop,
                            method: 'generic-with-reviews'
                        };
                    }
                }
            }
            
            // Method 4: Last resort - scroll any large scrollable div in main content
            const mainContent = document.querySelector('[role="main"]');
            if (mainContent) {
                const scrollableDivs = mainContent.querySelectorAll('div');
                for (const div of scrollableDivs) {
                    const style = window.getComputedStyle(div);
                    const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                        div.scrollHeight > div.clientHeight + 50;
                    if (isScrollable && div.scrollHeight > 400) {
                        const prevTop = div.scrollTop;
                        div.scrollTop = div.scrollHeight;
                        return { 
                            height: div.scrollHeight, 
                            found: true, 
                            scrolled: div.scrollTop > prevTop,
                            method: 'main-content-div'
                        };
                    }
                }
            }
            
            return { height: 0, found: false, scrolled: false, method: 'none' };
        });

        // Log scroll result for debugging
        if (scrollResult.found) {
            log.debug?.(`📜 Scrolled using method: ${scrollResult.method}, scrolled: ${scrollResult.scrolled}`);
        } else {
            log.warning?.(`📜 Could not find scrollable container for reviews`);
        }

        // Wait longer for Google Maps to load more reviews (it can be slow)
        await randomDelay(2000, 3500);

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

