import { randomDelay } from './utils.js';

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
        // Click on the listing to open the sidebar
        const clicked = await clickOnListing(page, business, log);
        if (!clicked) {
            log.warning(`Could not click on listing for: ${business.name}`);
            return [];
        }
        
        await randomDelay(2000, 3000);
        
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
 * @param {Object} page - Puppeteer page
 * @param {Object} business - Business object with url and name
 * @param {Object} log - Logger instance
 * @returns {boolean} Whether the click was successful
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
            // Helper to normalize strings for comparison
            const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normalizedName = normalize(businessName);
            
            // Method 1: Try to find the listing link by URL match
            const links = document.querySelectorAll('a[href*="/maps/place/"]');
            for (const link of links) {
                if (link.href === businessUrl) {
                    link.click();
                    return 'url-exact';
                }
            }
            
            // Method 2: Try to find by partial URL match
            for (const link of links) {
                // Extract place name from URL
                const urlMatch = link.href.match(/\/maps\/place\/([^/]+)/);
                if (urlMatch) {
                    const urlPlaceName = normalize(decodeURIComponent(urlMatch[1]).replace(/\+/g, ' '));
                    if (urlPlaceName.includes(normalizedName) || normalizedName.includes(urlPlaceName)) {
                        link.click();
                        return 'url-partial';
                    }
                }
            }
            
            // Method 3: Try to find by aria-label containing business name
            const articles = document.querySelectorAll('div[role="article"]');
            for (const article of articles) {
                const ariaLabel = article.getAttribute('aria-label') || '';
                if (normalize(ariaLabel).includes(normalizedName) || normalizedName.includes(normalize(ariaLabel))) {
                    const link = article.querySelector('a[href*="/maps/place/"]');
                    if (link) {
                        link.click();
                        return 'article-aria';
                    }
                    // Try clicking the article itself
                    article.click();
                    return 'article-click';
                }
            }
            
            // Method 4: Try to find by text content
            for (const article of articles) {
                const textContent = article.textContent || '';
                if (normalize(textContent).includes(normalizedName)) {
                    const link = article.querySelector('a[href*="/maps/place/"]');
                    if (link) {
                        link.click();
                        return 'text-content';
                    }
                }
            }
            
            // Method 5: Find by link text
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
 * @param {Object} page - Puppeteer page
 * @param {Object} log - Logger instance
 */
async function waitForSidebar(page, log) {
    try {
        // Wait for the sidebar to appear with business details
        await page.waitForFunction(() => {
            // Look for h1 (business name) or tabs
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
 * @param {Object} page - Puppeteer page
 * @param {Object} log - Logger instance
 * @returns {boolean} Whether the click was successful
 */
async function clickReviewsTab(page, log) {
    try {
        const clicked = await page.evaluate(() => {
            // Method 1: Find tab with role="tab" containing "Reviews" in aria-label or text
            const tabs = document.querySelectorAll('[role="tab"]');
            for (const tab of tabs) {
                const ariaLabel = tab.getAttribute('aria-label') || '';
                const textContent = tab.textContent || '';
                if (ariaLabel.toLowerCase().includes('reviews') || textContent.toLowerCase().includes('reviews')) {
                    tab.click();
                    return 'tab-role';
                }
            }
            
            // Method 2: Look for buttons containing "Reviews" text
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const textContent = btn.textContent || '';
                // Skip "Write a review" buttons
                if (textContent.toLowerCase().includes('write')) continue;
                
                if (ariaLabel.toLowerCase().includes('reviews') || 
                    (textContent.toLowerCase().includes('reviews') && !textContent.toLowerCase().includes('more reviews'))) {
                    btn.click();
                    return 'button-reviews';
                }
            }
            
            // Method 3: Look for "More reviews" button
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const textContent = btn.textContent || '';
                if (ariaLabel.includes('More reviews') || textContent.includes('More reviews')) {
                    btn.click();
                    return 'more-reviews';
                }
            }
            
            // Method 4: Look for review count button (e.g., "333 reviews")
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
            log.info(`✓ Opened reviews panel (method: ${clicked})`);
            await randomDelay(2000, 3000);
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
 * Scroll the reviews panel to load more reviews
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Target number of reviews
 * @param {Object} log - Logger instance
 */
async function scrollReviewsPanel(page, maxReviews, log) {
    const maxScrolls = Math.min(200, Math.max(5, Math.ceil(maxReviews / 3) + 10));
    let scrollCount = 0;
    let previousCount = 0;
    let noChangeCount = 0;
    
    while (scrollCount < maxScrolls) {
        // Count current reviews using multiple methods
        const currentCount = await page.evaluate(() => {
            // Method 1: Count by share buttons (look for buttons with "Share X's review" pattern)
            let count = 0;
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const dataTooltip = btn.getAttribute('data-tooltip') || '';
                // Match "Share [Name]'s review" pattern
                if (/share\s+.+['']s\s+review/i.test(ariaLabel) || /share\s+.+['']s\s+review/i.test(dataTooltip)) {
                    count++;
                }
            }
            
            // Method 2: If no buttons found, count by "Actions for X's review" pattern
            if (count === 0) {
                for (const btn of buttons) {
                    const ariaLabel = btn.getAttribute('aria-label') || '';
                    if (/actions\s+for\s+.+['']s\s+review/i.test(ariaLabel)) {
                        count++;
                    }
                }
            }
            
            // Method 3: Count star rating images within review context
            if (count === 0) {
                // Look for individual review star ratings (not the overall rating)
                const starImgs = document.querySelectorAll('[role="img"]');
                for (const img of starImgs) {
                    const ariaLabel = img.getAttribute('aria-label') || '';
                    // Match "X stars" but not "X stars, Y reviews" (that's the distribution chart)
                    if (/^\d\s+stars?$/i.test(ariaLabel.trim())) {
                        count++;
                    }
                }
            }
            
            return count;
        });
        
        if (currentCount >= maxReviews) {
            log.info(`📜 Loaded ${currentCount} reviews (target reached)`);
            return;
        }
        
        // Check if we're getting new reviews
        if (currentCount === previousCount) {
            noChangeCount++;
            if (noChangeCount >= 5) {
                log.info(`📜 No more reviews loading (${currentCount} total)`);
                return;
            }
        } else {
            noChangeCount = 0;
            previousCount = currentCount;
            log.debug(`📜 Loaded ${currentCount} reviews so far...`);
        }
        
        // Scroll the reviews container
        await page.evaluate(() => {
            // Find the scrollable container - it's usually the main content area in the side panel
            const scrollableSelectors = [
                '[role="main"]',
                '.section-scrollbox',
                '[tabindex="-1"]', // Often the scrollable container
            ];
            
            // Try specific selectors first
            for (const selector of scrollableSelectors) {
                const container = document.querySelector(selector);
                if (container && container.scrollHeight > container.clientHeight) {
                    container.scrollTop = container.scrollHeight;
                    return true;
                }
            }
            
            // Fallback: find any scrollable div with overflow
            const allDivs = document.querySelectorAll('div');
            for (const div of allDivs) {
                const style = window.getComputedStyle(div);
                const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                    div.scrollHeight > div.clientHeight;
                if (isScrollable && div.scrollHeight > 500) {
                    div.scrollTop = div.scrollHeight;
                    return true;
                }
            }
            
            return false;
        });
        
        await randomDelay(1500, 2500);
        scrollCount++;
    }
}

/**
 * Extract reviews from the current page
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews to extract
 * @param {Object} log - Logger instance
 * @returns {Array} Array of review objects
 */
async function extractReviewsFromPage(page, maxReviews, log) {
    const reviews = await page.evaluate((max) => {
        const results = [];
        const processedNames = new Set();
        
        // Find all buttons and look for share buttons or actions buttons
        const buttons = document.querySelectorAll('button');
        const reviewerButtons = [];
        
        for (const btn of buttons) {
            const ariaLabel = btn.getAttribute('aria-label') || '';
            const dataTooltip = btn.getAttribute('data-tooltip') || '';
            const label = ariaLabel || dataTooltip;
            
            // Match "Share [Name]'s review" or "Actions for [Name]'s review"
            const shareMatch = label.match(/share\s+(.+?)['']s\s+review/i);
            const actionsMatch = label.match(/actions\s+for\s+(.+?)['']s\s+review/i);
            
            if (shareMatch || actionsMatch) {
                const reviewerName = (shareMatch ? shareMatch[1] : actionsMatch[1]).trim();
                if (!processedNames.has(reviewerName.toLowerCase())) {
                    processedNames.add(reviewerName.toLowerCase());
                    reviewerButtons.push({ btn, reviewerName, isShare: !!shareMatch });
                }
            }
        }
        
        for (const { btn, reviewerName, isShare } of reviewerButtons) {
            if (results.length >= max) break;
            
            try {
                // Find the parent review container by walking up the DOM
                let reviewContainer = btn;
                for (let i = 0; i < 15 && reviewContainer; i++) {
                    reviewContainer = reviewContainer.parentElement;
                    // Look for container that has the reviewer name as attribute
                    const containerAriaLabel = reviewContainer?.getAttribute('aria-label') || '';
                    if (containerAriaLabel && containerAriaLabel.toLowerCase().includes(reviewerName.toLowerCase())) {
                        break;
                    }
                    // Also check if it's a large enough container
                    if (reviewContainer && reviewContainer.clientHeight > 100) {
                        // Check if this container has the star rating img
                        const hasRating = reviewContainer.querySelector('[role="img"][aria-label*="star"]');
                        if (hasRating) break;
                    }
                }
                
                if (!reviewContainer) {
                    reviewContainer = btn.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
                }
                
                // Extract reviewer subtitle (e.g., "Local Guide · 26 reviews · 3 photos")
                let reviewerSubtitle = null;
                const containerButtons = reviewContainer?.querySelectorAll('button') || [];
                for (const cbtn of containerButtons) {
                    const label = cbtn.getAttribute('aria-label') || '';
                    // Look for button with reviewer info pattern (contains name + Local Guide or reviews/photos)
                    if ((label.includes('Local Guide') || /\d+\s+reviews?/i.test(label)) && 
                        label.toLowerCase().includes(reviewerName.toLowerCase()) &&
                        !label.includes('Actions') && !label.includes('Share')) {
                        // Extract subtitle (everything after the name)
                        const nameIdx = label.toLowerCase().indexOf(reviewerName.toLowerCase());
                        if (nameIdx !== -1) {
                            reviewerSubtitle = label.substring(nameIdx + reviewerName.length).trim().replace(/^[·\s]+/, '');
                        }
                        break;
                    }
                }
                
                // Extract rating from img with "X stars" aria-label
                let rating = null;
                const ratingImgs = reviewContainer?.querySelectorAll('[role="img"], img') || [];
                for (const img of ratingImgs) {
                    const label = img.getAttribute('aria-label') || '';
                    // Match just "X stars" not "X stars, Y reviews"
                    const ratingMatch = label.match(/^(\d)\s+stars?$/i);
                    if (ratingMatch) {
                        rating = parseInt(ratingMatch[1]);
                        break;
                    }
                }
                
                // Extract review text - look for spans with substantial text
                let reviewText = null;
                const allSpans = reviewContainer?.querySelectorAll('span') || [];
                let longestText = '';
                
                for (const span of allSpans) {
                    const text = span.textContent?.trim() || '';
                    // Skip UI elements, dates, and metadata
                    if (text.length < 20) continue;
                    if (/^\d+\s*(review|photo|like)/i.test(text)) continue;
                    if (text.includes('Local Guide')) continue;
                    if (/\d+\s*(day|week|month|year|hour|minute)s?\s*ago/i.test(text)) continue;
                    if (text === reviewerName) continue;
                    
                    // Keep track of longest text as likely review content
                    if (text.length > longestText.length) {
                        longestText = text;
                    }
                }
                
                if (longestText) {
                    reviewText = longestText;
                }
                
                // Extract review date (e.g., "2 months ago", "a month ago")
                let reviewDate = null;
                for (const span of allSpans) {
                    const text = span.textContent?.trim() || '';
                    if (/\d+\s*(day|week|month|year|hour|minute)s?\s*ago/i.test(text) || 
                        /^(a|an)\s+(day|week|month|year|hour|minute)\s+ago/i.test(text)) {
                        reviewDate = text;
                        break;
                    }
                }
                
                // Extract likes count
                let likesCount = null;
                for (const cbtn of containerButtons) {
                    const label = cbtn.getAttribute('aria-label') || cbtn.textContent || '';
                    const likesMatch = label.match(/(\d+)\s*like/i);
                    if (likesMatch) {
                        likesCount = parseInt(likesMatch[1]);
                        break;
                    }
                }
                
                results.push({
                    reviewerName,
                    reviewerSubtitle,
                    rating,
                    reviewText,
                    reviewDate,
                    likesCount,
                    shareLink: null
                });
                
            } catch (error) {
                console.error('Error extracting review:', error.message);
            }
        }
        
        return results;
    }, maxReviews);
    
    return reviews;
}

/**
 * Extract share links for each review
 * @param {Object} page - Puppeteer page
 * @param {Array} reviews - Array of review objects to update
 * @param {Object} log - Logger instance
 */
async function extractShareLinksForReviews(page, reviews, log) {
    for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        try {
            // Click the share button for this review
            const clicked = await page.evaluate((reviewerName) => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const ariaLabel = btn.getAttribute('aria-label') || '';
                    const dataTooltip = btn.getAttribute('data-tooltip') || '';
                    const label = ariaLabel || dataTooltip;
                    
                    // Match "Share [Name]'s review"
                    if (/share/i.test(label) && label.toLowerCase().includes(reviewerName.toLowerCase())) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }, review.reviewerName);
            
            if (!clicked) continue;
            
            await randomDelay(1500, 2500);
            
            // Extract the share URL from the dialog
            const url = await page.evaluate(() => {
                // Look for the textbox with the share URL
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
            
            // Close the share dialog - try multiple methods
            await closeShareDialog(page);
            await randomDelay(500, 1000);
            
        } catch (error) {
            log.warning(`  ✗ Failed to get share link for ${review.reviewerName}`);
            // Try to close dialog even on error
            try {
                await closeShareDialog(page);
            } catch (e) {
                // Ignore
            }
        }
    }
}

/**
 * Close the share dialog using multiple methods
 * @param {Object} page - Puppeteer page
 */
async function closeShareDialog(page) {
    // Method 1: Click the Close button
    const closed = await page.evaluate(() => {
        // Try various close button selectors
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
        // Method 2: Press Escape key
        await page.keyboard.press('Escape');
    }
    
    await randomDelay(300, 500);
    
    // Verify dialog is closed
    const dialogStillOpen = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog && dialog.offsetParent !== null;
    });
    
    if (dialogStillOpen) {
        // Method 3: Click outside the dialog
        await page.mouse.click(10, 10);
        await randomDelay(300, 500);
    }
}

/**
 * Close the sidebar and go back to the listing view
 * @param {Object} page - Puppeteer page
 * @param {Object} log - Logger instance
 */
async function closeSidebar(page, log) {
    try {
        // First, make sure any share dialog is closed
        await closeShareDialog(page);
        
        // Method 1: Click the back button (usually an arrow at the top left)
        let closed = await page.evaluate(() => {
            // Various back button selectors
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
        
        // Method 2: Press Escape to close the sidebar
        await page.keyboard.press('Escape');
        await randomDelay(1000, 1500);
        
        // Method 3: If still showing detail, try clicking on the search results area
        const stillInDetail = await page.evaluate(() => {
            // Check if we're still in the detail view (has h1 with business name)
            const h1 = document.querySelector('h1');
            const feed = document.querySelector('[role="feed"]');
            return h1 && !feed;
        });
        
        if (stillInDetail) {
            // Press Escape again
            await page.keyboard.press('Escape');
            await randomDelay(1000, 1500);
            
            // Try clicking back button again with more specific selector
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
        
        // Verify we're back to listings
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
