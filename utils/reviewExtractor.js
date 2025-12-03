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
 * Extract reviews from the current page using multiple robust selectors
 */
async function extractReviewsFromPage(page, maxReviews, log) {
    const reviews = await page.evaluate((max) => {
        const results = [];
        
        // Multiple selectors for review containers (Google changes these frequently)
        const containerSelectors = [
            'div.jftiEf[data-review-id]',      // Primary: has data-review-id
            'div[data-review-id]',              // Fallback: any div with data-review-id
            'div.jftiEf',                       // Fallback: class-based
        ];
        
        let reviewContainers = [];
        for (const selector of containerSelectors) {
            reviewContainers = document.querySelectorAll(selector);
            if (reviewContainers.length > 0) break;
        }
        
        // If still no containers, try finding by structure (button with "Photo of" in aria-label)
        if (reviewContainers.length === 0) {
            const photoButtons = document.querySelectorAll('button[aria-label^="Photo of"]');
            const containerSet = new Set();
            for (const btn of photoButtons) {
                // Go up to find the review container (usually 3-5 levels up)
                let parent = btn.parentElement;
                for (let i = 0; i < 6 && parent; i++) {
                    if (parent.getAttribute('data-review-id') || 
                        parent.classList.contains('jftiEf') ||
                        parent.querySelector('span[role="img"][aria-label*="star"]')) {
                        containerSet.add(parent);
                        break;
                    }
                    parent = parent.parentElement;
                }
            }
            reviewContainers = Array.from(containerSet);
        }
        
        for (const container of reviewContainers) {
            if (results.length >= max) break;
            
            try {
                // Get review ID from data attribute or generate from position
                const reviewId = container.getAttribute('data-review-id') || 
                                `review-${results.length}`;
                
                // === REVIEWER NAME ===
                // Method 1: aria-label on container
                let reviewerName = container.getAttribute('aria-label') || '';
                
                // Method 2: Button with "Photo of X" aria-label
                if (!reviewerName) {
                    const photoBtn = container.querySelector('button[aria-label^="Photo of"]');
                    if (photoBtn) {
                        const label = photoBtn.getAttribute('aria-label');
                        reviewerName = label.replace('Photo of ', '').trim();
                    }
                }
                
                // Method 3: Class-based selectors (d4r55 or similar)
                if (!reviewerName) {
                    const nameSelectors = ['.d4r55', '.WNxzHc', '[class*="fontTitleSmall"]'];
                    for (const sel of nameSelectors) {
                        const nameEl = container.querySelector(sel);
                        if (nameEl && nameEl.textContent.trim()) {
                            reviewerName = nameEl.textContent.trim();
                            break;
                        }
                    }
                }
                
                // Method 4: First link or span with substantial text
                if (!reviewerName || reviewerName === 'Unknown') {
                    const links = container.querySelectorAll('a, button');
                    for (const link of links) {
                        const text = link.textContent?.trim();
                        if (text && text.length > 2 && text.length < 50 && 
                            !text.includes('star') && !text.includes('Like') && 
                            !text.includes('Share') && !text.includes('review')) {
                            reviewerName = text;
                            break;
                        }
                    }
                }
                
                if (!reviewerName) reviewerName = 'Unknown';
                
                // === REVIEWER SUBTITLE ===
                // (e.g., "Local Guide · 26 reviews · 3 photos")
                let reviewerSubtitle = null;
                const subtitleSelectors = ['.RfnDt', '.A503be', '[class*="fontBodySmall"]'];
                for (const sel of subtitleSelectors) {
                    const subtitleEl = container.querySelector(sel);
                    if (subtitleEl) {
                        const text = subtitleEl.textContent.trim();
                        if (text.includes('review') || text.includes('Local Guide') || text.includes('photo')) {
                            reviewerSubtitle = text;
                            break;
                        }
                    }
                }
                
                // === STAR RATING ===
                let rating = null;
                
                // Method 1: span with role="img" and aria-label containing "star"
                const ratingEl = container.querySelector('span[role="img"][aria-label*="star"]');
                if (ratingEl) {
                    const ratingMatch = ratingEl.getAttribute('aria-label').match(/(\d+)\s*star/i);
                    if (ratingMatch) {
                        rating = parseInt(ratingMatch[1]);
                    }
                }
                
                // Method 2: kvMYJc class (stars container) - count filled stars
                if (rating === null) {
                    const starsContainer = container.querySelector('.kvMYJc');
                    if (starsContainer) {
                        // Count elements that represent filled stars
                        const filledStars = starsContainer.querySelectorAll('img[src*="star"], span[aria-label*="star"]');
                        if (filledStars.length > 0) {
                            rating = filledStars.length;
                        }
                    }
                }
                
                // Method 3: Find any element with "X stars" in aria-label
                if (rating === null) {
                    const allElements = container.querySelectorAll('[aria-label*="star"]');
                    for (const el of allElements) {
                        const label = el.getAttribute('aria-label');
                        const match = label.match(/(\d+)\s*star/i);
                        if (match) {
                            rating = parseInt(match[1]);
                            break;
                        }
                    }
                }
                
                // === REVIEW TEXT ===
                let reviewText = null;
                const textSelectors = [
                    'span.wiI7pd',
                    '.MyEned span',
                    '[class*="review-full-text"]',
                    '[data-expandable-section] span'
                ];
                
                for (const sel of textSelectors) {
                    const textEl = container.querySelector(sel);
                    if (textEl) {
                        const text = textEl.textContent.trim();
                        if (text && text.length > 5) {
                            reviewText = text;
                            break;
                        }
                    }
                }
                
                // Fallback: Find the longest text span that's not name/date/subtitle
                if (!reviewText) {
                    const spans = container.querySelectorAll('span');
                    let longestText = '';
                    for (const span of spans) {
                        const text = span.textContent?.trim() || '';
                        if (text.length > longestText.length && 
                            text.length > 20 &&
                            !text.includes('star') &&
                            !text.includes('Local Guide') &&
                            !text.includes('review') &&
                            text !== reviewerName) {
                            longestText = text;
                        }
                    }
                    if (longestText) reviewText = longestText;
                }
                
                // === REVIEW DATE ===
                let reviewDate = null;
                const dateSelectors = ['span.rsqaWe', '.DU9Pgb', '[class*="dehysf"]'];
                
                for (const sel of dateSelectors) {
                    const dateEl = container.querySelector(sel);
                    if (dateEl) {
                        const text = dateEl.textContent.trim();
                        // Check if it looks like a date (contains ago, year, month, week, day)
                        if (text.match(/ago|year|month|week|day|hour|minute|edited/i)) {
                            reviewDate = text;
                            break;
                        }
                    }
                }
                
                // Fallback: Search all spans for date-like text
                if (!reviewDate) {
                    const spans = container.querySelectorAll('span');
                    for (const span of spans) {
                        const text = span.textContent?.trim() || '';
                        if (text.match(/^\d+\s*(year|month|week|day|hour|minute)s?\s*ago$/i) ||
                            text.match(/^(a|an)\s+(year|month|week|day|hour|minute)\s*ago$/i) ||
                            text.match(/edited/i)) {
                            reviewDate = text;
                            break;
                        }
                    }
                }
                
                // === LIKES COUNT ===
                let likesCount = null;
                
                // Method 1: Button with "X likes" or "Like" aria-label
                const likeBtn = container.querySelector('button[aria-label*="like" i]');
                if (likeBtn) {
                    const likeLabel = likeBtn.getAttribute('aria-label') || '';
                    const likesMatch = likeLabel.match(/(\d+)\s*like/i);
                    if (likesMatch) {
                        likesCount = parseInt(likesMatch[1]);
                    }
                }
                
                // Method 2: Check button text content
                if (likesCount === null) {
                    const buttons = container.querySelectorAll('button');
                    for (const btn of buttons) {
                        const text = btn.textContent?.trim() || '';
                        const match = text.match(/^(\d+)$/);
                        if (match && btn.getAttribute('aria-label')?.toLowerCase().includes('like')) {
                            likesCount = parseInt(match[1]);
                            break;
                        }
                    }
                }
                
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
