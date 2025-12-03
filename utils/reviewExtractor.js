import { randomDelay } from './utils.js';
import { scrollReviewsPanel } from './reviewScroll.js';
import { Actor } from 'apify';

/**
 * Extract reviews for a business by clicking on its listing to open the sidebar
 * @param {Object} page - Puppeteer page
 * @param {Object} business - Business object with url and name
 * @param {number} maxReviews - Maximum reviews to extract (0 or Infinity for unlimited)
 * @param {boolean} extractShareLinks - Whether to extract share links for reviews
 * @param {Object} log - Logger instance
 * @returns {Array} Array of review objects
 */
export async function extractReviewsFromListing(page, business, maxReviews, extractShareLinks = false, log = console) {
    const isUnlimited = maxReviews === 0 || maxReviews === Infinity || maxReviews === null || maxReviews === undefined;
    const targetReviews = isUnlimited ? Infinity : maxReviews;
    
    try {
        // Check for Google bot detection / unusual traffic page
        const isBotBlocked = await page.evaluate(() => {
            const bodyText = document.body?.innerText?.toLowerCase() || '';
            return bodyText.includes('unusual traffic') || 
                   bodyText.includes('captcha') ||
                   bodyText.includes('are you a robot') ||
                   bodyText.includes('automated queries');
        });
        
        if (isBotBlocked) {
            log.error('⚠️ Google bot detection triggered! The page shows unusual traffic warning.');
            log.error('Try using RESIDENTIAL proxies or reducing request rate.');
            return [];
        }
        
        // Click on the listing to open the sidebar
        const clicked = await clickOnListing(page, business, log);
        if (!clicked) {
            log.warning(`Could not click on listing for: ${business.name}`);
            return [];
        }
        
        // Increased delay for cloud environments
        await randomDelay(3000, 5000);
        
        // Wait for the sidebar to load
        await waitForSidebar(page, log);
        
        // Click on Reviews tab to open reviews panel
        const reviewsOpened = await clickReviewsTab(page, log);
        if (!reviewsOpened) {
            log.warning(`Could not open reviews tab for: ${business.name}`);
            await closeSidebar(page, log);
            return [];
        }
        await randomDelay(2000, 3000);
        
        // Scroll to load more reviews
        log.info(`📜 Loading reviews (target: ${isUnlimited ? 'unlimited' : targetReviews})...`);
        await scrollReviewsPanel(page, targetReviews, log);
        
        // Extract reviews
        const reviews = await extractReviewsFromPage(page, targetReviews, log);
        log.info(`✓ Found ${reviews.length} reviews`);
        
        // Extract share links if requested
        if (extractShareLinks && reviews.length > 0) {
            log.info('🔗 Extracting share links...');
            await extractShareLinksForReviews(page, reviews, log);
        }
        
        // Close the sidebar/go back to listings
        await closeSidebar(page, log);
        await randomDelay(1000, 2000);
        
        return reviews;
        
    } catch (error) {
        log.error(`Error extracting reviews: ${error.message}`);
        // Try to close sidebar before returning
        try {
            await closeSidebar(page, log);
        } catch (e) {
            // Ignore close errors
        }
        return [];
    }
}

/**
 * Click on a listing in the search results to open its sidebar
 */
async function clickOnListing(page, business, log) {
    try {
        // First, ensure we're back on the listings view
        const onListingsPage = await page.evaluate(() => {
            const feed = document.querySelector('[role="feed"]');
            const articles = document.querySelectorAll('div[role="article"]');
            return feed || articles.length > 0;
        });
        
        if (!onListingsPage) {
            log.warning('Not on listings page, trying to navigate back...');
            await page.keyboard.press('Escape');
            await randomDelay(1000, 1500);
        }
        
        const clicked = await page.evaluate((businessUrl, businessName) => {
            const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normalizedName = normalize(businessName);
            
            const links = document.querySelectorAll('a[href*="/maps/place/"]');
            for (const link of links) {
                if (link.href === businessUrl) {
                    link.click();
                    return 'url-exact';
                }
            }
            
            for (const link of links) {
                const urlMatch = link.href.match(/\/maps\/place\/([^/]+)/);
                if (urlMatch) {
                    const urlPlaceName = normalize(decodeURIComponent(urlMatch[1]).replace(/\+/g, ' '));
                    if (urlPlaceName.includes(normalizedName) || normalizedName.includes(urlPlaceName)) {
                        link.click();
                        return 'url-partial';
                    }
                }
            }
            
            const articles = document.querySelectorAll('div[role="article"]');
            for (const article of articles) {
                const ariaLabel = article.getAttribute('aria-label') || '';
                if (normalize(ariaLabel).includes(normalizedName) || normalizedName.includes(normalize(ariaLabel))) {
                    const link = article.querySelector('a[href*="/maps/place/"]');
                    if (link) {
                        link.click();
                        return 'article-aria';
                    }
                    article.click();
                    return 'article-click';
                }
            }
            
            for (const link of links) {
                const linkText = link.textContent || link.getAttribute('aria-label') || '';
                if (normalize(linkText).includes(normalizedName) || normalizedName.includes(normalize(linkText))) {
                    link.click();
                    return 'link-text';
                }
            }
            
            return false;
        }, business.url, business.name);
        
        if (clicked) {
            log.debug(`Clicked on listing using method: ${clicked}`);
        }
        
        return !!clicked;
    } catch (error) {
        log.warning(`Error clicking on listing: ${error.message}`);
        return false;
    }
}

/**
 * Wait for the business sidebar to load
 */
async function waitForSidebar(page, log) {
    try {
        await page.waitForFunction(() => {
            const h1 = document.querySelector('h1');
            const tabs = document.querySelectorAll('[role="tab"]');
            return h1 || tabs.length > 0;
        }, { timeout: 15000 });
    } catch (error) {
        log.warning(`Sidebar may not have loaded fully: ${error.message}`);
    }
}

/**
 * Click on the Reviews tab to open the reviews panel
 */
async function clickReviewsTab(page, log) {
    try {
        // First, wait for the Reviews tab/button to appear
        // On Apify/proxies, this can take several seconds after the sidebar loads
        log.info('⏳ Waiting for Reviews tab to appear...');
        
        // DEBUG: Log what we see on the page
        const pageState = await page.evaluate(() => {
            const tabs = document.querySelectorAll('[role="tab"]');
            const buttons = document.querySelectorAll('button');
            const tabInfo = Array.from(tabs).map(t => ({
                text: t.textContent?.substring(0, 50),
                aria: t.getAttribute('aria-label')
            }));
            const buttonInfo = Array.from(buttons).slice(0, 10).map(b => ({
                text: b.textContent?.substring(0, 50),
                aria: b.getAttribute('aria-label')
            }));
            return { 
                tabCount: tabs.length, 
                buttonCount: buttons.length,
                tabs: tabInfo,
                buttons: buttonInfo,
                h1: document.querySelector('h1')?.textContent
            };
        });
        log.info(`📊 Page state - H1: "${pageState.h1}", Tabs: ${pageState.tabCount}, Buttons: ${pageState.buttonCount}`);
        if (pageState.tabs.length > 0) {
            log.info(`📊 Available tabs: ${JSON.stringify(pageState.tabs)}`);
        }
        
        try {
            await page.waitForFunction(() => {
                // Check for tab with Reviews text
                const tabs = document.querySelectorAll('[role="tab"]');
                for (const tab of tabs) {
                    const ariaLabel = tab.getAttribute('aria-label') || '';
                    const textContent = tab.textContent || '';
                    if (ariaLabel.toLowerCase().includes('reviews') || textContent.toLowerCase().includes('reviews')) {
                        return true;
                    }
                }
                // Check for button with Reviews text
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const ariaLabel = btn.getAttribute('aria-label') || '';
                    const textContent = btn.textContent || '';
                    if (textContent.toLowerCase().includes('write')) continue;
                    if (ariaLabel.toLowerCase().includes('reviews') || 
                        textContent.toLowerCase().includes('reviews') ||
                        /\d+\s*reviews?/i.test(ariaLabel) || 
                        /\d+\s*reviews?/i.test(textContent)) {
                        return true;
                    }
                }
                return false;
            }, { timeout: 30000 }); // Increased timeout for cloud
            log.info('✓ Reviews tab found');
        } catch (waitError) {
            log.warning(`Reviews tab not found after waiting: ${waitError.message}`);
            
            // DEBUG: Take note of what's on the page when reviews tab isn't found
            const debugInfo = await page.evaluate(() => {
                return {
                    url: window.location.href,
                    title: document.title,
                    bodyText: document.body?.innerText?.substring(0, 500)
                };
            });
            log.warning(`Page debug: URL=${debugInfo.url}, Title=${debugInfo.title}`);
            log.warning(`Page content preview: ${debugInfo.bodyText?.substring(0, 200)}`);
            
            return false;
        }
        
        // Small delay to ensure element is clickable
        await randomDelay(500, 1000);
        
        const clicked = await page.evaluate(() => {
            // Method 1: Find tab with role="tab" containing "Reviews"
            const tabs = document.querySelectorAll('[role="tab"]');
            for (const tab of tabs) {
                const ariaLabel = tab.getAttribute('aria-label') || '';
                const textContent = tab.textContent || '';
                if (ariaLabel.toLowerCase().includes('reviews') || textContent.toLowerCase().includes('reviews')) {
                    tab.click();
                    return 'tab-role';
                }
            }
            
            // Method 2: Look for buttons containing "Reviews"
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const textContent = btn.textContent || '';
                if (textContent.toLowerCase().includes('write')) continue;
                
                if (ariaLabel.toLowerCase().includes('reviews') || 
                    (textContent.toLowerCase().includes('reviews') && !textContent.toLowerCase().includes('more reviews'))) {
                    btn.click();
                    return 'button-reviews';
                }
            }
            
            // Method 3: Look for review count button (e.g., "333 reviews")
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const textContent = btn.textContent || '';
                if (/\d+\s*reviews?/i.test(ariaLabel) || /\d+\s*reviews?/i.test(textContent)) {
                    btn.click();
                    return 'review-count';
                }
            }
            
            return false;
        });
        
        if (clicked) {
            log.info(`✓ Clicked reviews panel (method: ${clicked})`);
            
            // Wait for reviews panel to fully load - try multiple selectors
            // The reviews panel needs time to render, especially on slower connections/proxies
            let reviewsLoaded = false;
            const reviewSelectors = [
                'div[data-review-id]',
                'button[aria-label^="Photo of"]',
                'span[role="img"][aria-label*="star"]',
                '.jftiEf.fontBodyMedium'
            ];
            
            // First wait - longer timeout for initial load (increased for cloud)
            for (const selector of reviewSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 20000 });
                    reviewsLoaded = true;
                    log.info(`✓ Reviews panel loaded (selector: ${selector.substring(0, 30)}...)`);
                    
                    // DEBUG: Take screenshot when reviews panel loads
                    try {
                        const screenshot1 = await page.screenshot({ fullPage: false });
                        const kvStore = await Actor.openKeyValueStore();
                        await kvStore.setValue(`debug-reviews-panel-loaded-${Date.now()}`, screenshot1, { contentType: 'image/png' });
                        log.info('📸 Screenshot saved: reviews-panel-loaded');
                    } catch (ssError) {
                        log.warning(`Could not save screenshot: ${ssError.message}`);
                    }
                    
                    break;
                } catch (e) {
                    // Continue to next selector
                }
            }
            
            // If reviews didn't load, try scrolling the page to trigger lazy loading
            if (!reviewsLoaded) {
                log.info('⏳ Reviews not immediately visible, attempting to trigger load...');
                
                // Try clicking on the reviews area or scrolling to trigger loading
                await page.evaluate(() => {
                    // Look for any scrollable container that might contain reviews
                    const scrollables = document.querySelectorAll('[role="main"], [role="region"], [tabindex="0"]');
                    for (const el of scrollables) {
                        if (el.scrollHeight > el.clientHeight) {
                            // Scroll down a bit to trigger lazy loading
                            el.scrollTop = 100;
                            el.scrollTop = 0;
                        }
                    }
                    
                    // Also try keyboard navigation to ensure focus
                    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
                });
                
                await randomDelay(3000, 4000);
                
                // Check again for reviews
                for (const selector of reviewSelectors) {
                    try {
                        await page.waitForSelector(selector, { timeout: 10000 });
                        reviewsLoaded = true;
                        log.info(`✓ Reviews loaded after scroll trigger (selector: ${selector.substring(0, 30)}...)`);
                        break;
                    } catch (e) {
                        // Continue
                    }
                }
            }
            
            // Final check - see if we have any reviews at all
            if (!reviewsLoaded) {
                const reviewCount = await page.evaluate(() => {
                    return document.querySelectorAll('[data-review-id]').length;
                });
                
                if (reviewCount === 0) {
                    log.warning('⚠️ No reviews found after waiting. Reviews panel may not have loaded correctly.');
                    // Don't return false - let the scroll function try to load reviews
                }
            }
            
            // Wait for all initial reviews to render (Google loads ~10 by default)
            // On slower connections/proxies, reviews render progressively
            log.info('⏳ Waiting for initial reviews to fully render...');
            let lastReviewCount = 0;
            let stableCount = 0;
            
            for (let i = 0; i < 10; i++) {
                await randomDelay(800, 1200);
                
                const currentReviewCount = await page.evaluate(() => {
                    const elements = document.querySelectorAll('[data-review-id]');
                    const uniqueIds = new Set();
                    for (const el of elements) {
                        uniqueIds.add(el.getAttribute('data-review-id'));
                    }
                    return uniqueIds.size;
                });
                
                if (currentReviewCount === lastReviewCount) {
                    stableCount++;
                    // If count is stable for 3 checks, reviews have finished loading
                    if (stableCount >= 3) {
                        log.info(`✓ Initial reviews stabilized at ${currentReviewCount}`);
                        
                        // DEBUG: Take screenshot when initial reviews have stabilized
                        try {
                            const screenshot2 = await page.screenshot({ fullPage: false });
                            const kvStore = await Actor.openKeyValueStore();
                            await kvStore.setValue(`debug-reviews-stabilized-${currentReviewCount}-${Date.now()}`, screenshot2, { contentType: 'image/png' });
                            log.info(`📸 Screenshot saved: reviews-stabilized-${currentReviewCount}`);
                        } catch (ssError) {
                            log.warning(`Could not save screenshot: ${ssError.message}`);
                        }
                        
                        break;
                    }
                } else {
                    log.debug?.(`Reviews rendering: ${currentReviewCount} (was ${lastReviewCount})`);
                    stableCount = 0;
                    lastReviewCount = currentReviewCount;
                }
            }
            
            await randomDelay(1000, 1500);
            return true;
        }
        
        log.warning('Could not find Reviews tab or button');
        return false;
    } catch (error) {
        log.warning(`Error clicking Reviews tab: ${error.message}`);
        return false;
    }
}


/**
 * Extract reviews from the current page using robust structural selectors
 * Avoids brittle CSS class names that Google changes frequently
 */
async function extractReviewsFromPage(page, maxReviews, log) {
    const reviews = await page.evaluate((max) => {
        const results = [];
        const processedReviewIds = new Set();
        
        // Simple approach: Find all reviews by data-review-id and extract them in order
        // This is the only reliable selector - no fallback methods needed
        const reviewContainers = document.querySelectorAll('[data-review-id]');
        
        for (const container of reviewContainers) {
            if (results.length >= max) break;
            
            const reviewId = container.getAttribute('data-review-id');
            
            // Skip if already processed (shouldn't happen, but just in case)
            if (processedReviewIds.has(reviewId)) continue;
            processedReviewIds.add(reviewId);
            
            const reviewData = extractDataFromContainer(container, results.length);
            if (reviewData && reviewData.rating >= 1 && reviewData.rating <= 5) {
                results.push(reviewData);
            }
        }
        
        return results;
        
        // Helper function to extract data from a review container
        function extractDataFromContainer(container, index) {
            try {
                // === STAR RATING ===
                let rating = null;
                const starEl = container.querySelector('span[role="img"][aria-label*="star"]');
                if (starEl) {
                    const ratingMatch = starEl.getAttribute('aria-label')?.match(/(\d+)\s*star/i);
                    if (ratingMatch) {
                        rating = parseInt(ratingMatch[1]);
                    }
                }
                
                // Skip if no valid rating found
                if (rating === null || rating < 1 || rating > 5) return null;
                
                // === REVIEWER NAME ===
                let reviewerName = null;
                
                // Try 1: Button with "Photo of X" aria-label (very reliable)
                const photoBtn = container.querySelector('button[aria-label^="Photo of"]');
                if (photoBtn) {
                    const label = photoBtn.getAttribute('aria-label');
                    reviewerName = label.replace('Photo of ', '').trim();
                }
                
                // Try 2: Link to contributor profile
                if (!reviewerName) {
                    const contribLink = container.querySelector('a[href*="/contrib/"]');
                    if (contribLink) {
                        // Get the text content or aria-label
                        reviewerName = contribLink.textContent?.trim() || 
                                      contribLink.getAttribute('aria-label')?.trim();
                    }
                }
                
                // Try 3: First anchor or button with non-empty text at top of container
                if (!reviewerName) {
                    const nameLinks = container.querySelectorAll('a, button');
                    for (const el of nameLinks) {
                        const text = el.textContent?.trim();
                        // Name should be short (not review text) and not a date
                        if (text && text.length > 1 && text.length < 50 && 
                            !text.match(/ago|review|star|helpful|like|share|more/i)) {
                            reviewerName = text;
                            break;
                        }
                    }
                }
                
                // Try 4: Look for spans/divs with short text before the star rating
                if (!reviewerName) {
                    const allText = container.querySelectorAll('span, div');
                    for (const el of allText) {
                        const text = el.textContent?.trim();
                        // Check if this looks like a name
                        if (text && text.length > 1 && text.length < 40 &&
                            !text.match(/(\d+\s*(star|review|ago|year|month|week|day|hour|minute))/i) &&
                            !text.includes('·') && !text.includes('|')) {
                            // Check if this element is before/near star rating
                            if (el.compareDocumentPosition && starEl && 
                                (el.compareDocumentPosition(starEl) & Node.DOCUMENT_POSITION_FOLLOWING)) {
                                reviewerName = text;
                                break;
                            }
                        }
                    }
                }
                
                if (!reviewerName) reviewerName = 'Unknown';
                
                // === REVIEWER SUBTITLE ===
                let reviewerSubtitle = null;
                // Look for text containing "Local Guide", "reviews", etc.
                const allSpans = container.querySelectorAll('span, div');
                for (const span of allSpans) {
                    const text = span.textContent?.trim();
                    if (text && (text.includes('Local Guide') || 
                                text.match(/\d+\s*reviews?/i) ||
                                text.includes('·'))) {
                        // Skip if it's the full inner text (too long)
                        if (text.length < 100) {
                            reviewerSubtitle = text;
                            break;
                        }
                    }
                }
                
                // === REVIEW DATE ===
                let reviewDate = null;
                const containerText = container.innerText || '';
                
                // Look for date patterns - these are essential for reviews
                const datePatterns = [
                    /(\d+\s*(year|month|week|day|hour|minute)s?\s*ago)/i,
                    /((a|an)\s+(year|month|week|day|hour|minute)\s*ago)/i,
                ];
                for (const pattern of datePatterns) {
                    const match = containerText.match(pattern);
                    if (match) {
                        reviewDate = match[0].trim();
                        break;
                    }
                }
                
                // Additional validation: Real reviews should have a date
                // Business listings won't have "X ago" dates
                // Check if this looks like a business listing based on subtitle content
                if (!reviewDate && reviewerSubtitle) {
                    // Business listing patterns: addresses, phone numbers, hours
                    const businessSubtitlePatterns = [
                        /\b(Open|Closes)\s*[·\d]/i,
                        /\d{2,3}\s+\d{3,4}\s+\d{4}/,  // Phone pattern
                        /\+\d{1,3}\s+\d{2,3}/,  // Intl phone
                        /·\s*\d+\s*[-–]\s*\d+\s/,  // Address numbers
                        /service\s*·/i,
                    ];
                    
                    for (const pattern of businessSubtitlePatterns) {
                        if (pattern.test(reviewerSubtitle)) {
                            // This is likely a business listing, not a review
                            return null;
                        }
                    }
                }
                
                // === REVIEW TEXT ===
                let reviewText = null;
                
                // Method 1: Find the longest text block that looks like a review
                const textElements = container.querySelectorAll('span, div');
                let longestText = '';
                
                for (const el of textElements) {
                    // Skip elements that contain child elements with substantial text
                    // (we want the innermost text container)
                    const hasTextChildren = Array.from(el.children).some(
                        child => child.textContent?.trim().length > 30
                    );
                    if (hasTextChildren) continue;
                    
                    const text = el.textContent?.trim();
                    if (text && text.length > longestText.length && text.length > 20) {
                        // Skip if it looks like metadata
                        if (!text.match(/^(Local Guide|·|\d+\s*(reviews?|star|ago|year|month|week|day))/i)) {
                            // Check this isn't the reviewer name
                            if (text !== reviewerName && !text.includes(reviewerName)) {
                                longestText = text;
                            }
                        }
                    }
                }
                
                // Clean up the review text
                if (longestText.length > 20) {
                    reviewText = longestText;
                    // Remove date from end if present
                    for (const pattern of datePatterns) {
                        reviewText = reviewText.replace(pattern, '').trim();
                    }
                    // Remove "More" button text if present
                    reviewText = reviewText.replace(/\s*More\s*$/i, '').trim();
                }
                
                // === LIKES COUNT ===
                let likesCount = null;
                // Look for helpful/like button with count
                const likeButtons = container.querySelectorAll('button');
                for (const btn of likeButtons) {
                    const ariaLabel = btn.getAttribute('aria-label') || '';
                    if (ariaLabel.match(/helpful|like/i)) {
                        const likesMatch = ariaLabel.match(/(\d+)/);
                        if (likesMatch) {
                            likesCount = parseInt(likesMatch[1]);
                            break;
                        }
                    }
                }
                
                // === REVIEW ID ===
                const reviewId = container.getAttribute('data-review-id') || `review-${index}`;
                
                return {
                    reviewId,
                    reviewerName,
                    reviewerSubtitle,
                    rating,
                    reviewText: reviewText || null,
                    reviewDate,
                    likesCount,
                    shareLink: null
                };
                
            } catch (error) {
                console.error('Error extracting review data:', error.message);
                return null;
            }
        }
    }, maxReviews);
    
    log.info?.(`📜 Extracted ${reviews.length} reviews from page`);
    return reviews;
}

/**
 * Extract share links for each review using their review ID
 */
async function extractShareLinksForReviews(page, reviews, log) {
    for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        try {
            // Click the share button for this review using data-review-id
            const clicked = await page.evaluate((reviewId) => {
                // Find share button by data-review-id
                const shareBtn = document.querySelector(`button[data-review-id="${reviewId}"][aria-label*="Share"]`);
                if (shareBtn) {
                    shareBtn.click();
                    return true;
                }
                return false;
            }, review.reviewId);
            
            if (!clicked) continue;
            
            await randomDelay(1500, 2500);
            
            // Extract the share URL from the dialog
            const url = await page.evaluate(() => {
                const inputs = document.querySelectorAll('input[type="text"], input[readonly], [role="textbox"]');
                for (const input of inputs) {
                    const value = input.value || input.textContent || '';
                    if (value.includes('maps.app.goo.gl') || value.includes('goo.gl/maps') || value.includes('google.com/maps')) {
                        return value;
                    }
                }
                return null;
            });
            
            if (url) {
                review.shareLink = url;
                log.info(`  ✓ Got share link for ${review.reviewerName}`);
            }
            
            await closeShareDialog(page);
            await randomDelay(500, 1000);
            
        } catch (error) {
            log.warning(`  ✗ Failed to get share link for ${review.reviewerName}`);
            try {
                await closeShareDialog(page);
            } catch (e) {
                // Ignore
            }
        }
    }
}

/**
 * Close the share dialog
 */
async function closeShareDialog(page) {
    const closed = await page.evaluate(() => {
        const closeSelectors = [
            'button[aria-label="Close"]',
            'button[aria-label="close"]',
            '[role="dialog"] button[aria-label*="Close"]',
            '[role="dialog"] button[aria-label*="close"]'
        ];
        
        for (const selector of closeSelectors) {
            const btn = document.querySelector(selector);
            if (btn) {
                btn.click();
                return true;
            }
        }
        return false;
    });
    
    if (!closed) {
        await page.keyboard.press('Escape');
    }
    
    await randomDelay(300, 500);
}

/**
 * Close the sidebar and go back to the listing view
 */
async function closeSidebar(page, log) {
    try {
        await closeShareDialog(page);
        
        let closed = await page.evaluate(() => {
            const backSelectors = [
                'button[aria-label="Back"]',
                'button[aria-label="back"]', 
                'button[jsaction*="back"]',
                '[data-value="Back"]',
                '.section-back-to-list-button'
            ];
            
            for (const selector of backSelectors) {
                const btn = document.querySelector(selector);
                if (btn) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        
        if (closed) {
            await randomDelay(1500, 2500);
            return;
        }
        
        await page.keyboard.press('Escape');
        await randomDelay(1000, 1500);
        
        const stillInDetail = await page.evaluate(() => {
            const h1 = document.querySelector('h1');
            const feed = document.querySelector('[role="feed"]');
            return h1 && !feed;
        });
        
        if (stillInDetail) {
            await page.keyboard.press('Escape');
            await randomDelay(1000, 1500);
            
            await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                    if (ariaLabel.includes('back') || ariaLabel.includes('close')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            });
            await randomDelay(1000, 1500);
        }
        
        const backToListings = await page.evaluate(() => {
            const feed = document.querySelector('[role="feed"]');
            const articles = document.querySelectorAll('div[role="article"]');
            return feed || articles.length > 0;
        });
        
        if (!backToListings) {
            log.warning('May not have returned to listings view properly');
        }
        
    } catch (error) {
        log.warning(`Error closing sidebar: ${error.message}`);
    }
}
