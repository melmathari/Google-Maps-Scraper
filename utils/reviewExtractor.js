import { randomDelay } from './utils.js';
import { scrollReviewsPanel } from './reviewScroll.js';

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
            
            // Wait for reviews to actually load
            try {
                await page.waitForSelector('.jftiEf.fontBodyMedium, div[data-review-id], button[aria-label^="Photo of"]', { 
                    timeout: 15000 
                });
                log.info(`✓ Reviews loaded successfully`);
            } catch (waitError) {
                log.warning(`Reviews may not have loaded fully: ${waitError.message}`);
                // Check if we have any reviews anyway
                const hasReviews = await page.evaluate(() => {
                    return document.querySelectorAll('.jftiEf, div[data-review-id]').length > 0;
                });
                if (!hasReviews) {
                    log.warning('No reviews found on page');
                }
            }
            
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
 * Extract reviews from the current page by finding star ratings
 * This approach doesn't rely on specific CSS class selectors
 */
async function extractReviewsFromPage(page, maxReviews, log) {
    const reviews = await page.evaluate((max) => {
        const results = [];
        const processedContainers = new Set();
        
        // Find all star rating elements - these are the most reliable way to identify reviews
        const starElements = document.querySelectorAll('span[role="img"][aria-label*="star"]');
        
        for (const starEl of starElements) {
            if (results.length >= max) break;
            
            try {
                // Find the review container by going up from the star rating
                let container = starEl.parentElement;
                for (let i = 0; i < 10 && container; i++) {
                    // A review container typically:
                    // - Has substantial height (80-600px)
                    // - Contains the star rating
                    // - Contains text content (the review)
                    if (container.offsetHeight > 80 && container.offsetHeight < 600) {
                        // Check if this container has enough content to be a review
                        const hasText = container.innerText && container.innerText.length > 20;
                        if (hasText) {
                            break;
                        }
                    }
                    container = container.parentElement;
                }
                
                if (!container || processedContainers.has(container)) continue;
                processedContainers.add(container);
                
                // === STAR RATING === (we already have the star element)
                let rating = null;
                const ratingMatch = starEl.getAttribute('aria-label')?.match(/(\d+)\s*star/i);
                if (ratingMatch) {
                    rating = parseInt(ratingMatch[1]);
                }
                
                // === REVIEWER NAME ===
                let reviewerName = null;
                
                // Method 1: Button with "Photo of X" aria-label
                const photoBtn = container.querySelector('button[aria-label^="Photo of"]');
                if (photoBtn) {
                    const label = photoBtn.getAttribute('aria-label');
                    reviewerName = label.replace('Photo of ', '').trim();
                }
                
                // Method 2: Look for links/buttons at the top of the review (usually the name)
                if (!reviewerName) {
                    const links = container.querySelectorAll('a, button');
                    for (const link of links) {
                        const text = link.textContent?.trim();
                        // Name is usually short, not a button action
                        if (text && text.length > 2 && text.length < 50 && 
                            !text.toLowerCase().includes('star') && 
                            !text.toLowerCase().includes('like') && 
                            !text.toLowerCase().includes('share') &&
                            !text.toLowerCase().includes('more') &&
                            !text.toLowerCase().includes('review') &&
                            !text.match(/^\d+$/)) {
                            reviewerName = text;
                            break;
                        }
                    }
                }
                
                // Method 3: aria-label on container
                if (!reviewerName) {
                    const containerLabel = container.getAttribute('aria-label');
                    if (containerLabel && containerLabel.length < 50) {
                        reviewerName = containerLabel;
                    }
                }
                
                if (!reviewerName) reviewerName = 'Unknown';
                
                // === REVIEWER SUBTITLE ===
                // (e.g., "Local Guide · 26 reviews · 3 photos")
                let reviewerSubtitle = null;
                const allText = container.innerText || '';
                const subtitleMatch = allText.match(/(Local Guide[^·]*·[^·]*·[^\n]*|[\d,]+\s+reviews?[^·]*·[^\n]*)/i);
                if (subtitleMatch) {
                    reviewerSubtitle = subtitleMatch[1].trim();
                }
                
                // === REVIEW TEXT ===
                let reviewText = null;
                
                // Find the longest text block that's not the name, date, or subtitle
                const textBlocks = [];
                const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
                let node;
                while (node = walker.nextNode()) {
                    const text = node.textContent?.trim();
                    if (text && text.length > 30) {
                        // Skip if it's clearly not review text
                        if (!text.match(/^\d+\s*star/i) &&
                            !text.match(/^(a|an|\d+)\s+(year|month|week|day|hour|minute)s?\s*ago$/i) &&
                            !text.includes('Local Guide') &&
                            text !== reviewerName) {
                            textBlocks.push(text);
                        }
                    }
                }
                
                // Use the longest text block as the review
                if (textBlocks.length > 0) {
                    reviewText = textBlocks.reduce((a, b) => a.length > b.length ? a : b);
                }
                
                // === REVIEW DATE ===
                let reviewDate = null;
                const datePatterns = [
                    /(\d+\s*(year|month|week|day|hour|minute)s?\s*ago)/i,
                    /((a|an)\s+(year|month|week|day|hour|minute)\s*ago)/i,
                ];
                
                for (const pattern of datePatterns) {
                    const match = allText.match(pattern);
                    if (match) {
                        reviewDate = match[1];
                        break;
                    }
                }
                
                // === LIKES COUNT ===
                let likesCount = null;
                const likeBtn = container.querySelector('button[aria-label*="like" i]');
                if (likeBtn) {
                    const likeLabel = likeBtn.getAttribute('aria-label') || '';
                    const likesMatch = likeLabel.match(/(\d+)\s*like/i);
                    if (likesMatch) {
                        likesCount = parseInt(likesMatch[1]);
                    }
                }
                
                // Generate review ID
                const reviewId = container.getAttribute('data-review-id') || `review-${results.length}`;
                
                results.push({
                    reviewId,
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
